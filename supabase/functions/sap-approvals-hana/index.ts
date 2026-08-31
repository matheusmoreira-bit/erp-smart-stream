import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
// Edge function: sap-approvals-hana
// Consulta a view VW_APROVACOES_DETALHADAS via HanaAPI V2 usando a sessão
// SAP do usuário logado. Se a sessão do usuário estiver expirada (401 na HANA),
// retorna 401 com código SAP_SESSION_EXPIRED para que o cliente redirecione
// o usuário à tela de login — NÃO fazemos fallback com apiuser.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchHanaView } from "../_shared/hana-views.ts";
import { sapSessionLogin, buildSapBaseUrl } from "../_shared/sap-cache.ts";
import {
  requireUser,
  validateSapSession,
  requireUserOrSapSession,
  authErrorResponse,
  AuthError,
} from "../_shared/auth.ts";
import {
  canViewAllDocuments,
  identityMatches,
  personMatches,
  personListMatches,
} from "../_shared/permission-groups.ts";
import { resolveCallerAliases } from "../_shared/user-aliases.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-company-db",
};

const HANA_SCHEMA_OVERRIDES: Record<string, string> = {
  open_gaming_sa: "SBO_OPENGAMING",
};

type HanaRow = Record<string, unknown>;

/** Identifica quem chamou (Cloud user ou sessão SAP), sem derrubar a request. */
async function resolveCaller(req: Request): Promise<{ email?: string; userName?: string; id?: string } | null> {
  try {
    const user = await requireUser(req);
    const u = user as { id?: string; email?: string };
    return { id: u.id, email: u.email };
  } catch (_e) {
    const sap = await validateSapSession(req).catch(() => null);
    if (!sap) return null;
    const s = sap as { sapUser?: string; email?: string };
    return { userName: s.sapUser, email: s.email };
  }
}

/**
 * Confidencialidade: a view devolve TODAS as pendências da empresa. Cada
 * usuário só pode receber o que ele aprova (ou o que ele mesmo solicitou).
 * Apenas grupos com visão total (`expenses_view_all`/`approvals_view_all`)
 * recebem a lista completa.
 */
async function scopeRowsToCaller(
  admin: SupabaseClient,
  req: Request,
  rows: HanaRow[],
): Promise<HanaRow[]> {
  const caller = await resolveCaller(req);
  if (!caller) throw new AuthError("Não autenticado", 401);

  const identities = [caller.email, caller.userName].filter(Boolean) as string[];
  if (await canViewAllDocuments(admin, identities)) return rows;

  const aliases = Array.from(await resolveCallerAliases(admin, caller));
  const all = [...new Set([...identities, ...aliases])];
  if (all.length === 0) return [];

  const matches = (value: unknown) =>
    all.some((ident) =>
      identityMatches(ident, value) || personMatches(ident, value) || personListMatches(value, ident),
    );

  return rows.filter((row) =>
    matches(row["Email do aprovador"]) ||
    matches(row["Aprovador"]) ||
    matches(row["Solicitante"]),
  );
}

Deno.serve(withEdgeMetrics("sap-approvals-hana", async (req, _mctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const companyDb: string | undefined =
      body?.company_db || url.searchParams.get("company_db") ||
      req.headers.get("x-company-db") || undefined;
    const sessionId: string | undefined =
      body?.session_id || url.searchParams.get("session_id") ||
      req.headers.get("x-sap-session") || undefined;
    const schemaOverride: string | undefined =
      body?.schema || url.searchParams.get("schema") || undefined;

    if (!companyDb) {
      return new Response(JSON.stringify({ error: "company_db obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: credsRows } = await sb
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb);
    const creds: Record<string, string> = {};
    for (const r of (credsRows || []) as Array<{ credential_key: string; credential_value: string }>) {
      creds[r.credential_key] = r.credential_value ?? "";
    }

    // Sem sessão do usuário (login desacoplado / impersonação sem senha
    // provisionada): a leitura da view é feita com a credencial técnica da
    // empresa, mas só depois de validar a identidade de quem chamou.
    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      try {
        await requireUserOrSapSession(req);
      } catch (authErr) {
        return authErrorResponse(authErr, corsHeaders);
      }
      if (!creds.service_layer_url || !creds.username || !creds.password) {
        return new Response(
          JSON.stringify({ error: "Sessão SAP inválida ou expirada. Faça login novamente.", code: "SAP_SESSION_EXPIRED" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const tech = await sapSessionLogin(
        buildSapBaseUrl(creds.service_layer_url),
        companyDb,
        creds.username,
        creds.password,
      );
      effectiveSessionId = tech.sessionId;
    }

    const schema = schemaOverride || HANA_SCHEMA_OVERRIDES[companyDb] || companyDb;

    try {
      const rows = await fetchHanaView({
        schema,
        view: "VW_APROVACOES_DETALHADAS",
        sessionId: effectiveSessionId,
        hanaApiUrl: creds.hana_api_url || null,
      });
      let scoped: HanaRow[];
      try {
        scoped = await scopeRowsToCaller(sb, req, (rows || []) as HanaRow[]);
      } catch (authErr) {
        return authErrorResponse(authErr, corsHeaders);
      }
      return new Response(JSON.stringify({ schema, data: scoped }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/401/.test(msg) && /Session/i.test(msg)) {
        console.log(`[sap-approvals-hana] sessão SAP expirada (companyDb=${companyDb}) → redirecionar login`);
        return new Response(
          JSON.stringify({ error: "Sessão SAP inválida ou expirada. Faça login novamente.", code: "SAP_SESSION_EXPIRED" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }
  } catch (e) {
    const msg = (e as Error).message || "";
    // Login técnico recusado pelo SAP (credencial da empresa inválida/expirada)
    // não é erro de servidor: devolvemos 401 para o cliente pedir novo login.
    if (/Login SAP falhou 401|Fail to NONE-SSO login|SAP_SESSION_EXPIRED/.test(msg)) {
      console.log(`[sap-approvals-hana] credencial SAP recusada: ${msg.slice(0, 160)}`);
      return new Response(
        JSON.stringify({ error: "Sessão SAP inválida ou expirada. Faça login novamente.", code: "SAP_SESSION_EXPIRED", detail: msg.slice(0, 240) }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    console.error("[sap-approvals-hana] error", msg);
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

}));
