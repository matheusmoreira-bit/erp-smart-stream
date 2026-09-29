/**
 * Modo offline com fila de envio (outbox).
 *
 * Quando a base do ERP está fora do ar (circuit breaker aberto) ou o navegador
 * está sem rede, o lançamento de pedidos/despesas não é perdido: o payload é
 * guardado localmente no IndexedDB e reenviado automaticamente assim que o
 * circuito fechar / a conexão voltar.
 *
 * Escopo: apenas o cliente. Nada aqui substitui as validações do servidor —
 * ao desenfileirar, o mesmo caminho autenticado (`expense-mutation`) é usado.
 */

import { getCircuitState, SapCircuitOpenError } from "@/lib/sap-circuit-breaker";
import { localStateEpoch } from "@/lib/local-state-epoch";
import { getLocalOwnerId } from "@/lib/local-owner";

const DB_NAME = "erpflow-offline";
const DB_VERSION = 1;
const STORE = "outbox";

export type OutboxKind = "expense";
export type OutboxStatus = "pending" | "sending" | "failed";

export interface OutboxEntry {
  id: string;
  /** Usuário que criou (F13): só ele vê/reenvia. */
  ownerId?: string | null;
  kind: OutboxKind;
  companyDB: string | null;
  docType: string;
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
  /** Resumo legível para a UI (não confiar nele para envio). */
  summary: {
    supplier_name: string;
    total: number;
    itemCount: number;
    attachmentCount: number;
  };
  /** Payload original de criação (CreateExpenseInput serializável). */
  payload: Record<string, unknown>;
}

/* ─────────────────────────── IndexedDB ─────────────────────────── */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB indisponível neste navegador"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Permite que o logout apague o banco (F13) sem ficar bloqueado.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("Falha ao abrir o banco local"));
    });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, epoch = localStateEpoch()): Promise<T> {
  const db = await openDb();
  if (epoch !== localStateEpoch()) throw new Error("Sessão local alterada");
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result as T);
    t.onabort = () => reject(t.error ?? new Error("Transação da fila cancelada"));
    t.onerror = () => reject(t.error ?? new Error("Falha na fila offline"));
    req.onerror = () => reject(req.error ?? new Error("Falha na fila offline"));
  });
}

/* ─────────────────────────── Assinantes ─────────────────────────── */

type Listener = (entries: OutboxEntry[]) => void;
const listeners = new Set<Listener>();

async function notify() {
  const entries = await listOutbox().catch(() => []);
  listeners.forEach((l) => {
    try { l(entries); } catch { /* ignore */ }
  });
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void notify();
  return () => { listeners.delete(listener); };
}

/* ─────────────────────────── CRUD ─────────────────────────── */

export async function listOutbox(): Promise<OutboxEntry[]> {
  const epoch = localStateEpoch();
  try {
    const all = await tx<OutboxEntry[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
    const owner = await getLocalOwnerId();
    if (!owner || epoch !== localStateEpoch()) return [];
    return (all || []).filter((e) => e.ownerId === owner).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function enqueueOutbox(
  entry: Omit<OutboxEntry, "id" | "createdAt" | "attempts" | "status" | "ownerId">,
): Promise<OutboxEntry> {
  const epoch = localStateEpoch();
  const ownerId = await getLocalOwnerId();
  if (!ownerId) throw new Error("Faça login para guardar o lançamento na fila offline.");
  const full: OutboxEntry = {
    ...entry,
    ownerId,
    id: (crypto?.randomUUID?.() ?? `ob_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    createdAt: Date.now(),
    attempts: 0,
    status: "pending",
  };
  await tx("readwrite", (s) => s.put(full), epoch);
  void notify();
  return full;
}

async function mutateOwnedEntry(
  id: string, owner: string, change: (entry: OutboxEntry) => OutboxEntry | null,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const current = get.result as OutboxEntry | undefined;
      if (!current || current.ownerId !== owner) return;
      const next = change(current);
      if (next) store.put({ ...next, id, ownerId: owner });
      else store.delete(id);
    };
    t.oncomplete = () => resolve();
    t.onabort = t.onerror = () => reject(t.error ?? new Error("Falha ao alterar item da fila"));
  });
}

export async function updateOutbox(id: string, patch: Partial<OutboxEntry>): Promise<void> {
  const owner = await getLocalOwnerId();
  if (!owner) return;
  await mutateOwnedEntry(id, owner, (current) => ({ ...current, ...patch }));
  void notify();
}

export async function removeOutbox(id: string): Promise<void> {
  const owner = await getLocalOwnerId();
  if (!owner) return;
  await mutateOwnedEntry(id, owner, () => null);
  void notify();
}

/* ─────────────────────── Detecção de indisponibilidade ─────────────────────── */

/** Navegador sem rede ou circuito da base aberto/half-open. */
export function isErpUnavailable(companyDB: string | null | undefined): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const { state } = getCircuitState(companyDB);
  return state === "open";
}

/**
 * Erros que justificam enfileirar em vez de falhar: circuito aberto, rede
 * indisponível, timeout ou 5xx/504 do gateway. Erros de negócio/validação NÃO
 * entram na fila (o usuário precisa corrigir).
 */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof SapCircuitOpenError) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("temporariamente indisponível") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

/* ─────────────────────────── Flush ─────────────────────────── */

export type OutboxSender = (entry: OutboxEntry) => Promise<void>;

const senders = new Map<OutboxKind, Set<OutboxSender>>();

/** Registra quem sabe reenviar cada tipo de item da fila. */
export function registerOutboxSender(kind: OutboxKind, sender: OutboxSender): () => void {
  const registered = senders.get(kind) || new Set<OutboxSender>();
  registered.add(sender);
  senders.set(kind, registered);
  return () => {
    const current = senders.get(kind);
    current?.delete(sender);
    if (current?.size === 0) senders.delete(kind);
  };
}

let flushing = false;

export interface FlushResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** Tenta reenviar tudo que está pendente para as bases já disponíveis. */
export async function flushOutbox(opts?: { force?: boolean }): Promise<FlushResult> {
  const epoch = localStateEpoch();
  const result: FlushResult = { sent: 0, failed: 0, skipped: 0 };
  if (flushing) return result;
  flushing = true;
  try {
    const entries = await listOutbox();
    for (const entry of entries) {
      if (epoch !== localStateEpoch() || !entry.ownerId || entry.ownerId !== await getLocalOwnerId()) {
        result.skipped += 1;
        continue;
      }
      if (entry.status === "sending") continue;
      if (!opts?.force && isErpUnavailable(entry.companyDB)) {
        result.skipped += 1;
        continue;
      }
      const registered = senders.get(entry.kind);
      const sender = registered ? Array.from(registered).at(-1) : undefined;
      if (!sender) { result.skipped += 1; continue; }

      await updateOutbox(entry.id, { status: "sending" });
      try {
        // updateOutbox e a consulta do dono são assíncronos; a conta pode mudar
        // enquanto aguardamos. Nunca envie o snapshot anterior sob outra conta.
        if (epoch !== localStateEpoch() || entry.ownerId !== await getLocalOwnerId()) {
          // Libera apenas o item reservado por este flush, sem enviá-lo.
          await mutateOwnedEntry(entry.id, entry.ownerId, (current) => ({ ...current, status: "pending" }));
          result.skipped += 1;
          continue;
        }
        await sender(entry);
        await removeOutbox(entry.id);
        result.sent += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await updateOutbox(entry.id, {
          status: isOfflineError(e) ? "pending" : "failed",
          attempts: entry.attempts + 1,
          lastError: message.slice(0, 500),
        });
        result.failed += 1;
      }
    }
  } finally {
    flushing = false;
  }
  return result;
}
