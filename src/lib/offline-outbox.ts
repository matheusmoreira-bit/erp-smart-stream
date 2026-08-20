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

const DB_NAME = "erpflow-offline";
const DB_VERSION = 1;
const STORE = "outbox";

export type OutboxKind = "expense";
export type OutboxStatus = "pending" | "sending" | "failed";

export interface OutboxEntry {
  id: string;
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
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Falha ao abrir o banco local"));
    });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
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
  try {
    const all = await tx<OutboxEntry[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
    return (all || []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function enqueueOutbox(
  entry: Omit<OutboxEntry, "id" | "createdAt" | "attempts" | "status">,
): Promise<OutboxEntry> {
  const full: OutboxEntry = {
    ...entry,
    id: (crypto?.randomUUID?.() ?? `ob_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    createdAt: Date.now(),
    attempts: 0,
    status: "pending",
  };
  await tx("readwrite", (s) => s.put(full));
  void notify();
  return full;
}

export async function updateOutbox(id: string, patch: Partial<OutboxEntry>): Promise<void> {
  const current = await tx<OutboxEntry | undefined>("readonly", (s) => s.get(id) as IDBRequest<OutboxEntry | undefined>);
  if (!current) return;
  await tx("readwrite", (s) => s.put({ ...current, ...patch, id }));
  void notify();
}

export async function removeOutbox(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
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
  const result: FlushResult = { sent: 0, failed: 0, skipped: 0 };
  if (flushing) return result;
  flushing = true;
  try {
    const entries = await listOutbox();
    for (const entry of entries) {
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
