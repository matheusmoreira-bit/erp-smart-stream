// Lightweight edge-function metrics recorder.
// Writes one row per invocation to public.edge_function_metrics using the
// service role. Never throws — observability must not break the request.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

let _sb: ReturnType<typeof createClient> | null = null;
function sb() {
  if (_sb) return _sb;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

export interface EdgeMetric {
  functionName: string;
  durationMs: number;
  statusCode?: number;
  ok: boolean;
  companyDb?: string | null;
  errorCode?: string | null;
  meta?: Record<string, unknown> | null;
}

export function recordEdgeMetric(m: EdgeMetric): void {
  // Fire-and-forget; never await in the hot path.
  try {
    const client = sb();
    if (!client) return;
    void client.from("edge_function_metrics").insert({
      function_name: m.functionName,
      duration_ms: Math.max(0, Math.round(m.durationMs)),
      status_code: m.statusCode ?? null,
      ok: m.ok,
      company_db: m.companyDb ?? null,
      error_code: m.errorCode ?? null,
      meta: m.meta ?? null,
    }).then(({ error }) => {
      if (error) console.warn("[edge-metrics] insert failed:", error.message);
    });
  } catch (e) {
    console.warn("[edge-metrics] recorder crashed:", (e as Error).message);
  }
}

/**
 * Wraps a Deno.serve handler and records duration + status for every call.
 * The wrapped function receives an optional `metricsCtx` you can mutate with
 * companyDb / errorCode before returning, and it will be flushed automatically.
 */
export type MetricsCtx = {
  companyDb?: string | null;
  errorCode?: string | null;
  meta?: Record<string, unknown> | null;
};

export function withEdgeMetrics(
  functionName: string,
  handler: (req: Request, ctx: MetricsCtx) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const started = performance.now();
    const ctx: MetricsCtx = {};
    let status = 0;
    try {
      const resp = await handler(req, ctx);
      status = resp.status;
      return resp;
    } catch (e) {
      status = 500;
      ctx.errorCode = ctx.errorCode ?? (e instanceof Error ? e.name : "unknown");
      throw e;
    } finally {
      const dur = performance.now() - started;
      // Skip CORS preflight — they'd dominate the sample noise.
      if (req.method !== "OPTIONS") {
        recordEdgeMetric({
          functionName,
          durationMs: dur,
          statusCode: status || undefined,
          ok: status > 0 && status < 400,
          companyDb: ctx.companyDb,
          errorCode: ctx.errorCode,
          meta: ctx.meta,
        });
      }
    }
  };
}
