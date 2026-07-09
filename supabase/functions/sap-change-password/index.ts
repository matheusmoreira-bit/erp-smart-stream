// Server-side batch password change across SAP B1 companies.
//
// Motivação: usuários normais não têm acesso às credenciais administrativas
// (a função `credentials` exige admin/SAP-admin quando pede `keys=...`), o que
// fazia a troca de senha nas demais empresas falhar com "Sem credenciais
// administrativas configuradas". Esta função roda com service-role, lê as
// credenciais admin de cada empresa e — se não houver — usa as credenciais
// padrão configuradas em `SAP_FALLBACK_ADMIN_USERNAME` /
// `SAP_FALLBACK_ADMIN_PASSWORD`.
//
// Segurança: o caller precisa ter sessão SAP válida (validada pelo helper
// compartilhado) e só pode alterar a senha do próprio UserCode.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUserOrSapSession, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function service() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getBaseUrl(admin: ReturnType<typeof createClient>, companyDB: string): Promise<string> {
  const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") ||
    "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
  const { data } = await admin
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();
  const raw = (typeof data?.credential_value === "string" && data.credential_value.trim())
    ? data.credential_value.trim()
    : fallback;
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

interface AdminCreds { username: string; password: string; sapCompanyDb: string; source: "configured" | "fallback" }

async function getAdminCreds(admin: ReturnType<typeof createClient>, companyDB: string): Promise<AdminCreds | null> {
  const { data } = await admin
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDB)
    .in("credential_key", ["username", "password", "company_db"]);
  const map = new Map<string, string>();
  (data || []).forEach((r: { credential_key: string; credential_value: string | null }) => {
    if (r.credential_value) map.set(r.credential_key, r.credential_value);
  });
  const configuredUser = map.get("username");
  const configuredPwd = map.get("password");
  const credCompanyDb = map.get("company_db");
  const sapCompanyDb = credCompanyDb && !/^https?:\/\//i.test(credCompanyDb) ? credCompanyDb : companyDB;

  if (configuredUser && configuredPwd) {
    return { username: configuredUser, password: configuredPwd, sapCompanyDb, source: "configured" };
  }
  const fallbackUser = Deno.env.get("SAP_FALLBACK_ADMIN_USERNAME");
  const fallbackPwd = Deno.env.get("SAP_FALLBACK_ADMIN_PASSWORD");
  if (fallbackUser && fallbackPwd) {
    return { username: fallbackUser, password: fallbackPwd, sapCompanyDb, source: "fallback" };
  }
  return null;
}

interface Session { baseUrl: string; session: string; route: string }

async function sapLogin(baseUrl: string, companyDB: string, username: string, password: string): Promise<Session> {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: username, Password: password }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Falha login SAP: ${resp.status} ${text}`);
  }
  const cookies = resp.headers.get("set-cookie") || "";
  const sessionMatch = cookies.match(/B1SESSION=([^;]+)/);
  const routeMatch = cookies.match(/ROUTEID=([^;]+)/);
  const body = await resp.json().catch(() => ({} as { SessionId?: string }));
  const session = sessionMatch?.[1] || body.SessionId || "";
  if (!session) throw new Error("Sem session id na resposta do SAP");
  return { baseUrl, session, route: routeMatch?.[1] || "" };
}

async function sapLogout(s: Session) {
  try {
    await fetch(`${s.baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}` },
    });
  } catch { /* noop */ }
}

async function sapRequest(s: Session, path: string, method: string, body?: unknown) {
  const resp = await fetch(`${s.baseUrl}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: resp.ok, status: resp.status, data };
}

function extractSapError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const err = (payload as { error?: { message?: unknown } }).error;
  if (!err) return fallback;
  const msg = err.message;
  if (typeof msg === "string") return msg;
  if (msg && typeof msg === "object" && typeof (msg as { value?: unknown }).value === "string") {
    return (msg as { value: string }).value;
  }
  return fallback;
}

function isSamePasswordError(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("same as") || m.includes("same password") || m.includes("previous password") ||
    m.includes("igual") || m.includes("já utilizada") || m.includes("ja utilizada") ||
    m.includes("password history") || m.includes("cannot be reused") || m.includes("must differ")
  );
}

interface ResultRow { companyDB: string; displayName: string; status: "success" | "error" | "skipped"; message?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireUserOrSapSession(req);
    const callerUserCode = (caller as { userName?: string; email?: string }).userName
      || (caller as { email?: string }).email
      || "";

    const body = await req.json().catch(() => ({}));
    const userCode = String(body.user_code || callerUserCode || "").trim();
    const newPassword = String(body.new_password || "");
    const targets = Array.isArray(body.company_dbs) ? (body.company_dbs as string[]) : [];

    if (!userCode) {
      return new Response(JSON.stringify({ error: "user_code obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Regular SAP users can only change their own password. Cloud admins may change any user.
    const isCloudAdmin = (caller as { source?: string }).source === "cloud_admin";
    if (!isCloudAdmin && callerUserCode && userCode.toLowerCase() !== callerUserCode.toLowerCase()) {
      return new Response(JSON.stringify({ error: "Só é permitido alterar a própria senha" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!newPassword || newPassword.length < 4) {
      return new Response(JSON.stringify({ error: "new_password inválido (mínimo 4 caracteres)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(targets) || targets.length === 0 || targets.length > 50) {
      return new Response(JSON.stringify({ error: "company_dbs deve ter entre 1 e 50 empresas" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = service();
    const { data: companiesData } = await admin
      .from("companies")
      .select("company_db, display_name")
      .eq("erp_type", "sap")
      .eq("is_active", true)
      .in("company_db", targets);
    const nameMap = new Map<string, string>();
    (companiesData || []).forEach((c: { company_db: string; display_name: string }) => nameMap.set(c.company_db, c.display_name));

    const results: ResultRow[] = [];
    for (const companyDb of targets) {
      const displayName = nameMap.get(companyDb) || companyDb;
      let creds: AdminCreds | null;
      try { creds = await getAdminCreds(admin, companyDb); }
      catch (e) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro ao ler credenciais" });
        continue;
      }
      if (!creds) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: "Sem credenciais administrativas configuradas" });
        continue;
      }
      let baseUrl: string;
      try { baseUrl = await getBaseUrl(admin, companyDb); }
      catch (e) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro ao ler URL do Service Layer" });
        continue;
      }
      let session: Session;
      try { session = await sapLogin(baseUrl, creds.sapCompanyDb, creds.username, creds.password); }
      catch (e) {
        const suffix = creds.source === "fallback" ? " (usando credenciais padrão)" : "";
        results.push({ companyDB: companyDb, displayName, status: "error", message: (e instanceof Error ? e.message : "Falha ao autenticar") + suffix });
        continue;
      }
      try {
        const lookup = await sapRequest(
          session,
          `Users?$filter=UserCode eq '${userCode.replace(/'/g, "''")}'&$select=InternalKey,UserCode`,
          "GET",
        );
        if (!lookup.ok) {
          results.push({ companyDB: companyDb, displayName, status: "error", message: extractSapError(lookup.data, `HTTP ${lookup.status}`) });
          continue;
        }
        const payload = lookup.data as { value?: Array<{ InternalKey?: number; UserCode?: string }> } | Array<{ InternalKey?: number; UserCode?: string }>;
        const rows = Array.isArray(payload) ? payload : (payload?.value || []);
        if (rows.length === 0 || rows[0].InternalKey == null) {
          results.push({ companyDB: companyDb, displayName, status: "skipped", message: "Usuário não existe nesta empresa" });
          continue;
        }
        const patch = await sapRequest(session, `Users(${rows[0].InternalKey})`, "PATCH", { UserPassword: newPassword, Locked: "tNO" });
        if (patch.ok) {
          results.push({ companyDB: companyDb, displayName, status: "success" });
        } else {
          const msg = extractSapError(patch.data, `HTTP ${patch.status}`);
          if (isSamePasswordError(msg)) {
            results.push({ companyDB: companyDb, displayName, status: "skipped", message: "Senha igual à anterior" });
          } else {
            results.push({ companyDB: companyDb, displayName, status: "error", message: msg });
          }
        }
      } catch (e) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro ao alterar senha" });
      } finally {
        await sapLogout(session);
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[sap-change-password] error:", err instanceof Error ? err.message : String(err));
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
