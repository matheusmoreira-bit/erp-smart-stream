// Edge function: mastertax-test
// Testa as credenciais do Master Tax salvas em system_credentials para a empresa.
// Faz uma chamada HEAD/GET no base_url com o token configurado e retorna status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { AuthError, requireAdminOrSapAdmin, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireAdminOrSapAdmin(req);
    const callerCompanyDb =
      typeof (caller as { companyDB?: unknown }).companyDB === "string"
        ? (caller as { companyDB: string }).companyDB
        : null;

    const url = new URL(req.url);
    const companyDb = url.searchParams.get("company_db") || callerCompanyDb;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = admin
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "mastertax");
    q = companyDb ? q.eq("company_db", companyDb) : q.is("company_db", null);
    const { data: rows, error } = await q;
    if (error) throw error;

    if (!rows || rows.length === 0) {
      return json({ ok: false, error: "Nenhuma credencial Master Tax cadastrada para esta empresa." }, 404);
    }

    const creds: Record<string, string> = {};
    for (const r of rows) creds[r.credential_key] = r.credential_value ?? "";

    const baseUrl = (creds.base_url || "").trim();
    const token = (creds.token || "").trim();
    const username = (creds.username || "").trim();
    const password = (creds.password || "").trim();

    if (!baseUrl) return json({ ok: false, error: "URL Base não configurada." }, 400);
    if (!token && !(username && password)) {
      return json({ ok: false, error: "Configure um Token ou Usuário + Senha." }, 400);
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) {
      headers.Authorization = token.toLowerCase().startsWith("bearer ")
        ? token
        : `Bearer ${token}`;
    } else {
      headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
    }

    const target = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    const started = Date.now();
    let resp: Response;
    try {
      resp = await fetch(target, { method: "GET", headers, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      return json({
        ok: false,
        error: `Falha de rede ao acessar ${target}: ${e instanceof Error ? e.message : String(e)}`,
      }, 502);
    }
    const elapsedMs = Date.now() - started;
    const bodyText = await resp.text().catch(() => "");
    const preview = bodyText.slice(0, 500);

    const ok = resp.status >= 200 && resp.status < 400 || resp.status === 401 === false;
    // Treat 2xx/3xx as success; 401/403 = credenciais inválidas; outros = erro
    const success = resp.ok;

    return json({
      ok: success,
      status: resp.status,
      statusText: resp.statusText,
      elapsedMs,
      url: target,
      authMode: token ? "bearer" : "basic",
      bodyPreview: preview,
      hint: success
        ? "Conexão OK"
        : resp.status === 401 || resp.status === 403
          ? "Credenciais rejeitadas pelo servidor."
          : `HTTP ${resp.status} — verifique URL/token.`,
    }, success ? 200 : 200);
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[mastertax-test] error:", err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
