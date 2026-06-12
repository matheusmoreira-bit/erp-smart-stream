/**
 * In-memory, session-scoped cache for AI document/extraction results.
 *
 * Goal: when the same attachment URL (or file content) is reprocessed inside
 * the same browser session, return the previous result instead of paying for
 * another LLM call.
 *
 * - Lives only in memory; cleared on page reload / logout.
 * - Keyed by a stable hash (SHA-256 of file bytes) OR by URL when bytes are
 *   not available locally.
 */

type CacheValue = unknown;

const memCache = new Map<string, CacheValue>();

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashFile(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  return sha256Hex(buf);
}

export function hashUrls(urls: string[]): string {
  // Cheap, deterministic key: URLs are already content-addressable in PagCorp.
  return `urls:${[...urls].sort().join("|")}`;
}

export function getCachedAi<T = CacheValue>(key: string): T | undefined {
  return memCache.get(key) as T | undefined;
}

export function setCachedAi<T = CacheValue>(key: string, value: T): void {
  memCache.set(key, value);
}

export function clearAiCache(): void {
  memCache.clear();
}

/**
 * Wraps an async producer with the session cache. Returns cached value when
 * present; otherwise runs the producer and caches its result.
 */
export async function withAiCache<T>(
  key: string,
  producer: () => Promise<T>,
): Promise<T> {
  const cached = memCache.get(key) as T | undefined;
  if (cached !== undefined) return cached;
  const value = await producer();
  memCache.set(key, value);
  return value;
}
