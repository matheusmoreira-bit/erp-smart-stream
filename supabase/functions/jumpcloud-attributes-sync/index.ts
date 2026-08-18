// Sincroniza periodicamente os atributos (department, cost_center_code, jobTitle, etc.)
// dos usuários vinculados em public.idp_user_mapping a partir do JumpCloud.
// Invocado por pg_cron (a cada 30 minutos) e também disponível on-demand.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authErrorResponse, requireSchedulerOrAdminOrSapModule } from "../_shared/auth.ts";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WATCHER_NAME = "jumpcloud-attributes-sync";

type JcUser = {
  _id: string;
  email?: string;
  username?: string;
  displayname?: string;
  firstname?: string;
  lastname?: string;
  suspended?: boolean;
  department?: string;
  costCenter?: string;
  jobTitle?: string;
  company?: string;
  employeeIdentifier?: string;
  employeeType?: string;
  manager?: string;
};

function parseCostCenterCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^([^\s-]+)/);
  return m ? m[1] : trimmed;
}

async function fetchAllJumpCloudUsers(apiKey: string, orgId?: string): Promise<JcUser[]> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (orgId) headers["x-org-id"] = orgId;

  const all: JcUser[] = [];
  let skip = 0;
  const limit = 100;
  let hasMore = true;
  const fields =
    "_id email username displayname firstname lastname suspended department costCenter jobTitle company employeeIdentifier employeeType manager";

  while (hasMore) {
    const resp = await fetch(
      `https://console.jumpcloud.com/api/systemusers?limit=${limit}&skip=${skip}&fields=${encodeURIComponent(fields)}`,
      { headers }
    );
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`JumpCloud API ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    const results: JcUser[] = data.results || data || [];
    all.push(...results);
    hasMore = results.length === limit;
    skip += limit;
    if (all.length > 10000) break;
  }
  return all;
}

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
  for (const row of data) creds[row.credential_key as string] = row.credential_value as string;
  if (!creds.api_key) throw new Error("API Key do JumpCloud não configurada");
  return creds;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireSchedulerOrAdminOrSapModule(req, "synapse");
  } catch (error) {
    return authErrorResponse(error, corsHeaders) ?? new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const body = await req.json().catch(() => ({}));
  const companyDb = typeof body.company_db === "string" ? body.company_db.trim() : "";

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
    const creds = await getJumpCloudCredentials(supabase, companyDb || undefined);
    const jcUsers = await fetchAllJumpCloudUsers(creds.api_key, creds.org_id);
    const jcById = new Map<string, JcUser>();
    for (const jc of jcUsers) jcById.set(jc._id, jc);

    // Todos os mapeamentos linkados (independente de empresa)
    let mappingsQuery = supabase
      .from("idp_user_mapping")
      .select("id, idp_user_id, department, cost_center_code, cost_center_label, job_title, company_name, employee_id, employee_type, manager_idp_id")
      .eq("idp_provider", "jumpcloud")
      .eq("status", "linked")
      .not("idp_user_id", "is", null);
    if (companyDb) mappingsQuery = mappingsQuery.eq("company_db", companyDb);
    const { data: mappings, error: mErr } = await mappingsQuery;

    if (mErr) throw new Error(`Erro lendo idp_user_mapping: ${mErr.message}`);

    const now = new Date().toISOString();
    for (const m of mappings || []) {
      checkedCount++;
      const jc = jcById.get(m.idp_user_id as string);
      if (!jc) {
        missingCount++;
        continue;
      }
      const next = {
        employee_id: jc.employeeIdentifier || null,
        employee_type: jc.employeeType || null,
        job_title: jc.jobTitle || null,
        company_name: jc.company || null,
        department: jc.department || null,
        cost_center_code: parseCostCenterCode(jc.costCenter),
        cost_center_label: jc.costCenter || null,
        manager_idp_id: jc.manager || null,
      };

      // Só atualiza se algo mudou (evita rewrite + audit noise)
      const changed =
        next.employee_id !== m.employee_id ||
        next.employee_type !== m.employee_type ||
        next.job_title !== m.job_title ||
        next.company_name !== m.company_name ||
        next.department !== m.department ||
        next.cost_center_code !== m.cost_center_code ||
        next.cost_center_label !== m.cost_center_label ||
        next.manager_idp_id !== m.manager_idp_id;

      if (!changed) continue;

      const { error: uErr } = await supabase
        .from("idp_user_mapping")
        .update({ ...next, attributes_synced_at: now })
        .eq("id", m.id);
      if (uErr) {
        console.error(`update ${m.id} falhou: ${uErr.message}`);
        continue;
      }
      updatedCount++;
    }

    const message = `checked=${checkedCount} updated=${updatedCount} missing_in_jc=${missingCount}`;

    await supabase.from("synapse_execution_log").insert({
      integration_key: "jumpcloud_attributes_sync",
      company_db: companyDb || null,
      status: "success",
      details: { checkedCount, updatedCount, missingCount, jcUserCount: jcUsers.length, startedAt },
      affected_count: updatedCount,
    });

    let successStatusQuery = supabase
      .from("synapse_integrations")
      .update({
        last_run_at: now,
        last_run_status: "success",
        last_run_message: message,
      })
      .eq("integration_key", "jumpcloud_attributes_sync");
    if (companyDb) successStatusQuery = successStatusQuery.eq("company_db", companyDb);
    await successStatusQuery;

    await releaseWatcherLock(supabase, WATCHER_NAME, "ok", message);
    return new Response(
      JSON.stringify({ ok: true, checkedCount, updatedCount, missingCount, jcUserCount: jcUsers.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[jumpcloud-attributes-sync]", message);
    await supabase.from("synapse_execution_log").insert({
      integration_key: "jumpcloud_attributes_sync",
      company_db: companyDb || null,
      status: "error",
      details: { error: message, checkedCount, updatedCount },
      affected_count: updatedCount,
    }).then(() => {}, () => {});
    let errorStatusQuery = supabase
      .from("synapse_integrations")
      .update({ last_run_at: new Date().toISOString(), last_run_status: "error", last_run_message: message })
      .eq("integration_key", "jumpcloud_attributes_sync");
    if (companyDb) errorStatusQuery = errorStatusQuery.eq("company_db", companyDb);
    await errorStatusQuery.then(() => {}, () => {});
    await releaseWatcherLock(supabase, WATCHER_NAME, "error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
