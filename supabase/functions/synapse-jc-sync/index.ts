import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getJumpCloudCredentials(supabase: ReturnType<typeof createClient>, companyDb?: string) {
  let query = supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "jumpcloud");
  if (companyDb) query = query.eq("company_db", companyDb);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao buscar credenciais JumpCloud: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais JumpCloud não configuradas");

  const creds: Record<string, string> = {};
  for (const row of data) creds[row.credential_key] = row.credential_value;
  if (!creds.api_key) throw new Error("API Key do JumpCloud não configurada");
  return creds;
}

async function getSapCredentials(supabase: ReturnType<typeof createClient>, companyDb?: string) {
  let query = supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap");
  if (companyDb) query = query.eq("company_db", companyDb);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao buscar credenciais SAP: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais SAP B1 não configuradas");

  const creds: Record<string, string> = {};
  for (const row of data) creds[row.credential_key] = row.credential_value;
  return creds;
}

async function fetchAllJumpCloudUsers(apiKey: string, orgId?: string) {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (orgId) headers["x-org-id"] = orgId;

  const allUsers: Array<{ _id: string; email: string; suspended?: boolean; username: string }> = [];
  let skip = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const resp = await fetch(
      `https://console.jumpcloud.com/api/systemusers?limit=${limit}&skip=${skip}&fields=_id email username suspended`,
      { headers }
    );
    if (!resp.ok) throw new Error(`JumpCloud API error: ${resp.status}`);
    const data = await resp.json();
    const results = data.results || data || [];
    allUsers.push(...results);
    hasMore = results.length === limit;
    skip += limit;
    if (allUsers.length > 5000) break;
  }
  return allUsers;
}

async function loginSap(sapCreds: Record<string, string>) {
  const baseUrl = sapCreds.base_url || sapCreds.url;
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");

  const companyDB = sapCreds.company_db || sapCreds.CompanyDB;
  const userName = sapCreds.username || sapCreds.UserName;
  const password = sapCreds.password || sapCreds.Password;

  const loginResp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
  });

  if (!loginResp.ok) throw new Error(`SAP Login failed: ${loginResp.status}`);
  const cookies = loginResp.headers.get("set-cookie") || "";
  return { baseUrl, cookies, companyDB };
}

async function lockSapUser(baseUrl: string, cookies: string, userCode: string) {
  const resp = await fetch(`${baseUrl}/Users('${userCode}')`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
    body: JSON.stringify({ Locked: "tYES" }),
  });
  return resp.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Get company_db from request body
    let bodyCompanyDB = "";
    try {
      const body = await req.json();
      bodyCompanyDB = body.company_db || "";
    } catch { /* no body */ }

    // Check if integration is active for this company
    let query = supabase
      .from("synapse_integrations")
      .select("*")
      .eq("integration_key", "jumpcloud_sap_sync");
    if (bodyCompanyDB) query = query.eq("company_db", bodyCompanyDB);
    const { data: config } = await query.single();

    if (!config?.is_active) {
      return new Response(JSON.stringify({ message: "Integration is not active" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch JumpCloud users
    const jcCreds = await getJumpCloudCredentials(supabase, bodyCompanyDB || undefined);
    const jcUsers = await fetchAllJumpCloudUsers(jcCreds.api_key, jcCreds.org_id);

    // 2. Get linked mappings
    const { data: mappings } = await supabase
      .from("idp_user_mapping")
      .select("*")
      .eq("idp_provider", "jumpcloud")
      .eq("status", "linked");

    if (!mappings || mappings.length === 0) {
      await logExecution(supabase, "success", { message: "No linked users to check" }, 0);
      return new Response(JSON.stringify({ message: "No linked users" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Find suspended JC users that are linked
    const jcById = new Map(jcUsers.map((u) => [u._id, u]));
    const toDisable = mappings.filter((m) => {
      const jc = jcById.get(m.idp_user_id || "");
      return jc?.suspended === true;
    });

    if (toDisable.length === 0) {
      await logExecution(supabase, "success", { message: "No users to disable" }, 0);
      await supabase
        .from("synapse_integrations")
        .update({ last_run_at: new Date().toISOString(), last_run_status: "success", last_run_message: "Nenhum usuário para desabilitar" })
        .eq("integration_key", "jumpcloud_sap_sync");

      return new Response(JSON.stringify({ message: "No users to disable", checked: mappings.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Login to SAP and disable users
    const sapCreds = await getSapCredentials(supabase, bodyCompanyDB || undefined);
    const sap = await loginSap(sapCreds);

    const results: Array<{ userCode: string; success: boolean; error?: string }> = [];

    for (const mapping of toDisable) {
      try {
        const ok = await lockSapUser(sap.baseUrl, sap.cookies, mapping.sap_user_code);
        results.push({ userCode: mapping.sap_user_code, success: ok });

        // Update mapping status
        if (ok) {
          await supabase
            .from("idp_user_mapping")
            .update({ status: "disabled_by_idp" })
            .eq("id", mapping.id);
        }
      } catch (e) {
        results.push({ userCode: mapping.sap_user_code, success: false, error: (e as Error).message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const msg = `${successCount}/${toDisable.length} usuários desabilitados`;

    await logExecution(supabase, successCount === toDisable.length ? "success" : "partial", { results }, successCount);
    await supabase
      .from("synapse_integrations")
      .update({ last_run_at: new Date().toISOString(), last_run_status: "success", last_run_message: msg })
      .eq("integration_key", "jumpcloud_sap_sync");

    return new Response(JSON.stringify({ message: msg, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    await logExecution(supabase, "error", { error: message }, 0).catch(() => {});
    await supabase
      .from("synapse_integrations")
      .update({ last_run_at: new Date().toISOString(), last_run_status: "error", last_run_message: message })
      .eq("integration_key", "jumpcloud_sap_sync")
      .catch(() => {});

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function logExecution(
  supabase: ReturnType<typeof createClient>,
  status: string,
  details: Record<string, unknown>,
  affectedCount: number
) {
  await supabase.from("synapse_execution_log").insert({
    integration_key: "jumpcloud_sap_sync",
    status,
    details,
    affected_count: affectedCount,
  });
}
