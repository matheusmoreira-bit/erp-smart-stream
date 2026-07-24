// Admin-only: gera senha aleatória forte, aplica no SAP e guarda criptografada
// em user_sap_credentials do usuário-alvo. O usuário nunca conhece a senha —
// o login vira transparente (Cloud auth → seleciona empresa → auto-login).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdmin, authErrorResponse } from "../_shared/auth.ts";
import { encryptSecret } from "../_shared/sap-cred-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function service() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function defaultSapUserFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const local = (email.split("@")[0] || "").toLowerCase();
  return local.slice(0, 20);
}

// Random strong password: 24 chars, mixed case + digits + symbols.
function generatePassword(len = 24): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digit = "23456789";
  const sym = "!@#$%&*+-=?";
  const all = upper + lower + digit + sym;
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  const chars: string[] = [
    upper[rnd[0] % upper.length],
    lower[rnd[1] % lower.length],
    digit[rnd[2] % digit.length],
    sym[rnd[3] % sym.length],
  ];
  for (let i = 4; i < len; i++) chars.push(all[rnd[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function getBaseUrl(admin: ReturnType<typeof createClient>, companyDB: string): Promise<string> {
  const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") || "";
  const { data } = await admin
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();
  const raw = (typeof data?.credential_value === "string" && data.credential_value.trim())
    ? data.credential_value.trim() : fallback;
  if (!raw) throw new Error("service_layer_url não configurado para esta empresa");
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
    .in("credential_key", ["username", "password", "company_db", "sap_company_db"]);
  const map = new Map<string, string>();
  (data || []).forEach((r: { credential_key: string; credential_value: string | null }) => {
    if (r.credential_value) map.set(r.credential_key, r.credential_value);
  });
  const configuredUser = map.get("username");
  const configuredPwd = map.get("password");
  const credCompanyDb = map.get("sap_company_db") || map.get("company_db");
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
    throw new Error(`Falha login SAP: ${resp.status} ${text.slice(0, 200)}`);
  }
  const cookies = resp.headers.get("set-cookie") || "";
  const sessionMatch = cookies.match(/B1SESSION=([^;]+)/);
  const routeMatch = cookies.match(/ROUTEID=([^;]+)/);
  const body = await resp.json().catch(() => ({} as { SessionId?: string }));
  const sess = sessionMatch?.[1] || body.SessionId || "";
  if (!sess) throw new Error("Sem session id na resposta do SAP");
  return { baseUrl, session: sess, route: routeMatch?.[1] || "" };
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

interface ResultRow { companyDB: string; displayName: string; status: "success" | "error" | "skipped"; message?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const actor = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    let targetUserId = String(body.target_user_id || "").trim();
    const targetEmailInput = typeof body.target_email === "string" ? body.target_email.trim().toLowerCase() : "";
    const sapUserOverride = typeof body.sap_user === "string" ? body.sap_user.trim() : "";
    const targets: string[] = Array.isArray(body.company_dbs) ? body.company_dbs : [];

    if (!targetUserId && !targetEmailInput) return json({ error: "target_user_id ou target_email obrigatório" }, 400);
    if (targets.length === 0 || targets.length > 50) return json({ error: "company_dbs deve ter entre 1 e 50 empresas" }, 400);

    const admin = service();

    let targetEmail: string | null = null;
    if (!targetUserId && targetEmailInput) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listErr) return json({ error: `Falha ao listar usuários: ${listErr.message}` }, 500);
      const match = (list?.users || []).find((u) => (u.email || "").toLowerCase() === targetEmailInput);
      if (match) {
        targetUserId = match.id;
        targetEmail = match.email || targetEmailInput;
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: targetEmailInput,
          email_confirm: true,
        });
        if (createErr || !created?.user) {
          return json({ error: `Falha ao criar usuário Cloud para '${targetEmailInput}': ${createErr?.message || "erro desconhecido"}` }, 500);
        }
        targetUserId = created.user.id;
        targetEmail = created.user.email || targetEmailInput;
      }
    } else {
      const { data: userData, error: userErr } = await admin.auth.admin.getUserById(targetUserId);
      if (userErr || !userData?.user) return json({ error: "Usuário-alvo não encontrado" }, 404);
      targetEmail = userData.user.email || null;
    }

    const sapUser = (sapUserOverride || defaultSapUserFromEmail(targetEmail)).toLowerCase();
    if (!sapUser) return json({ error: "Não foi possível determinar o UserCode do SAP" }, 400);

    const { data: companiesData } = await admin
      .from("companies")
      .select("company_db, display_name")
      .eq("erp_type", "sap")
      .eq("is_active", true)
      .in("company_db", targets);
    const nameMap = new Map<string, string>();
    (companiesData || []).forEach((c: { company_db: string; display_name: string }) =>
      nameMap.set(c.company_db, c.display_name));

    const results: ResultRow[] = [];
    for (const companyDb of targets) {
      const displayName = nameMap.get(companyDb) || companyDb;
      const creds = await getAdminCreds(admin, companyDb).catch(() => null);
      if (!creds) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: "Sem credenciais administrativas configuradas" });
        continue;
      }
      let baseUrl: string;
      try { baseUrl = await getBaseUrl(admin, companyDb); }
      catch (e) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro ao ler URL" });
        continue;
      }
      let session: Session;
      try { session = await sapLogin(baseUrl, creds.sapCompanyDb, creds.username, creds.password); }
      catch (e) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Falha ao autenticar" });
        continue;
      }
      try {
        const lookup = await sapRequest(
          session,
          `Users?$filter=UserCode eq '${sapUser.replace(/'/g, "''")}'&$select=InternalKey,UserCode`,
          "GET",
        );
        if (!lookup.ok) {
          results.push({ companyDB: companyDb, displayName, status: "error", message: extractSapError(lookup.data, `HTTP ${lookup.status}`) });
          continue;
        }
        const payload = lookup.data as { value?: Array<{ InternalKey?: number }> } | Array<{ InternalKey?: number }>;
        const rows = Array.isArray(payload) ? payload : (payload?.value || []);
        if (rows.length === 0 || rows[0].InternalKey == null) {
          results.push({ companyDB: companyDb, displayName, status: "skipped", message: `Usuário '${sapUser}' não existe nesta empresa` });
          continue;
        }
        const newPassword = generatePassword(24);
        const patch = await sapRequest(session, `Users(${rows[0].InternalKey})`, "PATCH", {
          UserPassword: newPassword, Locked: "tNO",
        });
        if (!patch.ok) {
          results.push({ companyDB: companyDb, displayName, status: "error", message: extractSapError(patch.data, `HTTP ${patch.status}`) });
          continue;
        }
        const encrypted = await encryptSecret(newPassword);
        const { error: upsertErr } = await admin.from("user_sap_credentials").upsert({
          user_id: targetUserId,
          company_db: companyDb,
          sap_user: sapUser,
          sap_password_encrypted: encrypted,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,company_db" });
        if (upsertErr) {
          results.push({ companyDB: companyDb, displayName, status: "error", message: `Senha alterada no SAP mas falhou ao salvar: ${upsertErr.message}` });
          continue;
        }
        try {
          await admin.from("audit_log").insert({
            actor_id: actor.id,
            actor_email: actor.email,
            action: "sap_provision_user_access",
            entity_type: "user_sap_credentials",
            entity_id: targetUserId,
            company_db: companyDb,
            details: { target_email: targetEmail, sap_user: sapUser },
          });
        } catch { /* audit best-effort */ }
        results.push({ companyDB: companyDb, displayName, status: "success", message: `Acesso provisionado para '${sapUser}'` });
      } catch (e) {
        results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro" });
      } finally {
        await sapLogout(session);
      }
    }

    return json({ results, sap_user: sapUser, target_email: targetEmail, target_user_id: targetUserId });
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[sap-provision-user-access]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
