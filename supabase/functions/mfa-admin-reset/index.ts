// F09: administrador (com segundo fator) redefine o segundo fator de outra pessoa
// que perdeu o celular, e consulta a situação de MFA dos administradores.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { AuthError, requireAdmin } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const foreign = rejectForeignOrigin(req, corsHeaders);
  if (foreign) return foreign;
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const actor = await requireAdmin(req); // requireUser já exige aal2 para admin
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; user_id?: unknown };
    const action = String(body.action ?? "");

    if (action === "overview") {
      const { data, error } = await svc.rpc("admin_mfa_overview");
      if (error) throw error;
      return json({ admins: data ?? [] });
    }

    if (action === "reset") {
      const target = String(body.user_id ?? "");
      if (!UUID_RE.test(target)) return json({ error: "Usuário inválido" }, 400);
      if (target === actor.id) return json({ error: "Peça a outro administrador para redefinir o seu." }, 400);

      const { data: list, error: lerr } = await svc.auth.admin.mfa.listFactors({ userId: target });
      if (lerr) throw lerr;
      const factors = list?.factors ?? [];
      for (const f of factors) {
        const { error } = await svc.auth.admin.mfa.deleteFactor({ userId: target, id: f.id });
        if (error) throw error;
      }
      await svc.rpc("insert_audit_log", {
        p_action: "mfa_factor_reset",
        p_entity_type: "user",
        p_entity_id: target,
        p_actor_email: actor.email,
        p_company_db: null,
        p_details: { removed_factors: factors.length },
      });
      return json({ ok: true, removed: factors.length });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    console.error("[mfa-admin-reset]", e instanceof Error ? e.message : e);
    return json({ error: "Falha ao processar" }, 500);
  }
});
