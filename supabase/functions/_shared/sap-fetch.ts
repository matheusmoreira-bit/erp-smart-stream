import { requireHttpsEndpoint } from "./secure-transport.ts";
// Helper compartilhado para chamadas ao SAP Service Layer.
// - timeout via AbortSignal (default 30s)
// - retry somente de GET/HEAD; escritas incertas exigem reconciliação
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
    maxAttempts: requestedAttempts = 3,
    baseDelayMs = 1000,
    signal: externalSignal,
    ...init
  } = options;

  // Validate origin independently of OData query parameters.
  const endpoint = new URL(url);
  requireHttpsEndpoint(endpoint.origin);
  if (endpoint.username || endpoint.password) throw new Error("Credenciais na URL SAP não são permitidas.");
  const method = (init.method || "GET").toUpperCase();
  // An uncertain write may already have committed. Only reads can be retried here.
  const maxAttempts = ["GET", "HEAD"].includes(method)
    ? Math.min(5, Math.max(1, Math.floor(requestedAttempts) || 1)) : 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`SAP timeout após ${timeoutMs}ms`)), timeoutMs);
    const onAbort = () => ctrl.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
      else externalSignal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      if (ctrl.signal.aborted) throw ctrl.signal.reason;
      const res = await fetch(url, { ...init, redirect: "error", signal: ctrl.signal });
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
      if (externalSignal?.aborted || attempt >= maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[sapFetch] ${url} -> erro de rede (${msg}), retry ${attempt}/${maxAttempts - 1} em ${delay}ms`);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
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
  ttlMinutes = 15,
): Promise<boolean> {
  const cutoffIso = new Date(Date.now() - ttlMinutes * 60_000).toISOString();
  const nowIso = new Date().toISOString();
  const { count, error } = await supabase
    .from(table)
    .update({ sap_integration_locked_at: nowIso }, { count: "exact" })
    .eq("id", id)
    .is("sap_doc_entry", null)
    .or(`sap_integration_locked_at.is.null,sap_integration_locked_at.lt.${cutoffIso}`);
  if (error) throw new Error(`Falha ao adquirir lock em ${table}: ${error.message}`);
  return Number(count || 0) > 0;
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
