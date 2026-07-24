// Rate limiting compartilhado para edge functions sensíveis.
//
// Uso:
//   import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
//   const rl = await enforceRateLimit(admin, {
//     scope: "sap-change-password",
//     identifier: callerId,      // user id / user_code / ip
//     max: 10,
//     windowSeconds: 60,
//   });
//   if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
//
// Estado guardado em `public.edge_rate_limits` via RPC atômica
// `check_and_increment_rate_limit` (service_role only). Falha silenciosa:
// se o Postgres retornar erro, liberamos a requisição para não derrubar
// o fluxo — o objetivo é conter abuso, não introduzir novo ponto de falha.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface RateLimitParams {
  scope: string;              // ex.: "sap-change-password"
  identifier: string;         // user id, email, ip — o que estiver disponível
  max: number;                // requisições permitidas por janela
  windowSeconds: number;      // duração da janela
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
  count: number;
  scope: string;
}

export async function enforceRateLimit(
  admin: SupabaseClient,
  params: RateLimitParams,
): Promise<RateLimitResult> {
  const key = `${params.scope}:${(params.identifier || "anon").toLowerCase()}`;
  try {
    const { data, error } = await admin.rpc("check_and_increment_rate_limit", {
      _key: key,
      _max: params.max,
      _window_seconds: params.windowSeconds,
    });
    if (error) {
      console.error("rate-limit rpc error", key, error.message);
      return { allowed: true, retryAfter: 0, count: 0, scope: params.scope };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed ?? true),
      retryAfter: Number(row?.retry_after ?? 0),
      count: Number(row?.current_count ?? 0),
      scope: params.scope,
    };
  } catch (e) {
    console.error("rate-limit exception", key, e);
    return { allowed: true, retryAfter: 0, count: 0, scope: params.scope };
  }
}

export function rateLimitResponse(
  result: RateLimitResult,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "Muitas requisições. Aguarde alguns instantes antes de tentar novamente.",
      retry_after: result.retryAfter,
      scope: result.scope,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, result.retryAfter)),
      },
    },
  );
}

/** Extrai um identificador estável para IP a partir do request. */
export function clientIpFrom(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || "unknown";
}
