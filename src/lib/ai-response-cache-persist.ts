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

const VERSION = 2;
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias
const MAX_ENTRIES = 500;

type Scope = "expenses" | "sales";
type CacheEntry = { data: unknown; ts: number };
type CacheFile = { version: number; entries: Record<string, CacheEntry> };

// v2: chave inclui MIME e lastModified além de hash|size|name — invalida
// automaticamente entradas gravadas no formato v1 (readFile as descarta
// porque o `version` do arquivo não bate mais).
const storageKey = (scope: Scope) => `ai-response-cache-v2:${scope}`;

function readFile(scope: Scope): CacheFile {
  try {
    const raw = localStorage.getItem(storageKey(scope));
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

function writeFile(scope: Scope, file: CacheFile): void {
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
    localStorage.setItem(storageKey(scope), JSON.stringify(file));
  } catch {
    // QuotaExceeded ou storage indisponível — segue sem persistir.
  }
}

/** Carrega o cache inteiro como Map<hash, data> para uso em memória. */
export function loadAiResponseCache(scope: Scope): Map<string, any> {
  const file = readFile(scope);
  const map = new Map<string, any>();
  for (const [k, v] of Object.entries(file.entries)) map.set(k, v.data);
  return map;
}

/** Persiste (upsert) várias entradas de uma vez. */
export function saveAiResponseCacheEntries(
  scope: Scope,
  entries: Array<{ hash: string; data: unknown }>,
): void {
  if (entries.length === 0) return;
  const file = readFile(scope);
  const now = Date.now();
  for (const { hash, data } of entries) {
    if (!hash || data == null) continue;
    file.entries[hash] = { data, ts: now };
  }
  writeFile(scope, file);
}

/** Remove tudo do escopo (usado se o usuário quiser resetar). */
export function clearAiResponseCache(scope: Scope): void {
  try {
    localStorage.removeItem(storageKey(scope));
  } catch {
    // ignore
  }
}
