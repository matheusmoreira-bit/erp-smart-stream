import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { deprovisionUser, logDeprovision } from "../_shared/idp-deprovision.ts";
import { listOktaUsers, type OktaCredentials } from "../_shared/okta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTEGRATION_KEY = "okta_sap_sync";

async function getOktaCredentials(supabase: ReturnType<typeof createClient>): Promise<OktaCredentials> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value, updated_at")
    .eq("system_name", "okta")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Erro ao buscar credenciais Okta: ${error.message}`);
  const values: Record<string, string> = {};
  for (const row of data || []) {
    if (!(row.credential_key in values)) values[row.credential_key] = row.credential_value;
  }
  if (!values.org_url || !values.client_id || !values.private_key) throw new Error("Credenciais Okta incompletas");
  return values as unknown as OktaCredentials;
}

async function getSapCredentials(supabase: ReturnType<typeof createClient>, companyDb?: string) {
  let query = supabase.from("system_credentials").select("credential_key, credential_value").eq("system_name", "sap");
  if (companyDb) query = query.eq("company_db", companyDb);
  const { data, error } = await query;
  if (error) throw new Error(`Erro ao buscar credenciais SAP: ${error.message}`);
  if (!data?.length) throw new Error("Credenciais SAP B1 nao configuradas");
  return Object.fromEntries(data.map((row) => [row.credential_key, row.credential_value]));
}

async function loginSap(credentials: Record<string, string>) {
  const baseUrl = credentials.base_url || credentials.service_layer_url || credentials.url;
  if (!baseUrl) throw new Error("URL do SAP B1 nao configurada");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: credentials.company_db || credentials.CompanyDB,
      UserName: credentials.username || credentials.UserName,
      Password: credentials.password || credentials.Password,
    }),
  });
  if (!response.ok) throw new Error(`SAP Login failed: ${response.status}`);
  return { baseUrl: baseUrl.replace(/\/$/, ""), cookies: response.headers.get("set-cookie") || "" };
}

async function lockSapUser(baseUrl: string, cookies: string, userCode: string) {
  const response = await fetch(`${baseUrl}/Users('${encodeURIComponent(userCode)}')`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({ Locked: "tYES" }),
  });
  return response.ok;
}

async function logExecution(
  supabase: ReturnType<typeof createClient>,
  status: string,
  details: Record<string, unknown>,
  affectedCount: number,
) {
  await supabase.from("synapse_execution_log").insert({
    integration_key: INTEGRATION_KEY,
    status,
    details,
    affected_count: affectedCount,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  if ((Deno.env.get("IDP_OFFBOARDING_ENABLED") || "").toLowerCase() !== "true") {
    return new Response(JSON.stringify({ message: "IdP offboarding desativado", disabled: true, results: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db || "");
    let configQuery = supabase.from("synapse_integrations").select("*").eq("integration_key", INTEGRATION_KEY);
    if (companyDb) configQuery = configQuery.eq("company_db", companyDb);
    const { data: config } = await configQuery.single();
    if (!config?.is_active) {
      return new Response(JSON.stringify({ message: "Integration is not active" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const users = await listOktaUsers(await getOktaCredentials(supabase));
    const usersById = new Map(users.map((user) => [user._id, user]));
    const { data: mappings, error: mappingsError } = await supabase
      .from("idp_user_mapping")
      .select("*")
      .eq("idp_provider", "okta")
      .eq("status", "linked");
    if (mappingsError) throw new Error(`Erro lendo idp_user_mapping: ${mappingsError.message}`);
    if (!mappings?.length) {
      await logExecution(supabase, "success", { message: "No linked users to check" }, 0);
      return new Response(JSON.stringify({ message: "No linked users" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toDisable = mappings.flatMap((mapping) => {
      const user = usersById.get(mapping.idp_user_id || "");
      if (user?.suspended) return [{ mapping, reason: `status ${user.status || "suspended"} no Okta` }];
      if (mapping.idp_user_id && !user) return [{ mapping, reason: "removido do Okta" }];
      return [];
    });
    if (toDisable.length === 0) {
      await logExecution(supabase, "success", { message: "No users to disable" }, 0);
      await supabase.from("synapse_integrations").update({
        last_run_at: new Date().toISOString(),
        last_run_status: "success",
        last_run_message: "Nenhum usuario para desabilitar",
      }).eq("integration_key", INTEGRATION_KEY);
      return new Response(JSON.stringify({ message: "No users to disable", checked: mappings.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sap: { baseUrl: string; cookies: string } | null = null;
    let sapError: string | null = null;
    try {
      sap = await loginSap(await getSapCredentials(supabase, companyDb || undefined));
    } catch (error) {
      sapError = error instanceof Error ? error.message : String(error);
      console.warn("[synapse-okta-sync] SAP indisponivel, seguindo com desprovisionamento:", sapError);
    }

    const results = [];
    for (const { mapping, reason } of toDisable) {
      let locked = false;
      let sapLockError: string | undefined;
      try {
        if (sap) locked = await lockSapUser(sap.baseUrl, sap.cookies, mapping.sap_user_code);
        else sapLockError = `SAP indisponivel: ${sapError}`;
      } catch (error) {
        sapLockError = error instanceof Error ? error.message : String(error);
      }

      const target = {
        mappingId: mapping.id,
        companyDb: mapping.company_db || companyDb || null,
        idpProvider: "okta",
        idpUserId: mapping.idp_user_id,
        sapUserCode: mapping.sap_user_code,
        email: mapping.sap_email || mapping.idp_email || null,
        reason,
        source: INTEGRATION_KEY,
        sapLocked: locked,
      };
      const revoked = await deprovisionUser(supabase, target);
      await logDeprovision(supabase, target, revoked);
      results.push({
        userCode: mapping.sap_user_code,
        success: revoked.errors.length === 0,
        reason,
        revoked: {
          grupos: revoked.groupsRevoked,
          substituicoes: revoked.substitutionsRevoked,
          credenciais: revoked.credentialsRevoked,
          centros_custo: revoked.costCentersRevoked,
          dispositivos_push: revoked.pushDevicesRevoked,
          regras_orfas: revoked.approvalRulesOrphaned,
        },
        error: [sapLockError, ...revoked.errors].filter(Boolean).join(" | ") || undefined,
      });
    }

    const successCount = results.filter((result) => result.success).length;
    const message = `${successCount}/${toDisable.length} usuarios desprovisionados`;
    await logExecution(supabase, successCount === toDisable.length ? "success" : "partial", { results }, successCount);
    await supabase.from("synapse_integrations").update({
      last_run_at: new Date().toISOString(),
      last_run_status: successCount === toDisable.length ? "success" : "partial",
      last_run_message: message,
    }).eq("integration_key", INTEGRATION_KEY);
    return new Response(JSON.stringify({ message, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    await logExecution(supabase, "error", { error: message }, 0).catch(() => {});
    await supabase.from("synapse_integrations").update({
      last_run_at: new Date().toISOString(),
      last_run_status: "error",
      last_run_message: message,
    }).eq("integration_key", INTEGRATION_KEY).catch(() => {});
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
