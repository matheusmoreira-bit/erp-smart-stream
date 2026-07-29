// Emite tokens anti-CSRF de uso único para operações sensíveis.
//
// Requer chamador autenticado (Cloud user ou sessão SAP válida) e origem na
// allowlist. O token é vinculado ao próprio chamador e a um `purpose`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
import { requireUserOrSapSession, authErrorResponse } from "../_shared/auth.ts";
import { rejectForeignOrigin, corsFor } from "../_shared/cors-allowlist.ts";
import { enforceRateLimit, rateLimitResponse, clientIpFrom } from "../_shared/rate-limit.ts";
import { issueCsrfToken } from "../_shared/csrf.ts";

const ALLOWED_PURPOSES = new Set(["sap-change-password"]);

Deno.serve(withEdgeMetrics("security-csrf-token", async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;

  try {
    const caller = await requireUserOrSapSession(req);
    const subject = (caller as { userName?: string; email?: string }).userName
      || (caller as { email?: string }).email
      || (caller as { id?: string }).id
      || "";
    if (!subject) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const rl = await enforceRateLimit(admin, {
      scope: "security-csrf-token",
      identifier: subject || clientIpFrom(req),
      max: 30,
      windowSeconds: 300,
    });
    if (!rl.allowed) return rateLimitResponse(rl, cors);

    const body = await req.json().catch(() => ({} as { purpose?: string }));
    const purpose = String(body.purpose || "").trim();
    if (!ALLOWED_PURPOSES.has(purpose)) {
      return new Response(JSON.stringify({ error: "purpose inválido" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const issued = await issueCsrfToken(admin, purpose, subject);
    return new Response(JSON.stringify(issued), {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const authResp = authErrorResponse(err, cors);
    if (authResp) return authResp;
    console.error("[security-csrf-token] error", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
}));
