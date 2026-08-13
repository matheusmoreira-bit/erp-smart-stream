import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import { decryptSecret } from "../_shared/sap-cred-crypto.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

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
        session_id: store.session_id.trim(),
        route_id: typeof store.route_id === "string" ? store.route_id : "",
        expires_at: new Date(Date.now() + timeout * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_db" });
      if (storeErr) return json({ error: storeErr.message }, 500);
      return json({ ok: true, stored: true });
    }

    // ── 1) Sessão em cache ainda válida? ────────────────────────────────
    // Evita um /Login novo a cada integração (ex.: PagCorp em lote).
    // Margem de segurança de 2 min antes do vencimento real.
    if (!force) {
      const { data: cached } = await admin
        .from("erp_session_cache")
        .select("session_id, route_id, sap_user, expires_at")
        .eq("user_id", user.id)
        .eq("company_db", companyDb)
        .maybeSingle();
      const cachedExp = cached?.expires_at ? Date.parse(cached.expires_at) : 0;
      if (cached?.session_id && cachedExp - SAFETY_MS > Date.now()) {
        return json({
          sessionId: cached.session_id,
          routeId: cached.route_id || "",
          companyDB: companyDb,
          sapUser: cached.sap_user,
          sessionTimeout: Math.max(1, Math.floor((cachedExp - Date.now()) / 60000)),
          cached: true,
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
    if (!cred) return json({ error: "no_credentials" }, 404);

    const password = await decryptSecret(cred.sap_password_encrypted);
    const baseUrl = await getSapBaseUrl(admin, companyDb);
    const effectiveCompanyDb = await getEffectiveCompanyDb(admin, companyDb);

    const loginResp = await fetch(`${baseUrl}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ UserName: cred.sap_user, Password: password, CompanyDB: effectiveCompanyDb }),
    });

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
        sap_user: cred.sap_user,
        session_id: loginData.SessionId,
        route_id: routeId,
        expires_at: new Date(Date.now() + sessionTimeout * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_db" });
    } catch (e) { console.error("[sap-auto-login] cache upsert", e); }

    try {
      await admin.from("audit_log").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "sap_auto_login",
        entity_type: "erp_session",
        entity_id: companyDb,
        company_db: companyDb,
        details: { sap_user: cred.sap_user },
      });
    } catch { /* ignore audit failure */ }

    return json({
      sessionId: loginData.SessionId,
      routeId,
      companyDB: companyDb,
      sapUser: cred.sap_user,
      sessionTimeout,
    });
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[sap-auto-login]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
