import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import { decryptSecret } from "../_shared/sap-cred-crypto.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { sapFetch } from "../_shared/sap-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function service() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

/** Margem antes do vencimento real da sessão do Service Layer. */
const SAFETY_MS = 2 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getSapBaseUrl(admin: ReturnType<typeof createClient>, companyDB: string): Promise<string> {
  const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") || "";
  const { data } = await admin
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();
  const raw = typeof data?.credential_value === "string" && data.credential_value.trim()
    ? data.credential_value.trim() : fallback;
  if (!raw) throw new Error("service_layer_url não configurado para esta empresa");
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function getEffectiveCompanyDb(admin: ReturnType<typeof createClient>, companyDB: string): Promise<string> {
  const { data } = await admin
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .in("credential_key", ["sap_company_db", "company_db"]);
  const map = new Map<string, string>();
  (data || []).forEach((r: { credential_key: string; credential_value: string | null }) => {
    if (r.credential_value) map.set(r.credential_key, r.credential_value.trim());
  });
  const v = map.get("sap_company_db") || map.get("company_db") || "";
  if (v && !/^https?:\/\//i.test(v)) return v;
  return companyDB;
}

/** Credencial de serviço (ApiUser) da empresa — usada em fluxos de leitura. */
async function getServiceCredentials(
  admin: ReturnType<typeof createClient>,
  companyDB: string,
): Promise<{ username: string; password: string } | null> {
  const { data } = await admin
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .in("credential_key", ["username", "password"]);
  const map = new Map<string, string>();
  (data || []).forEach((r: { credential_key: string; credential_value: string | null }) => {
    if (r.credential_value) map.set(r.credential_key, r.credential_value);
  });
  const username = (map.get("username") || "").trim();
  const rawPassword = map.get("password") || "";
  if (!username || !rawPassword) return null;
  return { username, password: rawPassword };
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const companyDb = typeof body.company_db === "string" ? body.company_db.trim() : "";
    if (!companyDb) return json({ error: "company_db obrigatório" }, 400);
    // `force` descarta o cache (usado quando o SAP recusou a sessão anterior).
    const force = body.force === true;
    // Fluxos de leitura podem usar a credencial de serviço (ApiUser) da empresa.
    // Ações que exigem a identidade do usuário devem enviar allow_service=false.
    const allowService = body.allow_service !== false;

    const admin = service();

    // ── Invalidação explícita (sessão recusada pelo SAP) ────────────────
    if (body.invalidate === true) {
      await admin.from("erp_session_cache").delete()
        .eq("user_id", user.id).eq("company_db", companyDb);
      return json({ ok: true, invalidated: true });
    }

    // ── 0) Registro de sessão criada fora daqui (login interativo) ──────
    const store = body.store;
    if (store && typeof store.session_id === "string" && store.session_id.trim()) {
      const timeout = Math.min(Math.max(Number(store.session_timeout) || 30, 1), 30);
      const { error: storeErr } = await admin.from("erp_session_cache").upsert({
        user_id: user.id,
        company_db: companyDb,
        sap_user: String(store.sap_user || user.email || "").slice(0, 200),
        is_service: false,
        session_id: store.session_id.trim(),
        route_id: typeof store.route_id === "string" ? store.route_id : "",
        expires_at: new Date(Date.now() + timeout * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_db,is_service" });
      if (storeErr) return json({ error: storeErr.message }, 500);
      return json({ ok: true, stored: true });
    }

    // ── 1) Sessão em cache ainda válida? ────────────────────────────────
    // Evita um /Login novo a cada integração (ex.: PagCorp em lote).
    // Margem de segurança de 2 min antes do vencimento real.
    if (!force) {
      const { data: cachedRows } = await admin
        .from("erp_session_cache")
        .select("session_id, route_id, sap_user, expires_at, is_service")
        .eq("user_id", user.id)
        .eq("company_db", companyDb);
      const rows = (cachedRows || []) as Array<{
        session_id: string; route_id: string | null; sap_user: string | null;
        expires_at: string | null; is_service: boolean | null;
      }>;
      // Preferimos sempre a sessão do próprio usuário; a de serviço só entra
      // quando o fluxo permite (leituras).
      const cached = rows.find((r) => !r.is_service) || (allowService ? rows.find((r) => r.is_service) : undefined);
      const cachedExp = cached?.expires_at ? Date.parse(cached.expires_at) : 0;
      if (cached?.session_id && cachedExp - SAFETY_MS > Date.now()) {
        return json({
          sessionId: cached.session_id,
          routeId: cached.route_id || "",
          companyDB: companyDb,
          sapUser: cached.sap_user,
          sessionTimeout: Math.max(1, Math.floor((cachedExp - Date.now()) / 60000)),
          cached: true,
          service: cached.is_service === true,
        });
      }
    } else {
      await admin.from("erp_session_cache").delete()
        .eq("user_id", user.id).eq("company_db", companyDb);
    }
    const { data: cred, error: credErr } = await admin
      .from("user_sap_credentials")
      .select("sap_user, sap_password_encrypted")
      .eq("user_id", user.id)
      .eq("company_db", companyDb)
      .maybeSingle();
    if (credErr) throw credErr;

    let sapUserName = cred?.sap_user || "";
    let password = "";
    let usingService = false;

    if (cred) {
      password = await decryptSecret(cred.sap_password_encrypted);
    } else if (allowService) {
      // Sem senha provisionada: usa a credencial de serviço (ApiUser) da empresa.
      const svc = await getServiceCredentials(admin, companyDb);
      if (!svc) return json({ error: "no_credentials" }, 404);
      sapUserName = svc.username;
      password = svc.password;
      usingService = true;
    } else {
      return json({ error: "no_credentials" }, 404);
    }

    const baseUrl = await getSapBaseUrl(admin, companyDb);
    const effectiveCompanyDb = await getEffectiveCompanyDb(admin, companyDb);

    // Timeout curto + 1 retry: nunca deixar a função pendurada até o
    // idle timeout (150s) da plataforma quando o Service Layer não responde.
    let loginResp: Response;
    try {
      loginResp = await sapFetch(`${baseUrl}/Login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ UserName: sapUserName, Password: password, CompanyDB: effectiveCompanyDb }),
        timeoutMs: 15_000,
        maxAttempts: 2,
        baseDelayMs: 500,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sap-auto-login] Service Layer indisponível:", msg);
      return json({ error: "sap_unavailable", message: `SAP não respondeu ao login: ${msg}`, status: 504 }, 503);
    }

    if (!loginResp.ok) {
      const errText = await loginResp.text().catch(() => "");
      let errorMsg = "Falha no login SAP";
      let sapCode: number | undefined;
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed?.error?.message?.value || parsed?.error?.message || errorMsg;
        sapCode = parsed?.error?.code;
      } catch { /* ignore */ }
      return json({ error: errorMsg, sapCode, status: loginResp.status }, loginResp.status);
    }

    const loginData = await loginResp.json();
    const setCookie = loginResp.headers.get("set-cookie") || "";
    const routeMatch = /ROUTEID=([^;]+)/i.exec(setCookie);
    const routeId = routeMatch?.[1] || "";
    const sessionTimeout = Number(loginData?.SessionTimeout) > 0 ? Number(loginData.SessionTimeout) : 30;

    // Guarda a sessão para reuso das próximas integrações.
    try {
      await admin.from("erp_session_cache").upsert({
        user_id: user.id,
        company_db: companyDb,
        sap_user: sapUserName,
        session_id: loginData.SessionId,
        route_id: routeId,
        is_service: usingService,
        expires_at: new Date(Date.now() + sessionTimeout * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_db,is_service" });
    } catch (e) { console.error("[sap-auto-login] cache upsert", e); }

    try {
      await admin.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "sap_auto_login",
        entity_type: "erp_session",
        entity_id: companyDb,
        company_db: companyDb,
        details: { sap_user: sapUserName, service: usingService },
      });
    } catch { /* ignore audit failure */ }

    return json({
      sessionId: loginData.SessionId,
      routeId,
      companyDB: companyDb,
      sapUser: sapUserName,
      sessionTimeout,
      service: usingService,
    });
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[sap-auto-login]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
