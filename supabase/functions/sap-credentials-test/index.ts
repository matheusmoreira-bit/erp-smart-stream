import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { AuthError, authErrorResponse, requireAdminOrSapAdmin } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireAdminOrSapAdmin(req);
    const requestedCompany = new URL(req.url).searchParams.get("company_db") || "";
    const callerCompany = "companyDB" in caller ? String(caller.companyDB || "") : "";
    if (callerCompany && requestedCompany && callerCompany !== requestedCompany) {
      throw new AuthError("Acesso negado para esta empresa", 403);
    }
    const companyDb = requestedCompany || callerCompany;
    if (!companyDb) throw new AuthError("Empresa não informada", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb);
    if (error) throw error;

    const credentials = Object.fromEntries((data || []).map((row) => [row.credential_key, row.credential_value]));
    const baseUrl = String(credentials.service_layer_url || "").replace(/\/+$/, "");
    const userName = String(credentials.username || "");
    const password = String(credentials.password || "");
    const loginCompany = String(credentials.company_db || companyDb);
    if (!baseUrl || !userName || !password || !loginCompany) {
      return Response.json({ ok: false, error: "Credenciais SAP incompletas" }, { status: 422, headers: corsHeaders });
    }

    const started = performance.now();
    const response = await fetch(`${baseUrl}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CompanyDB: loginCompany, UserName: userName, Password: password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.SessionId) {
      return Response.json({
        ok: false,
        status: response.status,
        error: payload?.error?.message?.value || "Falha no login SAP",
      }, { status: 502, headers: corsHeaders });
    }

    const route = response.headers.get("set-cookie")?.match(/ROUTEID=([^;]+)/)?.[1];
    await fetch(`${baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${payload.SessionId}${route ? `; ROUTEID=${route}` : ""}` },
    }).catch(() => undefined);

    return Response.json({
      ok: true,
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
      company_db: companyDb,
    }, { headers: corsHeaders });
  } catch (error) {
    return authErrorResponse(error, corsHeaders) ?? Response.json(
      { error: error instanceof Error ? error.message : "Erro interno" },
      { status: 500, headers: corsHeaders },
    );
  }
});
