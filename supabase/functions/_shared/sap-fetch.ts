// Helper compartilhado para chamadas ao SAP Service Layer.
// - timeout via AbortSignal (default 30s)
// - retry com backoff exponencial em 5xx, 408, 429 e erros de rede/timeout
// - propaga erros em 4xx (exceto 408/429) sem retry

export interface SapFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sapFetch(url: string, options: SapFetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = 30_000,
    maxAttempts = 3,
    baseDelayMs = 1000,
    signal: externalSignal,
    ...init
  } = options;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`SAP timeout após ${timeoutMs}ms`)), timeoutMs);
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
      else externalSignal.addEventListener("abort", () => ctrl.abort(externalSignal.reason), { once: true });
    }
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (RETRY_STATUSES.has(res.status) && attempt < maxAttempts) {
        // descarta corpo para liberar conexão
        await res.body?.cancel().catch(() => {});
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[sapFetch] ${url} -> HTTP ${res.status}, retry ${attempt}/${maxAttempts - 1} em ${delay}ms`);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt >= maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[sapFetch] ${url} -> erro de rede (${msg}), retry ${attempt}/${maxAttempts - 1} em ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Tenta adquirir um "lock" otimista numa linha de tabela, evitando
 * dois processos integrarem o mesmo documento simultaneamente.
 *
 * Implementado como UPDATE condicional: a coluna `sap_integration_locked_at`
 * só é gravada se estiver NULA ou expirada (> ttlMinutes atrás).
 *
 * Retorna `true` se o lock foi adquirido; `false` caso outro processo já detenha.
 */
export async function tryAcquireIntegrationLock(
  supabase: any,
  table: "expenses" | "advance_payments",
  id: string,
  ttlMinutes = 5,
): Promise<boolean> {
  const cutoffIso = new Date(Date.now() - ttlMinutes * 60_000).toISOString();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from(table)
    .update({ sap_integration_locked_at: nowIso })
    .eq("id", id)
    .is("sap_doc_entry", null)
    .or(`sap_integration_locked_at.is.null,sap_integration_locked_at.lt.${cutoffIso}`)
    .select("id");
  if (error) throw new Error(`Falha ao adquirir lock em ${table}: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

export async function releaseIntegrationLock(
  supabase: any,
  table: "expenses" | "advance_payments",
  id: string,
): Promise<void> {
  try {
    await supabase.from(table).update({ sap_integration_locked_at: null }).eq("id", id);
  } catch (e) {
    console.warn(`[releaseIntegrationLock] ${table}/${id}:`, e);
  }
}
