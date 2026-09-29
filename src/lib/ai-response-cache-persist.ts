import { getLocalOwnerId } from "@/lib/local-owner";
import { localStateEpoch } from "@/lib/local-state-epoch";
// Persistência do cache de respostas da IA por hash de conteúdo (SHA-256).
// Objetivo: reaproveitar extrações mesmo após fechar/reabrir o modal ou
// recarregar a página. Vive em localStorage — payloads são JSON pequenos
// (metadados extraídos, não o arquivo). Isolado por escopo (expenses/sales).
//
// Estratégia:
// - Chave: `ai-response-cache-v1:${scope}`
// - Formato: { version, entries: { [hash]: { data, ts } } }
// - TTL: 30 dias (evita entradas obsoletas de layouts que mudaram).
// - Cap: quando ultrapassa MAX_ENTRIES, remove os mais antigos por `ts`.
// - Falhas silenciosas (quota exceeded, JSON inválido) — cache é opcional.

const VERSION = 3;
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias
const MAX_ENTRIES = 500;

type Scope = "expenses" | "sales";
type CacheEntry = { data: unknown; ts: number };
type CacheFile = { version: number; entries: Record<string, CacheEntry> };

// Legacy entries without owner/company are never imported into the new scope.
async function storageKey(scope: Scope, companyDb: string): Promise<string | null> {
  const owner = await getLocalOwnerId();
  return owner && companyDb ? `ai-response-cache-v3:${JSON.stringify([owner, companyDb, scope])}` : null;
}

function readFile(key: string): CacheFile {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { version: VERSION, entries: {} };
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed || parsed.version !== VERSION || typeof parsed.entries !== "object") {
      return { version: VERSION, entries: {} };
    }
    // Filtra expirados na leitura.
    const now = Date.now();
    const kept: Record<string, CacheEntry> = {};
    for (const [k, v] of Object.entries(parsed.entries)) {
      if (v && typeof v === "object" && typeof v.ts === "number" && now - v.ts < TTL_MS) {
        kept[k] = v;
      }
    }
    return { version: VERSION, entries: kept };
  } catch {
    return { version: VERSION, entries: {} };
  }
}

function writeFile(key: string, file: CacheFile): void {
  try {
    // Aplica cap por antiguidade se necessário.
    const keys = Object.keys(file.entries);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys
        .map((k) => [k, file.entries[k].ts] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ENTRIES);
      const trimmed: Record<string, CacheEntry> = {};
      for (const [k] of sorted) trimmed[k] = file.entries[k];
      file = { version: VERSION, entries: trimmed };
    }
    localStorage.setItem(key, JSON.stringify(file));
  } catch {
    // QuotaExceeded ou storage indisponível — segue sem persistir.
  }
}

/** Carrega o cache inteiro como Map<hash, data> para uso em memória. */
export async function loadAiResponseCache(scope: Scope, companyDb: string): Promise<Map<string, any>> {
  const epoch = localStateEpoch();
  const key = await storageKey(scope, companyDb);
  if (!key || epoch !== localStateEpoch()) return new Map();
  const file = readFile(key);
  const map = new Map<string, any>();
  for (const [k, v] of Object.entries(file.entries)) map.set(k, v.data);
  return map;
}

/** Persiste (upsert) várias entradas de uma vez. */
export async function saveAiResponseCacheEntries(
  scope: Scope,
  entries: Array<{ hash: string; data: unknown }>,
  companyDb: string,
  epoch = localStateEpoch(),
): Promise<void> {
  if (entries.length === 0) return;
  const key = await storageKey(scope, companyDb);
  if (!key || epoch !== localStateEpoch()) return;
  const file = readFile(key);
  const now = Date.now();
  for (const { hash, data } of entries) {
    if (!hash || data == null) continue;
    file.entries[hash] = { data, ts: now };
  }
  writeFile(key, file);
}

/** Remove tudo do escopo (usado se o usuário quiser resetar). */
export async function clearAiResponseCache(scope: Scope, companyDb: string): Promise<void> {
  const key = await storageKey(scope, companyDb);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
