// Sincroniza periodicamente os atributos dos usuarios Okta vinculados.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { listOktaUsers, type OktaCredentials } from "../_shared/okta.ts";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WATCHER_NAME = "okta-attributes-sync";
const INTEGRATION_KEY = "okta_attributes_sync";

function parseCostCenterCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([^\s-]+)/);
  return match ? match[1] : trimmed;
}

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
  if (!values.org_url || !values.client_id || !values.private_key) {
    throw new Error("Credenciais Okta incompletas");
  }
  return values as unknown as OktaCredentials;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const gotLock = await tryWatcherLock(supabase, WATCHER_NAME, 10);
  if (!gotLock) {
    return new Response(JSON.stringify({ skipped: true, reason: "another run in progress" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = new Date().toISOString();
  let updatedCount = 0;
  let checkedCount = 0;
  let missingCount = 0;

  try {
    const users = await listOktaUsers(await getOktaCredentials(supabase));
    const usersById = new Map(users.map((user) => [user._id, user]));
    const { data: mappings, error: mappingsError } = await supabase
      .from("idp_user_mapping")
      .select("id, idp_user_id, department, cost_center_code, cost_center_label, job_title, company_name, employee_id, employee_type, manager_idp_id")
      .eq("idp_provider", "okta")
      .eq("status", "linked")
      .not("idp_user_id", "is", null);
    if (mappingsError) throw new Error(`Erro lendo idp_user_mapping: ${mappingsError.message}`);

    const now = new Date().toISOString();
    for (const mapping of mappings || []) {
      checkedCount++;
      const user = usersById.get(mapping.idp_user_id as string);
      if (!user) {
        missingCount++;
        continue;
      }
      const next = {
        employee_id: user.employeeIdentifier || null,
        employee_type: user.employeeType || null,
        job_title: user.jobTitle || null,
        company_name: user.company || null,
        department: user.department || null,
        cost_center_code: parseCostCenterCode(user.costCenter),
        cost_center_label: user.costCenter || null,
        manager_idp_id: user.manager || null,
      };
      const changed =
        next.employee_id !== mapping.employee_id ||
        next.employee_type !== mapping.employee_type ||
        next.job_title !== mapping.job_title ||
        next.company_name !== mapping.company_name ||
        next.department !== mapping.department ||
        next.cost_center_code !== mapping.cost_center_code ||
        next.cost_center_label !== mapping.cost_center_label ||
        next.manager_idp_id !== mapping.manager_idp_id;
      if (!changed) continue;

      const { error: updateError } = await supabase
        .from("idp_user_mapping")
        .update({ ...next, attributes_synced_at: now })
        .eq("id", mapping.id);
      if (updateError) {
        console.error(`[okta-attributes-sync] update ${mapping.id} falhou: ${updateError.message}`);
        continue;
      }
      updatedCount++;
    }

    const message = `checked=${checkedCount} updated=${updatedCount} missing_in_okta=${missingCount}`;
    await supabase.from("synapse_execution_log").insert({
      integration_key: INTEGRATION_KEY,
      status: "success",
      details: { checkedCount, updatedCount, missingCount, oktaUserCount: users.length, startedAt },
      affected_count: updatedCount,
    });
    await supabase.from("synapse_integrations").update({
      last_run_at: now,
      last_run_status: "success",
      last_run_message: message,
    }).eq("integration_key", INTEGRATION_KEY);
    await releaseWatcherLock(supabase, WATCHER_NAME, "ok", message);

    return new Response(JSON.stringify({ ok: true, checkedCount, updatedCount, missingCount, oktaUserCount: users.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    const isCredential = /Okta:|Credenciais Okta/.test(message);
    console.error("[okta-attributes-sync]", message);
    await supabase.from("synapse_execution_log").insert({
      integration_key: INTEGRATION_KEY,
      status: "error",
      details: { error: message, checkedCount, updatedCount, credential_error: isCredential },
      affected_count: updatedCount,
    }).then(() => {}, () => {});
    await supabase.from("synapse_integrations").update({
      last_run_at: new Date().toISOString(),
      last_run_status: isCredential ? "credentials_error" : "error",
      last_run_message: message,
    }).eq("integration_key", INTEGRATION_KEY).then(() => {}, () => {});
    await releaseWatcherLock(supabase, WATCHER_NAME, "error", message);
    return new Response(JSON.stringify({ error: message, code: isCredential ? "OKTA_CREDENTIALS_INVALID" : undefined }), {
      status: isCredential ? 424 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
