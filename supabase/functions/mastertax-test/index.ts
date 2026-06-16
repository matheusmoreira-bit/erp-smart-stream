// Edge function: mastertax-test
// Valida credenciais Master Tax chamando POST /api/gestor/retornaNotasPaginado
// (endpoint autenticado com Bearer JWT segundo a doc oficial https://apidocs.mastertax.app/).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { AuthError, requireAdminOrSapAdmin, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
};

const DEFAULT_BASE_URL = "https://api.mastertax.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE_URL;
}

function sanitizeCnpj(raw: string): string {
  return (raw || "").replace(/\D+/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireAdminOrSapAdmin(req);
    const callerCompanyDb =
      typeof (caller as { companyDB?: unknown }).companyDB === "string"
        ? (caller as { companyDB: string }).companyDB
        : null;

    const url = new URL(req.url);
    const companyDb = url.searchParams.get("company_db") || callerCompanyDb;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = admin
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "mastertax");
    q = companyDb ? q.eq("company_db", companyDb) : q.is("company_db", null);
    const { data: rows, error } = await q;
    if (error) throw error;

    if (!rows || rows.length === 0) {
      return json(
        { ok: false, error: "Nenhuma credencial Master Tax cadastrada para esta empresa." },
        404,
      );
    }

    const creds: Record<string, string> = {};
    for (const r of rows) creds[r.credential_key] = r.credential_value ?? "";

    const baseUrl = normalizeBaseUrl(creds.base_url || DEFAULT_BASE_URL);
    const token = (creds.token || "").trim();
    const cnpj = sanitizeCnpj(creds.cnpj || "");

    if (!token) return json({ ok: false, error: "Token Bearer não configurado." }, 400);

    const authHeader = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
    const target = `${baseUrl}/api/gestor/retornaNotasPaginado`;

    const today = new Date();
    const start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const body: Record<string, unknown> = { pagina: 1, limite: 1 };
    if (cnpj) {
      body.cnpj = cnpj;
      body.data_inicio = fmt(start);
      body.data_fim = fmt(today);
    }

    const started = Date.now();
    let resp: Response;
    try {
      resp = await fetch(target, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      return json(
        {
          ok: false,
          error: `Falha de rede ao acessar ${target}: ${e instanceof Error ? e.message : String(e)}`,
        },
        502,
      );
    }
    const elapsedMs = Date.now() - started;
    const bodyText = await resp.text().catch(() => "");
    const preview = bodyText.slice(0, 800);

    let parsed: { sucesso?: boolean; mensagem?: string; retorno?: unknown } | null = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }

    const success = resp.ok && parsed?.sucesso !== false;
    let totalNotas: number | null = null;
    let paginaAtual: number | null = null;
    if (parsed && typeof parsed.retorno === "object" && parsed.retorno !== null) {
      const r = parsed.retorno as Record<string, unknown>;
      if (typeof r.total === "number") totalNotas = r.total as number;
      if (typeof r.current_page === "number") paginaAtual = r.current_page as number;
    }

    return json({
      ok: success,
      status: resp.status,
      statusText: resp.statusText,
      elapsedMs,
      url: target,
      cnpj: cnpj || null,
      mensagem: parsed?.mensagem ?? null,
      totalNotas,
      paginaAtual,
      bodyPreview: preview,
      hint: success
        ? cnpj
          ? `Conexão OK — Master Tax respondeu para o CNPJ ${cnpj}.`
          : "Conexão OK — token aceito (sem filtro de CNPJ; configure o CNPJ para validar a empresa)."
        : resp.status === 401 || resp.status === 403
          ? "Credenciais rejeitadas pelo servidor (token inválido/expirado ou sem permissão)."
          : parsed?.mensagem
            ? `Erro retornado: ${parsed.mensagem}`
            : `HTTP ${resp.status} — verifique URL/token.`,
    });
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[mastertax-test] error:", err instanceof Error ? err.message : String(err));
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
});
