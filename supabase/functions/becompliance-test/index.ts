// Edge function: becompliance-test
// Valida as credenciais do BeCompliance (KYP): faz o login e, opcionalmente,
// executa uma consulta de diligência para um CNPJ/CPF informado, devolvendo
// status HTTP e trecho da resposta para diagnóstico.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { AuthError, requireAdminOrSapAdmin, authErrorResponse } from "../_shared/auth.ts";
import { loadBeComplianceCredentials, missingBeComplianceFields } from "../_shared/kyp/config.ts";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
};

const DEFAULT_BASE_URL = "https://api.becompliance.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function onlyDigits(v: string) {
  return (v || "").replace(/\D+/g, "");
}

function formatCPF(v: string) {
  const d = onlyDigits(v).padStart(11, "0");
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

async function call(url: string, init: RequestInit, timeoutMs = 25_000) {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* texto puro */ }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - started,
      preview: text.slice(0, 400),
      parsed,
      url,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      statusText: "network",
      elapsedMs: Date.now() - started,
      preview: e instanceof Error ? e.message : String(e),
      parsed: null,
      url,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Chamadas internas com a service role key (diagnóstico da plataforma)
    // dispensam a checagem de admin — a chave nunca chega ao navegador.
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const isServiceCall = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const caller = isServiceCall ? {} : await requireAdminOrSapAdmin(req);
    const callerCompanyDb =
      typeof (caller as { companyDB?: unknown }).companyDB === "string"
        ? (caller as { companyDB: string }).companyDB
        : null;

    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const companyDb = (body as any)?.company_db || url.searchParams.get("company_db") || callerCompanyDb;
    const documento = String((body as any)?.documento ?? url.searchParams.get("documento") ?? "").trim();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const kv = await loadBeComplianceCredentials(admin as any, companyDb);
    const missing = missingBeComplianceFields(kv);
    if (missing.length) {
      return json({
        ok: false,
        error: `Credenciais BeCompliance incompletas: faltando ${missing.join(", ")}.`,
        hint: "Preencha Client ID, e-mail e senha na tela de Credenciais.",
      }, 400);
    }

    const clientId = (kv.client_id || Deno.env.get("BECOMPLIANCE_CLIENT_ID") || "").trim();
    const base = (kv.base_url || Deno.env.get("BECOMPLIANCE_BASE_URL") || DEFAULT_BASE_URL)
      .trim().replace(/\/+$/, "");
    const email = (kv.email || Deno.env.get("BECOMPLIANCE_EMAIL") || "").trim();
    const password = kv.password || Deno.env.get("BECOMPLIANCE_PASSWORD") || "";

    // 1) Login
    const loginUrl = `${base}/ext/v1/${clientId}/auth/login`;
    const login = await call(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!login.ok) {
      return json({
        ok: false,
        status: login.status,
        elapsedMs: login.elapsedMs,
        url: loginUrl,
        bodyPreview: login.preview,
        error: `Login BeCompliance falhou (HTTP ${login.status || "rede"})`,
        hint: login.status === 401 || login.status === 403
          ? "E-mail/senha rejeitados pelo BeCompliance."
          : login.status === 404
          ? "Client ID ou URL base incorretos (endpoint /ext/v1/{client_id}/auth/login não encontrado)."
          : "Verifique URL base, Client ID e conectividade.",
      });
    }

    const obj = (login.parsed ?? {}) as Record<string, unknown>;
    const token = String(
      obj.token ?? obj.access_token ?? obj.accessToken ??
        ((obj.data as Record<string, unknown> | undefined)?.token ?? ""),
    );
    if (!token) {
      return json({
        ok: false,
        status: login.status,
        url: loginUrl,
        bodyPreview: login.preview,
        error: "Login respondeu 200 mas não retornou token.",
      });
    }

    // 2) Consulta opcional de diligência
    let consulta: Awaited<ReturnType<typeof call>> | null = null;
    if (documento) {
      const digits = onlyDigits(documento);
      const isPF = digits.length <= 11;
      const consultaUrl = isPF
        ? `${base}/${clientId}/due_diligence?document_number=${encodeURIComponent(formatCPF(digits))}` +
          `&archived=false&np_type=external&module=compliance`
        : `${base}/ext/v1/${clientId}/third-party-analysis?cnpj=${encodeURIComponent(digits)}`;
      consulta = await call(consultaUrl, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
    }

    const consultaOk = !consulta || consulta.ok || consulta.status === 404;
    return json({
      ok: consultaOk,
      status: consulta?.status ?? login.status,
      elapsedMs: (login.elapsedMs) + (consulta?.elapsedMs ?? 0),
      url: consulta?.url ?? loginUrl,
      bodyPreview: consulta?.preview ?? undefined,
      hint: consultaOk
        ? documento
          ? consulta && consulta.status === 404
            ? "Login OK. Documento sem diligência cadastrada (404) — credenciais válidas."
            : "Login e consulta de diligência OK."
          : "Login OK — credenciais válidas."
        : `Login OK, mas a consulta falhou (HTTP ${consulta?.status}). ${
          consulta?.status === 401 ? "Token não aceito no endpoint de consulta." : "Verifique o Client ID/base URL."
        }`,
    });
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[becompliance-test] error:", err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
