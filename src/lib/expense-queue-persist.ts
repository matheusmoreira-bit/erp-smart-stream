/**
 * Persistência do estado da fila de fornecedores do CreateExpenseModal
 * entre sessões do navegador (sobrevive a F5 / reload / fechar aba).
 *
 * - `queueHistory`, `deferredGroups`, `failedGroups`, `cancelledGroups` ficam
 *   em uma store única no IndexedDB, keyed por escopo ("expenses" | "sales").
 * - Arquivos (File) são gravados como Blob dentro do próprio registro (o IDB
 *   trata Blob nativamente). Ao carregar, reconstruímos File preservando
 *   name/type/lastModified.
 *
 * O localStorage NÃO serve para isso — Blobs grandes e o quota de ~5MB
 * inviabilizam anexos reais de nota fiscal.
 */

import { localStateEpoch } from "@/lib/local-state-epoch";
import { getLocalOwnerId } from "@/lib/local-owner";

const DB_NAME = "createExpenseModalQueue";
const DB_VERSION = 1;
const STORE = "state";

export type QueueScope = "expenses" | "sales";

// Metadados de um arquivo persistido — reconstroem `File` no carregamento.
export interface PersistedFile {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}

export interface PersistedDoc {
  file: PersistedFile;
  // `extracted` é o payload IA cru — pode ser qualquer JSON serializável.
  // Guardamos como está; o modal já lida com "any".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extracted: any;
  /** Boleto/comprovante que acompanha a nota (anexo, sem gerar linhas). */
  companion?: boolean;
}

export interface PersistedDocGroup {
  supplierKey: string;
  supplierLabel: string;
  docs: PersistedDoc[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PersistedQueueState<QueueEntry = any> {
  queueHistory: QueueEntry[];
  deferredGroups: PersistedDocGroup[];
  failedGroups: PersistedDocGroup[];
  cancelledGroups: PersistedDocGroup[];
  savedAt: number;
  /** Usuário dono do snapshot (F13). */
  ownerId?: string | null;
  companyDb?: string;
}

/** Legacy snapshots without a company are deliberately not restored. */
async function ownerKey(scope: QueueScope, companyDb: string): Promise<{key: string; owner: string} | null> {
  const owner = await getLocalOwnerId();
  return owner && companyDb ? {key: JSON.stringify([owner, companyDb, scope]), owner} : null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | T, epoch: string): Promise<T> {
  const db = await openDb();
  if (epoch !== localStateEpoch()) { db.close(); throw new Error("Sessão local alterada"); }
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let out: T | undefined;
    Promise.resolve(fn(store))
      .then((res) => {
        if (res && typeof (res as unknown as IDBRequest).onsuccess !== "undefined") {
          (res as unknown as IDBRequest).onsuccess = () => { out = (res as IDBRequest<T>).result; };
          (res as unknown as IDBRequest).onerror = () => reject((res as IDBRequest).error);
        } else {
          out = res as T;
        }
      })
      .catch(reject);
    tx.oncomplete = () => resolve(out as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
}

/** Snapshot scoped to the authenticated owner AND company. */
export async function saveQueueState<Q>(scope: QueueScope, state: PersistedQueueState<Q>, companyDb: string): Promise<void> {
  const epoch = localStateEpoch();
  const identity = await ownerKey(scope, companyDb);
  if (!identity || epoch !== localStateEpoch()) return;
  await withStore("readwrite", store => store.put({ ...state, ownerId: identity.owner, companyDb }, identity.key), epoch);
}

export async function loadQueueState<Q>(scope: QueueScope, companyDb: string): Promise<PersistedQueueState<Q> | null> {
  const epoch = localStateEpoch();
  const identity = await ownerKey(scope, companyDb);
  if (!identity) return null;
  try {
    const saved = await withStore<PersistedQueueState<Q> | undefined>("readonly", store => store.get(identity.key), epoch);
    if (epoch !== localStateEpoch() || identity.owner !== await getLocalOwnerId()) return null;
    return saved?.ownerId === identity.owner && saved.companyDb === companyDb ? saved : null;
  } catch { return null; }
}

export async function clearQueueState(scope: QueueScope, companyDb: string): Promise<void> {
  const epoch = localStateEpoch();
  const identity = await ownerKey(scope, companyDb);
  if (!identity || epoch !== localStateEpoch()) return;
  await withStore("readwrite", store => store.delete(identity.key), epoch);
}

/** Converte `File` do runtime em `PersistedFile` para gravar no IDB. */
export function toPersistedFile(f: File): PersistedFile {
  return { name: f.name, type: f.type, lastModified: f.lastModified, blob: f.slice(0, f.size, f.type) };
}

/** Reconstroi `File` a partir de `PersistedFile`. */
export function fromPersistedFile(p: PersistedFile): File {
  return new File([p.blob], p.name, { type: p.type, lastModified: p.lastModified });
}
