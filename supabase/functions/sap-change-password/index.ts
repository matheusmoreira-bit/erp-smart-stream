import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
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
import { enforceRateLimit, rateLimitResponse, clientIpFrom } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
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

async function sapLogin(baseUrl: string, companyDB: string, username: string, password: string, signal?: AbortSignal): Promise<Session> {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: username, Password: password }),
    signal,
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
  // Logout best-effort com timeout curto para não segurar o request.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`${s.baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}` },
      signal: ctrl.signal,
    }).catch(() => null);
    clearTimeout(t);
  } catch { /* noop */ }
}

async function sapRequest(s: Session, path: string, method: string, body?: unknown, signal?: AbortSignal) {
  const resp = await fetch(`${s.baseUrl}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
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

Deno.serve(withEdgeMetrics("sap-change-password", async (req, _mctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireUserOrSapSession(req);
    const callerUserCode = (caller as { userName?: string; email?: string }).userName
      || (caller as { email?: string }).email
      || "";

    // Rate limit: 5 tentativas de troca de senha por 5 min por usuário/IP.
    const rlAdmin = service();
    const rl = await enforceRateLimit(rlAdmin, {
      scope: "sap-change-password",
      identifier: callerUserCode || clientIpFrom(req),
      max: 5,
      windowSeconds: 300,
    });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const body = await req.json().catch(() => ({}));
    const userCode = String(body.user_code || callerUserCode || "").trim();
    const newPassword = String(body.new_password || "");
    const targets = Array.isArray(body.company_dbs) ? (body.company_dbs as string[]) : [];

    if (!userCode) {
      return new Response(JSON.stringify({ error: "user_code obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Regular SAP users can only change their own password.
    // Cloud admins and SAP admins may change any user's password.
    const callerSource = (caller as { source?: string }).source;
    const callerId = (caller as { id?: string }).id || "";
    const adminSvc = service();
    let isAdmin = false;
    // Cloud user: check has_role(admin)
    if (!callerSource || callerSource === "cloud_user") {
      if (callerId && !callerId.startsWith("sap:")) {
        const { data: hasRole } = await adminSvc.rpc("has_role", { _user_id: callerId, _role: "admin" });
        if (hasRole === true) isAdmin = true;
      }
    }
    // SAP session: check SAP admin mapping or manager
    if (!isAdmin && callerSource === "sap_session" && callerUserCode) {
      if (callerUserCode.toLowerCase() === "manager") {
        isAdmin = true;
      } else {
        const { data: isSapAdmin } = await adminSvc.rpc("is_sap_user_admin", {
          _sap_username: callerUserCode.toLowerCase(),
        });
        if (isSapAdmin === true) isAdmin = true;
      }
    }
    if (callerSource === "cloud_admin" || callerSource === "sap_admin") isAdmin = true;

    if (!isAdmin && callerUserCode && userCode.toLowerCase() !== callerUserCode.toLowerCase()) {
      // Identidade flexível: e-mail pode mudar ao longo do tempo, enquanto o
      // UserCode do SAP é imutável. Verifica aliases (IdP, credenciais
      // gerenciadas, perfil de colaborador) antes de negar.
      const owns = await callerOwnsUserCode(
        adminSvc,
        { id: callerId, email: (caller as { email?: string }).email, userName: (caller as { userName?: string }).userName },
        userCode,
      );
      if (!owns) {
        console.warn("[sap-change-password] identity mismatch", { callerUserCode, userCode });
        return new Response(JSON.stringify({ error: "Só é permitido alterar a própria senha" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    // Timeout individual por empresa (ms). Ajustável via secret.
    const PER_COMPANY_TIMEOUT_MS = Number(Deno.env.get("SAP_CHANGE_PASSWORD_TIMEOUT_MS") || "25000");

    async function changeForCompany(companyDb: string): Promise<ResultRow> {
      const displayName = nameMap.get(companyDb) || companyDb;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PER_COMPANY_TIMEOUT_MS);
      let session: Session | null = null;
      try {
        let creds: AdminCreds | null;
        try { creds = await getAdminCreds(admin, companyDb); }
        catch (e) {
          return { companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro ao ler credenciais" };
        }
        if (!creds) {
          return { companyDB: companyDb, displayName, status: "error", message: "Sem credenciais administrativas configuradas" };
        }
        let baseUrl: string;
        try { baseUrl = await getBaseUrl(admin, companyDb); }
        catch (e) {
          return { companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro ao ler URL do Service Layer" };
        }
        try { session = await sapLogin(baseUrl, creds.sapCompanyDb, creds.username, creds.password, ctrl.signal); }
        catch (e) {
          const suffix = creds.source === "fallback" ? " (usando credenciais padrão)" : "";
          const raw = e instanceof Error ? e.message : "Falha ao autenticar";
          const msg = (ctrl.signal.aborted ? `Timeout após ${PER_COMPANY_TIMEOUT_MS}ms no login` : raw) + suffix;
          console.error(`[sap-change-password] login failed`, { companyDb, sapCompanyDb: creds.sapCompanyDb, source: creds.source, msg });
          return { companyDB: companyDb, displayName, status: "error", message: msg };
        }
        const lookup = await sapRequest(
          session,
          `Users?$filter=UserCode eq '${userCode.replace(/'/g, "''")}'&$select=InternalKey,UserCode`,
          "GET",
          undefined,
          ctrl.signal,
        );
        if (!lookup.ok) {
          const msg = extractSapError(lookup.data, `HTTP ${lookup.status}`);
          console.error(`[sap-change-password] user lookup failed`, { companyDb, userCode, status: lookup.status, msg });
          return { companyDB: companyDb, displayName, status: "error", message: msg };
        }
        const payload = lookup.data as { value?: Array<{ InternalKey?: number; UserCode?: string }> } | Array<{ InternalKey?: number; UserCode?: string }>;
        const rows = Array.isArray(payload) ? payload : (payload?.value || []);
        if (rows.length === 0 || rows[0].InternalKey == null) {
          return { companyDB: companyDb, displayName, status: "skipped", message: "Usuário não existe nesta empresa" };
        }
        // 1) Desbloquear antes (evita conflitos quando o SAP rejeita alterar
        // senha e status na mesma chamada).
        await sapRequest(session, `Users(${rows[0].InternalKey})`, "PATCH", { Locked: "tNO" }, ctrl.signal).catch(() => null);
        // 2) Trocar apenas a senha em uma chamada dedicada.
        const patch = await sapRequest(session, `Users(${rows[0].InternalKey})`, "PATCH", { UserPassword: newPassword }, ctrl.signal);
        if (!patch.ok) {
          const msg = extractSapError(patch.data, `HTTP ${patch.status}`);
          if (isSamePasswordError(msg)) {
            return { companyDB: companyDb, displayName, status: "skipped", message: "Senha igual à anterior" };
          }
          console.error(`[sap-change-password] PATCH failed`, { companyDb, userCode, internalKey: rows[0].InternalKey, status: patch.status, msg });
          return { companyDB: companyDb, displayName, status: "error", message: msg };
        }
        // 3) Verificação: tenta logar como o próprio usuário com a nova senha.
        // Se o SAP aceitou o PATCH mas não aplicou (ex.: admin sem privilégio
        // de superuser), o login falha e reportamos como erro real.
        let verifySession: Session | null = null;
        try {
          verifySession = await sapLogin(baseUrl, creds.sapCompanyDb, userCode, newPassword, ctrl.signal);
          return { companyDB: companyDb, displayName, status: "success" };
        } catch (e) {
          const raw = e instanceof Error ? e.message : "Falha ao validar nova senha";
          console.error(`[sap-change-password] verify login failed`, { companyDb, userCode, sapCompanyDb: creds.sapCompanyDb, raw });
          return {
            companyDB: companyDb,
            displayName,
            status: "error",
            message: `PATCH aceito, mas login com a nova senha falhou (${raw}). Verifique se o usuário admin tem privilégio de Superuser nesta base.`,
          };
        } finally {
          if (verifySession) sapLogout(verifySession);
        }
      } catch (e) {
        const aborted = ctrl.signal.aborted;
        const raw = e instanceof Error ? e.message : "Erro ao alterar senha";
        const msg = aborted ? `Timeout após ${PER_COMPANY_TIMEOUT_MS}ms` : raw;
        console.error(`[sap-change-password] exception`, { companyDb, userCode, msg });
        return { companyDB: companyDb, displayName, status: "error", message: msg };
      } finally {
        clearTimeout(timer);
        if (session) { sapLogout(session); }
      }
    }

    const settled = await Promise.allSettled(targets.map((db) => changeForCompany(db)));
    const results: ResultRow[] = settled.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      const db = targets[i];
      return {
        companyDB: db,
        displayName: nameMap.get(db) || db,
        status: "error",
        message: r.reason instanceof Error ? r.reason.message : "Erro inesperado",
      };
    });

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
}));
