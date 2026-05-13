import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TTL_MS = 24 * 60 * 60 * 1000;

interface SLUser { InternalKey?: number; UserCode?: string; UserName?: string; eMail?: string }
interface SLTemplate { Code?: number; Name?: string }
interface SLStage { Code?: number; Name?: string }

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function login(baseUrl: string, companyDB: string, username: string, password: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: username, Password: password, CompanyDB: companyDB }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Login falhou ${r.status}: ${t.slice(0, 200)}`);
  }
  await r.json();
  const setCookie = r.headers.get("set-cookie") || "";
  const session = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const route = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
  if (!session) throw new Error("B1SESSION ausente");
  return `B1SESSION=${session}${route ? `; ROUTEID=${route}` : ""}`;
}

async function logout(baseUrl: string, cookie: string) {
  await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
}

async function slGet<T>(baseUrl: string, cookie: string, path: string): Promise<T> {
  const r = await fetch(`${baseUrl}/${path}`, { headers: { Cookie: cookie, "Content-Type": "application/json" } });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GET ${path} ${r.status}: ${t.slice(0, 200)}`);
  }
  return await r.json() as T;
}

async function refreshCompany(
  sb: ReturnType<typeof createClient>,
  appCompanyDb: string,
  creds: Record<string, string>,
): Promise<{ users: number; templates: number; stages: number }> {
  const baseUrl = buildBaseUrl(creds.service_layer_url);
  const sapCompanyDb = creds.company_db || appCompanyDb;
  const cookie = await login(baseUrl, sapCompanyDb, creds.username, creds.password);

  try {
    const usersResp = await slGet<{ value: SLUser[] }>(
      baseUrl, cookie,
      "Users?$select=InternalKey,UserCode,UserName,eMail&$top=500",
    );
    const tplResp = await slGet<{ value: SLTemplate[] }>(
      baseUrl, cookie,
      "ApprovalTemplates?$select=Code,Name&$top=200",
    );
    const stagesResp = await slGet<{ value: SLStage[] }>(
      baseUrl, cookie,
      "ApprovalStages?$select=Code,Name&$top=200",
    );

    const users = usersResp.value || [];
    const templates = tplResp.value || [];
    const stages = stagesResp.value || [];

    const stageApprovers: Record<string, number[]> = {};
    for (const s of stages) {
      if (typeof s.Code !== "number") continue;
      try {
        const detail = await slGet<{ StageApprovers?: Array<{ UserCode?: number }> }>(
          baseUrl, cookie,
          `ApprovalStages(${s.Code})?$select=Code,StageApprovers`,
        );
        stageApprovers[String(s.Code)] = (detail.StageApprovers || [])
          .map((a) => Number(a.UserCode))
          .filter((n) => Number.isFinite(n) && n > 0);
      } catch (e) {
        console.warn(`StageApprovers ${s.Code} falhou:`, (e as Error).message);
      }
    }

    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const rows = [
      { cache_key: "sl_users", company_db: appCompanyDb, data: users, expires_at: expiresAt },
      { cache_key: "sl_templates", company_db: appCompanyDb, data: templates, expires_at: expiresAt },
      { cache_key: "sl_stages", company_db: appCompanyDb, data: stages, expires_at: expiresAt },
      { cache_key: "sl_stage_approvers", company_db: appCompanyDb, data: stageApprovers, expires_at: expiresAt },
    ];
    const { error } = await sb.from("sap_cache").upsert(rows, { onConflict: "cache_key,company_db" });
    if (error) throw new Error(`Upsert sap_cache: ${error.message}`);

    return { users: users.length, templates: templates.length, stages: stages.length };
  } finally {
    await logout(baseUrl, cookie);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // 1) Empresas SAP sem middleware HANA
    const { data: flags, error: flagErr } = await sb
      .from("system_credentials")
      .select("company_db")
      .eq("system_name", "sap")
      .eq("credential_key", "use_hana_db")
      .eq("credential_value", "false");
    if (flagErr) throw new Error(flagErr.message);

    const companyDbs = (flags || []).map((r) => r.company_db).filter(Boolean) as string[];
    const results: Array<Record<string, unknown>> = [];

    for (const companyDb of companyDbs) {
      try {
        const { data: credRows, error: credErr } = await sb
          .from("system_credentials")
          .select("credential_key,credential_value")
          .eq("system_name", "sap")
          .eq("company_db", companyDb);
        if (credErr) throw new Error(credErr.message);

        const creds: Record<string, string> = {};
        for (const row of credRows || []) {
          creds[row.credential_key as string] = row.credential_value as string;
        }
        if (!creds.username || !creds.password || !creds.service_layer_url) {
          results.push({ companyDb, status: "skipped", reason: "credenciais incompletas" });
          continue;
        }

        const stats = await refreshCompany(sb, companyDb, creds);
        results.push({ companyDb, status: "success", ...stats });
      } catch (e) {
        results.push({ companyDb, status: "error", error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
