import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import { encryptSecret } from "../_shared/sap-cred-crypto.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function service() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    const admin = service();
    const url = new URL(req.url);

    if (req.method === "GET") {
      const companyDb = url.searchParams.get("company_db");
      let q = admin
        .from("user_sap_credentials")
        .select("company_db, sap_user, updated_at")
        .eq("user_id", user.id);
      if (companyDb) q = q.eq("company_db", companyDb);
      const { data, error } = await q;
      if (error) throw error;
      return json({ credentials: data });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const companyDb = typeof body.company_db === "string" ? body.company_db.trim() : "";
      const sapUser = typeof body.sap_user === "string" ? body.sap_user.trim() : "";
      const sapPassword = typeof body.sap_password === "string" ? body.sap_password : "";
      if (!companyDb || !sapUser || !sapPassword) return json({ error: "company_db, sap_user e sap_password são obrigatórios" }, 400);
      if (sapUser.length > 40 || sapPassword.length > 200) return json({ error: "sap_user/sap_password muito longos" }, 400);

      const encrypted = await encryptSecret(sapPassword);
      const { error } = await admin.from("user_sap_credentials").upsert(
        { user_id: user.id, company_db: companyDb, sap_user: sapUser, sap_password_encrypted: encrypted, updated_at: new Date().toISOString() },
        { onConflict: "user_id,company_db" },
      );
      if (error) throw error;
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const companyDb = typeof body.company_db === "string" ? body.company_db.trim() : "";
      if (!companyDb) return json({ error: "company_db obrigatório" }, 400);
      const { error } = await admin.from("user_sap_credentials")
        .delete().eq("user_id", user.id).eq("company_db", companyDb);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[sap-user-credentials]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
