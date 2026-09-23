// Aprovação em lote de prestações de contas diretamente no portal PagCorp.
//
// O portal não expõe API oficial para essa ação, então replicamos a chamada
// que o próprio portal faz (`/extrato/comprovantes/aprovar-lote`) a partir do
// servidor, usando a sessão que o usuário cola uma única vez na tela de
// Cartões Corporativos. O material de sessão é cifrado (AES-GCM) e nunca
// retorna ao cliente. Toda aprovação gera registro em audit_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { requireAdminOrSapModule, authErrorResponse } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { enforceRateLimit, rateLimitResponse, clientIpFrom } from "../_shared/rate-limit.ts";
import { encryptSecret, decryptSecret } from "../_shared/sap-cred-crypto.ts";

const PORTAL_BASE = "https://pagcorp-gestor.acgsa.com.br";
const APPROVE_PATH = "/extrato/comprovantes/aprovar-lote";
const SESSION_TTL_HOURS = 8;
const MAX_IDS = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readCookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (/^\d{1,20}$/.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let caller: Record<string, unknown>;
  try {
    caller = (await requireAdminOrSapModule(req, "pagcorp")) as Record<string, unknown>;
  } catch (err) {
    const resp = authErrorResponse(err, corsHeaders);
    if (resp) return resp;
    return json({ error: "Não autenticado" }, 401);
  }

  const ownerKey = String(
    (caller.email as string) || (caller.userName as string) || (caller.id as string) || "",
  ).trim().toLowerCase();
  if (!ownerKey) return json({ error: "Não foi possível identificar o usuário" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const action = String(body.action || "");
  const companyDb = String(body.company_db || "").trim();
  if (!companyDb) return json({ error: "company_db obrigatório" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const rl = await enforceRateLimit(admin, {
    scope: "pagcorp-portal-approve",
    identifier: ownerKey || clientIpFrom(req),
    max: 60,
    windowSeconds: 300,
  });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  try {
    if (action === "status") {
      const { data } = await admin
        .from("pagcorp_portal_sessions")
        .select("expires_at, portal_user, last_used_at, updated_at")
        .eq("company_db", companyDb)
        .eq("owner_key", ownerKey)
        .maybeSingle();
      const expired = !data || new Date(data.expires_at).getTime() <= Date.now();
      return json({
        connected: !!data && !expired,
        expired: !!data && expired,
        expires_at: data?.expires_at ?? null,
        portal_user: data?.portal_user ?? null,
        last_used_at: data?.last_used_at ?? null,
      });
    }

    if (action === "clear") {
      await admin
        .from("pagcorp_portal_sessions")
        .delete()
        .eq("company_db", companyDb)
        .eq("owner_key", ownerKey);
      return json({ ok: true });
    }

    if (action === "save-session") {
      const cookie = String(body.cookie || "").trim();
      const csrf = String(body.csrf_token || "").trim();
      if (!cookie || cookie.length > 8000) return json({ error: "Cookie da sessão inválido" }, 400);
      if (!/^[A-Za-z0-9]{20,120}$/.test(csrf)) return json({ error: "x-csrf-token inválido" }, 400);
      if (!readCookieValue(cookie, "pagcorp_acg_session")) {
        return json({ error: "Cookie não contém a sessão do portal (pagcorp_acg_session)" }, 400);
      }
      const xsrfRaw = String(body.xsrf_token || "").trim()
        || decodeURIComponent(readCookieValue(cookie, "XSRF-TOKEN") || "");
      if (!xsrfRaw) return json({ error: "Não foi possível obter o token XSRF" }, 400);

      const portalUser = readCookieValue(cookie, "remember_user");
      const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString();
      const { error } = await admin.from("pagcorp_portal_sessions").upsert({
        company_db: companyDb,
        owner_key: ownerKey,
        portal_user: portalUser,
        cookie_enc: await encryptSecret(cookie),
        csrf_token_enc: await encryptSecret(csrf),
        xsrf_token_enc: await encryptSecret(xsrfRaw),
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_db,owner_key" });
      if (error) return json({ error: `Falha ao salvar sessão: ${error.message}` }, 500);

      await admin.rpc("insert_audit_log", {
        p_action: "pagcorp_portal_session_saved",
        p_entity_type: "pagcorp_portal_session",
        p_entity_id: `${companyDb}:${ownerKey}`,
        p_company_db: companyDb,
        p_actor_email: ownerKey,
        p_details: { portal_user: portalUser, expires_at: expiresAt } as unknown as Record<string, unknown>,
      }).catch(() => {});

      return json({ ok: true, connected: true, expires_at: expiresAt, portal_user: portalUser });
    }

    if (action === "approve") {
      const ids = normalizeIds(body.accountability_ids);
      if (ids.length === 0) return json({ error: "Nenhuma prestação selecionada" }, 400);
      if (ids.length > MAX_IDS) return json({ error: `Máximo de ${MAX_IDS} prestações por lote` }, 400);
      const message = String(body.message || "").slice(0, 500);

      const { data: session } = await admin
        .from("pagcorp_portal_sessions")
        .select("cookie_enc, csrf_token_enc, xsrf_token_enc, expires_at")
        .eq("company_db", companyDb)
        .eq("owner_key", ownerKey)
        .maybeSingle();
      if (!session) return json({ error: "Sessão do portal não configurada", need_session: true }, 428);
      if (new Date(session.expires_at).getTime() <= Date.now()) {
        return json({ error: "Sessão do portal expirada — cole a sessão novamente", need_session: true }, 428);
      }

      const cookie = await decryptSecret(session.cookie_enc);
      const csrf = await decryptSecret(session.csrf_token_enc);
      const xsrf = await decryptSecret(session.xsrf_token_enc);

      // O portal envia os IDs como chaves do form-urlencoded, seguidos de `mensagem`.
      const payload = `${ids.join("&")}&mensagem=${encodeURIComponent(message)}`;

      const resp = await fetch(`${PORTAL_BASE}${APPROVE_PATH}`, {
        method: "POST",
        headers: {
          "accept": "application/json, text/plain, */*",
          "accept-language": "pt-BR,pt;q=0.9",
          "content-type": "application/x-www-form-urlencoded",
          "cookie": cookie,
          "origin": PORTAL_BASE,
          "referer": `${PORTAL_BASE}/extrato/comprovantes`,
          "x-csrf-token": csrf,
          "x-xsrf-token": xsrf,
          "x-requested-with": "XMLHttpRequest",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
        },
        body: payload,
      });

      const text = await resp.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* HTML/texto */ }

      const looksLikeLogin = /login|autentic/i.test(text) && resp.status >= 300;
      const ok = resp.ok && !looksLikeLogin;

      await admin
        .from("pagcorp_portal_sessions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("company_db", companyDb)
        .eq("owner_key", ownerKey);

      await admin.rpc("insert_audit_log", {
        p_action: ok ? "pagcorp_portal_batch_approved" : "pagcorp_portal_batch_approve_failed",
        p_entity_type: "pagcorp_accountability",
        p_entity_id: ids.join(","),
        p_company_db: companyDb,
        p_actor_email: ownerKey,
        p_details: {
          accountability_ids: ids,
          count: ids.length,
          message,
          http_status: resp.status,
          response: (parsed ?? text.slice(0, 500)) as unknown,
        } as unknown as Record<string, unknown>,
      }).catch(() => {});

      if (resp.status === 401 || resp.status === 419 || looksLikeLogin) {
        return json({
          error: "A sessão do portal PagCorp expirou. Abra o portal, copie a sessão novamente e tente de novo.",
          need_session: true,
        }, 428);
      }
      if (!resp.ok) {
        return json({ error: `PagCorp recusou a aprovação (HTTP ${resp.status})`, details: text.slice(0, 500) }, 502);
      }

      return json({ ok: true, approved: ids.length, accountability_ids: ids, response: parsed ?? text.slice(0, 500) });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (err) {
    console.error("[pagcorp-portal-approve]", err instanceof Error ? err.message : String(err));
    return json({ error: "Erro interno ao falar com o portal PagCorp" }, 500);
  }
});
