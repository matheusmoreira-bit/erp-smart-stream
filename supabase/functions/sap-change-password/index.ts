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
import { callerOwnsUserCode } from "../_shared/user-aliases.ts";
import { ensurePasswordNeverExpires } from "../_shared/sap-password-never-expires.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { consumeCsrfToken, CSRF_HEADER } from "../_shared/csrf.ts";
import { revokeErpSession } from "../_shared/session-revocation.ts";
import { encryptSecret } from "../_shared/sap-cred-crypto.ts";



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

interface ResultRow {
  companyDB: string;
  displayName: string;
  status: "success" | "error" | "skipped";
  message?: string;
  /** true quando o login com a NOVA senha foi confirmado no Service Layer. */
  verified?: boolean;
  /** true quando o login gerenciado foi gravado no banco com a mesma senha. */
  managedSaved?: boolean;
}

const TRIVIAL_PASSWORDS = [
  "123456", "12345678", "123456789", "1234567890", "password", "senha", "qwerty",
  "abc123", "111111", "000000", "sap", "manager", "admin", "cactus", "mudar123",
];

/** Retorna a mensagem de erro quando a senha é fraca; null quando aceitável. */
function isWeakPassword(pwd: string, userCode: string): string | null {
  if (!pwd || pwd.length < 12) return "A senha deve ter no mínimo 12 caracteres.";
  if (pwd.length > 128) return "A senha deve ter no máximo 128 caracteres.";
  const lower = pwd.toLowerCase();
  if (TRIVIAL_PASSWORDS.some((t) => lower.includes(t))) {
    return "A senha contém um termo comum/previsível. Escolha outra.";
  }
  const user = (userCode || "").toLowerCase().split("@")[0];
  if (user.length >= 4 && lower.includes(user)) {
    return "A senha não pode conter o seu nome de usuário.";
  }
  if (/^(.)\1+$/.test(pwd)) return "A senha não pode ser formada por um único caractere repetido.";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pwd)).length;
  if (classes < 3) {
    return "Use ao menos três tipos de caractere (maiúscula, minúscula, número e símbolo).";
  }
  return null;
}

/**
 * Valida a senha atual fazendo login real no Service Layer com as credenciais
 * do próprio usuário, na primeira empresa alvo onde ele exista.
 */
async function verifyCurrentPassword(
  admin: ReturnType<typeof service>,
  targets: string[],
  userCode: string,
  currentPassword: string,
): Promise<{ ok: boolean; reason?: string }> {
  let lastReason = "Não foi possível validar a senha atual.";
  for (const companyDb of targets.slice(0, 5)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const creds = await getAdminCreds(admin, companyDb).catch(() => null);
      if (!creds) continue;
      const baseUrl = await getBaseUrl(admin, companyDb).catch(() => null);
      if (!baseUrl) continue;
      try {
        const s = await sapLogin(baseUrl, creds.sapCompanyDb, userCode, currentPassword, ctrl.signal);
        if (s) return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Usuário inexistente nesta empresa → tenta a próxima.
        if (/user.*not|inexist|invalid company/i.test(msg)) { lastReason = msg; continue; }
        return { ok: false, reason: "Senha atual incorreta." };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: lastReason };
}

async function resolveManagedTargetUser(
  admin: ReturnType<typeof service>,
  input: { targetUserId?: string; targetEmail?: string },
): Promise<{ id: string; email: string | null }> {
  const targetUserId = (input.targetUserId || "").trim();
  const targetEmail = (input.targetEmail || "").trim().toLowerCase();

  if (targetUserId) {
    const { data, error } = await admin.auth.admin.getUserById(targetUserId);
    if (error || !data?.user) throw new Error("Usuário-alvo não encontrado para provisionamento");
    return { id: data.user.id, email: data.user.email || null };
  }

  if (!targetEmail) throw new Error("target_user_id ou target_email obrigatório para provisionar senha");

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error(`Falha ao listar usuários: ${listErr.message}`);
  const users = list?.users || [];
  const exactMatch = users.find((u) => (u.email || "").toLowerCase() === targetEmail);
  const targetLocal = targetEmail.split("@")[0];
  const activeAlias = users
    .filter((u) => (u.email || "").toLowerCase().split("@")[0] === targetLocal && u.last_sign_in_at)
    .sort((a, b) => new Date(b.last_sign_in_at || 0).getTime() - new Date(a.last_sign_in_at || 0).getTime())[0];
  const match = exactMatch?.last_sign_in_at ? exactMatch : (activeAlias || exactMatch);
  if (match) return { id: match.id, email: match.email || targetEmail };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: targetEmail,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    throw new Error(`Falha ao criar usuário Cloud para '${targetEmail}': ${createErr?.message || "erro desconhecido"}`);
  }
  return { id: created.user.id, email: created.user.email || targetEmail };
}

Deno.serve(withEdgeMetrics("sap-change-password", async (req, _mctx) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;


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
    const targetUserId = typeof body.target_user_id === "string" ? body.target_user_id : "";
    const targetEmail = typeof body.target_email === "string" ? body.target_email : "";

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

    // Política de senha (pentest 3.3): mínimo 12 caracteres e bloqueio de
    // senhas triviais/previsíveis.
    const weak = isWeakPassword(newPassword, userCode);
    if (weak) {
      return new Response(JSON.stringify({ error: weak }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(targets) || targets.length === 0 || targets.length > 50) {
      return new Response(JSON.stringify({ error: "company_dbs deve ter entre 1 e 50 empresas" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anti-CSRF / anti-replay (pentest 3.3): troca da própria senha exige token
    // anti-CSRF de uso único. A senha atual passou a ser OPCIONAL — quando
    // informada, continua sendo validada no Service Layer.
    const isSelfChange = !isAdmin
      || userCode.toLowerCase() === (callerUserCode || "").toLowerCase();
    if (isSelfChange) {
      // Token anti-CSRF de uso único: derruba replay do HTML/requisição.
      const csrfOk = await consumeCsrfToken(
        adminSvc,
        req.headers.get(CSRF_HEADER) || String(body.csrf_token || ""),
        "sap-change-password",
        callerUserCode || userCode,
      );
      if (!csrfOk) {
        console.warn("[sap-change-password] csrf token inválido/reutilizado", { userCode });
        return new Response(JSON.stringify({
          error: "Sessão de segurança expirada. Recarregue a página e tente novamente.",
          code: "csrf_invalid",
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const currentPassword = String(body.current_password || "");
      if (currentPassword) {
        if (currentPassword === newPassword) {
          return new Response(JSON.stringify({ error: "A nova senha deve ser diferente da senha atual." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const verified = await verifyCurrentPassword(service(), targets, userCode, currentPassword);
        if (!verified.ok) {
          console.warn("[sap-change-password] current password check failed", { userCode, reason: verified.reason });
          return new Response(JSON.stringify({ error: verified.reason || "Senha atual incorreta." }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
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

    // Login gerenciado: a senha só é gravada no banco DEPOIS que o login com a
    // nova senha foi confirmado no Service Layer daquela empresa, usando
    // exatamente a mesma string enviada no PATCH. Isso garante que banco e SAP
    // nunca fiquem divergentes (antes o front salvava também em empresas
    // "ignoradas"/com erro, onde o SAP mantinha a senha antiga).
    const saveManaged = body.save_managed === true;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callerId);
    let managedUserId: string | null = saveManaged && isUuid && userCode.toLowerCase() === (callerUserCode || "").toLowerCase()
      ? callerId
      : null;
    let managedTargetEmail: string | null = null;
    if (saveManaged && (targetUserId || targetEmail)) {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Apenas administradores podem provisionar senha para outro usuário" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const managedTarget = await resolveManagedTargetUser(admin, { targetUserId, targetEmail });
      managedUserId = managedTarget.id;
      managedTargetEmail = managedTarget.email;
    }

    async function persistManagedCredential(companyDb: string): Promise<boolean> {
      if (!managedUserId) return false;
      try {
        const encrypted = await encryptSecret(newPassword);
        const { error } = await admin.from("user_sap_credentials").upsert(
          {
            user_id: managedUserId,
            company_db: companyDb,
            sap_user: userCode,
            sap_password_encrypted: encrypted,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,company_db" },
        );
        if (error) throw error;
        return true;
      } catch (e) {
        console.error("[sap-change-password] falha ao salvar login gerenciado", {
          companyDb, error: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
    }


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
        let alreadyCurrent = false;
        if (!patch.ok) {
          const msg = extractSapError(patch.data, `HTTP ${patch.status}`);
          if (isSamePasswordError(msg)) {
            if (!saveManaged) {
              return { companyDB: companyDb, displayName, status: "skipped", message: "Senha igual à anterior" };
            }
            alreadyCurrent = true;
          } else {
            console.error(`[sap-change-password] PATCH failed`, { companyDb, userCode, internalKey: rows[0].InternalKey, status: patch.status, msg });
            return { companyDB: companyDb, displayName, status: "error", message: msg };
          }
        }
        // 2.1) Garante "Senha nunca expira" no SAP (best-effort) para que a
        // nova senha não caduque e derrube o usuário/integrações.
        await ensurePasswordNeverExpires(
          (path, method, b) => sapRequest(session!, path, method, b, ctrl.signal),
          rows[0].InternalKey!,
          { companyDb, userCode },
        );

        // 3) Verificação: tenta logar como o próprio usuário com a nova senha.
        // Se o SAP aceitou o PATCH mas não aplicou (ex.: admin sem privilégio
        // de superuser), o login falha e reportamos como erro real.
        let verifySession: Session | null = null;
        try {
          verifySession = await sapLogin(baseUrl, creds.sapCompanyDb, userCode, newPassword, ctrl.signal);
          const managedSaved = await persistManagedCredential(companyDb);
          if (saveManaged && !managedSaved) {
            return {
              companyDB: companyDb,
              displayName,
              status: "error",
              verified: true,
              managedSaved: false,
              message: "Senha validada no SAP, mas falhou ao salvar a senha provisionada.",
            };
          }
          return {
            companyDB: companyDb,
            displayName,
            status: "success",
            verified: true,
            managedSaved,
            message: saveManaged
              ? (alreadyCurrent ? "Senha já era atual no SAP — senha provisionada" : "Senha provisionada e validada")
              : "Senha redefinida e validada",
          };
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

    // Empresas onde a nova senha NÃO foi confirmada não podem manter um login
    // gerenciado gravado (ficaria divergente do SAP e o auto-login tentaria a
    // senha errada, podendo bloquear o usuário). Removemos o registro para que
    // o usuário faça login manual nessas bases.
    if (managedUserId) {
      const stale = results
        .filter((r) => saveManaged ? r.managedSaved !== true : r.verified !== true)
        .map((r) => r.companyDB);
      if (stale.length > 0) {
        const { error } = await admin
          .from("user_sap_credentials")
          .delete()
          .eq("user_id", managedUserId)
          .in("company_db", stale);
        if (error) console.error("[sap-change-password] falha ao limpar credenciais divergentes", error.message);
      }
    }

    // Troca de senha SEM provisionamento (save_managed = false): qualquer login
    // gerenciado gravado anteriormente para esse usuário ficaria com a senha
    // antiga. Removemos o provisionamento nas empresas onde a senha mudou.
    if (!saveManaged) {
      const changed = results.filter((r) => r.status === "success").map((r) => r.companyDB);
      if (changed.length > 0) {
        const { error } = await admin
          .from("user_sap_credentials")
          .delete()
          .ilike("sap_user", userCode)
          .in("company_db", changed);
        if (error) {
          console.error("[sap-change-password] falha ao remover provisionamento", error.message);
        }
      }
    }




    // Invalidação das sessões ERP ativas do usuário após a troca de senha.
    // O B1SESSION apresentado na requisição é revogado no gateway (o Service
    // Layer continuaria aceitando-o por até 30 min).
    const changedAny = results.some((r) => r.status === "success");
    if (changedAny) {
      const sidHeader = req.headers.get("x-sap-session") || "";
      if (sidHeader) {
        await revokeErpSession(adminSvc, {
          sapSession: sidHeader,
          userKey: userCode,
          companyDb: req.headers.get("x-company-db"),
          reason: "password_change",
        });
      }
    }

    if (saveManaged && changedAny) {
      try {
        await admin.from("audit_log").insert({
          actor_id: callerId && !callerId.startsWith("sap:") ? callerId : null,
          actor_email: (caller as { email?: string }).email || null,
          action: "sap_managed_password_provisioned",
          entity_type: "user_sap_credentials",
          entity_id: managedUserId,
          company_db: targets[0] || null,
          details: { target_email: managedTargetEmail, sap_user: userCode, companies: targets },
        });
      } catch (_) { /* auditoria best-effort */ }
    }


    return new Response(JSON.stringify({ results, session_revoked: changedAny }), {
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
