// Intercompany module — reads/creates Chart of Accounts and Profit Centers
// across ALL active SAP companies using each company's SAP service credential
// stored in `system_credentials` (system_name = 'sap'). Best-effort with a
// per-company report.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SapCreds {
  baseUrl: string;
  companyDB: string;
  userName: string;
  password: string;
}

async function loadSapCreds(
  sb: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<SapCreds | null> {
  const { data } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (!data || data.length === 0) return null;
  const map: Record<string, string> = {};
  for (const r of data as { credential_key: string; credential_value: string }[]) {
    map[r.credential_key] = r.credential_value;
  }
  let baseUrl = (map.service_layer_url || map.base_url || map.url || "").replace(/\/+$/, "");
  if (!baseUrl) return null;
  if (!baseUrl.includes("/b1s/v1")) baseUrl = `${baseUrl}/b1s/v1`;
  const sapCompanyDB = map.company_db || map.CompanyDB || companyDb;
  const userName = map.username || map.UserName;
  const password = map.password || map.Password;
  if (!userName || !password) return null;
  return { baseUrl, companyDB: sapCompanyDB, userName, password };
}

async function sapLogin(creds: SapCreds): Promise<string> {
  const resp = await fetch(`${creds.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: creds.companyDB,
      UserName: creds.userName,
      Password: creds.password,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`SAP Login HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
  const cookies = resp.headers.get("set-cookie") || "";
  return cookies;
}

async function sapGetAll(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  params: Record<string, string>,
): Promise<any[]> {
  const all: any[] = [];
  const pageSize = 100;
  // Initial URL
  let url: string | null = (() => {
    const qp = new URLSearchParams(params);
    qp.set("$top", String(pageSize));
    qp.set("$skip", "0");
    return `${baseUrl}/${endpoint}?${qp.toString()}`;
  })();
  let pageCount = 0;

  while (url) {
    let resp: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        resp = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookies,
            Prefer: "odata.maxpagesize=" + pageSize,
          },
        });
        if (resp.ok) break;
        // 5xx -> retry; 4xx -> stop with error
        if (resp.status < 500) {
          const t = await resp.text().catch(() => "");
          throw new Error(`SAP ${endpoint} HTTP ${resp.status}: ${t.slice(0, 300)}`);
        }
        lastErr = new Error(`HTTP ${resp.status}`);
      } catch (e) {
        lastErr = e;
        console.warn(`intercompany ${endpoint} attempt ${attempt + 1} failed:`, e);
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    if (!resp || !resp.ok) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error(`Falha ao buscar ${endpoint} após retries`);
    }
    const body: any = await resp.json();
    const items: any[] = body.value || [];
    all.push(...items);
    pageCount++;

    // SAP B1 Service Layer paging: prefer odata.nextLink when present
    const nextLink: string | undefined = body["odata.nextLink"] || body["@odata.nextLink"];
    if (nextLink) {
      url = nextLink.startsWith("http") ? nextLink : `${baseUrl}/${nextLink}`;
    } else if (items.length >= pageSize) {
      // Fallback: continue paginating manually
      const qp = new URLSearchParams(params);
      qp.set("$top", String(pageSize));
      qp.set("$skip", String(pageCount * pageSize));
      url = `${baseUrl}/${endpoint}?${qp.toString()}`;
    } else {
      url = null;
    }

    if (all.length > 50000) break;
  }
  return all;
}

async function sapPost(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const resp = await fetch(`${baseUrl}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data as any)?.error?.message?.value || `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true, data };
}

async function sapPatch(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resp = await fetch(`${baseUrl}/${endpoint}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const msg = (data as any)?.error?.message?.value || `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

async function listActiveSapCompanies(
  sb: ReturnType<typeof createClient>,
): Promise<{ company_db: string; display_name: string }[]> {
  const { data, error } = await sb
    .from("companies")
    .select("company_db, display_name, is_active, erp_type")
    .eq("is_active", true)
    .eq("erp_type", "sap")
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data || []) as { company_db: string; display_name: string }[];
}

interface PerCompanyResult<T> {
  company_db: string;
  display_name: string;
  ok: boolean;
  error?: string;
  data?: T;
}

async function forEachCompany<T>(
  sb: ReturnType<typeof createClient>,
  companyDbs: string[] | undefined,
  fn: (creds: SapCreds, cookies: string) => Promise<T>,
): Promise<PerCompanyResult<T>[]> {
  const allCompanies = await listActiveSapCompanies(sb);
  const target = companyDbs && companyDbs.length > 0
    ? allCompanies.filter((c) => companyDbs.includes(c.company_db))
    : allCompanies;

  const results = await Promise.all(
    target.map(async (c): Promise<PerCompanyResult<T>> => {
      try {
        const creds = await loadSapCreds(sb, c.company_db);
        if (!creds) {
          return {
            company_db: c.company_db,
            display_name: c.display_name,
            ok: false,
            error: "Credenciais SAP não configuradas",
          };
        }
        const cookies = await sapLogin(creds);
        const data = await fn(creds, cookies);
        // Fire-and-forget logout
        fetch(`${creds.baseUrl}/Logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookies },
        }).catch(() => {});
        return { company_db: c.company_db, display_name: c.display_name, ok: true, data };
      } catch (e) {
        return {
          company_db: c.company_db,
          display_name: c.display_name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON inválido" }, 400);
  }

  const action = body?.action;
  if (!action || typeof action !== "string") {
    return json({ error: "action é obrigatória" }, 400);
  }

  try {
    if (action === "list-accounts") {
      const results = await forEachCompany(sb, body.company_dbs, async (_c, cookies) => {
        return await sapGetAll(_c.baseUrl, cookies, "ChartOfAccounts", {
          $select: "Code,Name,ActiveAccount,AccountType,FrozenFor",
        });
      });
      return json({ results });
    }

    if (action === "list-cost-centers") {
      const results = await forEachCompany(sb, body.company_dbs, async (_c, cookies) => {
        return await sapGetAll(_c.baseUrl, cookies, "ProfitCenters", {
          $select: "CenterCode,CenterName,GroupCode,Active",
        });
      });
      return json({ results });
    }

    if (action === "create-account") {
      const { code, name, account_type, active_account } = body;
      if (!code || !name) return json({ error: "code e name são obrigatórios" }, 400);
      const payload: Record<string, unknown> = {
        Code: String(code),
        Name: String(name),
        ActiveAccount: active_account === false ? "tNO" : "tYES",
      };
      if (account_type) payload.AccountType = account_type; // e.g. at_Expenses, at_Revenues
      const results = await forEachCompany(sb, body.company_dbs, async (creds, cookies) => {
        const r = await sapPost(creds.baseUrl, cookies, "ChartOfAccounts", payload);
        if (!r.ok) throw new Error(r.error);
        return r.data;
      });
      return json({ results });
    }

    if (action === "create-cost-center") {
      const { center_code, center_name, group_code } = body;
      if (!center_code || !center_name) {
        return json({ error: "center_code e center_name são obrigatórios" }, 400);
      }
      const payload: Record<string, unknown> = {
        CenterCode: String(center_code),
        CenterName: String(center_name),
        Active: "tYES",
      };
      if (group_code !== undefined && group_code !== null && String(group_code).trim() !== "") {
        payload.GroupCode = Number(group_code);
      }
      const results = await forEachCompany(sb, body.company_dbs, async (creds, cookies) => {
        const r = await sapPost(creds.baseUrl, cookies, "ProfitCenters", payload);
        if (!r.ok) throw new Error(r.error);
        return r.data;
      });
      return json({ results });
    }

    if (action === "rename-account") {
      const { code, name } = body;
      if (!code || !name) return json({ error: "code e name são obrigatórios" }, 400);
      const results = await forEachCompany(sb, body.company_dbs, async (creds, cookies) => {
        // Encode code (may contain dots) using OData key syntax
        const encoded = encodeURIComponent(String(code));
        const r = await sapPatch(creds.baseUrl, cookies, `ChartOfAccounts('${encoded}')`, {
          Name: String(name),
        });
        if (!r.ok) throw new Error(r.error);
        return { Code: code, Name: name };
      });
      return json({ results });
    }

    if (action === "rename-cost-center") {
      const { center_code, center_name } = body;
      if (!center_code || !center_name) {
        return json({ error: "center_code e center_name são obrigatórios" }, 400);
      }
      const results = await forEachCompany(sb, body.company_dbs, async (creds, cookies) => {
        const encoded = encodeURIComponent(String(center_code));
        const r = await sapPatch(creds.baseUrl, cookies, `ProfitCenters('${encoded}')`, {
          CenterName: String(center_name),
        });
        if (!r.ok) throw new Error(r.error);
        return { CenterCode: center_code, CenterName: center_name };
      });
      return json({ results });
    }

    if (action === "toggle-account") {
      const { code, active, company_db } = body;
      if (!code || typeof active !== "boolean" || !company_db) {
        return json({ error: "code, active e company_db são obrigatórios" }, 400);
      }
      const results = await forEachCompany(sb, [String(company_db)], async (creds, cookies) => {
        const encoded = encodeURIComponent(String(code));
        const r = await sapPatch(creds.baseUrl, cookies, `ChartOfAccounts('${encoded}')`, {
          ActiveAccount: active ? "tYES" : "tNO",
        });
        if (!r.ok) throw new Error(r.error);
        return { Code: code, ActiveAccount: active };
      });
      return json({ results });
    }

    if (action === "toggle-cost-center") {
      const { center_code, active, company_db } = body;
      if (!center_code || typeof active !== "boolean" || !company_db) {
        return json({ error: "center_code, active e company_db são obrigatórios" }, 400);
      }
      const results = await forEachCompany(sb, [String(company_db)], async (creds, cookies) => {
        const encoded = encodeURIComponent(String(center_code));
        const r = await sapPatch(creds.baseUrl, cookies, `ProfitCenters('${encoded}')`, {
          Active: active ? "tYES" : "tNO",
        });
        if (!r.ok) throw new Error(r.error);
        return { CenterCode: center_code, Active: active };
      });
      return json({ results });
    }

    if (action === "list-companies") {
      const companies = await listActiveSapCompanies(sb);
      return json({ companies });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    console.error("intercompany error:", e);
    return json({ error: e instanceof Error ? e.message : "Erro desconhecido" }, 500);
  }
});
