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
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | T): Promise<T> {
  const db = await openDb();
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

/** Salva o snapshot inteiro do escopo (substitui o anterior). */
export async function saveQueueState<Q>(scope: QueueScope, state: PersistedQueueState<Q>): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(state, scope));
  } catch (err) {
    console.warn("[queue-persist] saveQueueState falhou:", err);
  }
}

/** Carrega o snapshot do escopo, ou null se não houver / falhar. */
export async function loadQueueState<Q>(scope: QueueScope): Promise<PersistedQueueState<Q> | null> {
  try {
    return await new Promise<PersistedQueueState<Q> | null>((resolve, reject) => {
      openDb().then((db) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(scope);
        req.onsuccess = () => resolve((req.result as PersistedQueueState<Q>) ?? null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }).catch(reject);
    });
  } catch (err) {
    console.warn("[queue-persist] loadQueueState falhou:", err);
    return null;
  }
}

/** Remove o snapshot do escopo (usado quando o usuário fecha o resumo final). */
export async function clearQueueState(scope: QueueScope): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(scope));
  } catch (err) {
    console.warn("[queue-persist] clearQueueState falhou:", err);
  }
}

/** Converte `File` do runtime em `PersistedFile` para gravar no IDB. */
export function toPersistedFile(f: File): PersistedFile {
  return { name: f.name, type: f.type, lastModified: f.lastModified, blob: f.slice(0, f.size, f.type) };
}

/** Reconstroi `File` a partir de `PersistedFile`. */
export function fromPersistedFile(p: PersistedFile): File {
  return new File([p.blob], p.name, { type: p.type, lastModified: p.lastModified });
}
