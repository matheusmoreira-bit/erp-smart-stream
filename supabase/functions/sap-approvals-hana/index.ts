// Edge function: sap-approvals-hana
// Consulta a view VW_APROVACOES_DETALHADAS via HanaAPI V2 usando a sessão
// SAP do usuário logado. Se a sessão do usuário estiver expirada (401 na HANA),
// retorna 401 com código SAP_SESSION_EXPIRED para que o cliente redirecione
// o usuário à tela de login — NÃO fazemos fallback com apiuser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchHanaView } from "../_shared/hana-views.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-company-db",
};

const HANA_SCHEMA_OVERRIDES: Record<string, string> = {
  open_gaming_sa: "SBO_OPENGAMING",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const companyDb: string | undefined =
      body?.company_db || url.searchParams.get("company_db") ||
      req.headers.get("x-company-db") || undefined;
    const sessionId: string | undefined =
      body?.session_id || url.searchParams.get("session_id") ||
      req.headers.get("x-sap-session") || undefined;
    const schemaOverride: string | undefined =
      body?.schema || url.searchParams.get("schema") || undefined;

    if (!companyDb) {
      return new Response(JSON.stringify({ error: "company_db obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Sessão SAP inválida ou expirada. Faça login novamente.", code: "SAP_SESSION_EXPIRED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: credsRows } = await sb
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb);
    const creds: Record<string, string> = {};
    for (const r of (credsRows || []) as Array<{ credential_key: string; credential_value: string }>) {
      creds[r.credential_key] = r.credential_value ?? "";
    }

    const schema = schemaOverride || HANA_SCHEMA_OVERRIDES[companyDb] || companyDb;

    try {
      const rows = await fetchHanaView({
        schema,
        view: "VW_APROVACOES_DETALHADAS",
        sessionId,
        hanaApiUrl: creds.hana_api_url || null,
      });
      return new Response(JSON.stringify({ schema, data: rows }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/401/.test(msg) && /Session/i.test(msg)) {
        console.log(`[sap-approvals-hana] sessão SAP expirada (companyDb=${companyDb}) → redirecionar login`);
        return new Response(
          JSON.stringify({ error: "Sessão SAP inválida ou expirada. Faça login novamente.", code: "SAP_SESSION_EXPIRED" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }
  } catch (e) {
    console.error("[sap-approvals-hana] error", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
