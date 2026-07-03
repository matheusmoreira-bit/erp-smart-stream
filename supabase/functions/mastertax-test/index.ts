// Edge function: mastertax-test
// Valida credenciais Master Tax chamando GET /api/notas-servico
// (endpoint autenticado com Bearer token, filtrado por empresa_id).

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
    const empresaIdsRaw = (creds.empresa_id || "").trim();
    const empresaIds = empresaIdsRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const cnpj = sanitizeCnpj(creds.cnpj || "");

    if (!token) return json({ ok: false, error: "Token Bearer não configurado." }, 400);
    if (empresaIds.length === 0) return json({ ok: false, error: "Nenhum Empresa ID configurado." }, 400);

    const authHeader = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;

    const today = new Date();
    const start = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const results: Array<{
      empresaId: string;
      ok: boolean;
      status: number;
      elapsedMs: number;
      total: number | null;
      error?: string;
    }> = [];

    let lastUrl = "";
    let lastPreview = "";
    let lastStatus = 0;
    let lastStatusText = "";
    let totalOk = 0;
    let totalNotasSum = 0;
    let totalElapsed = 0;

    for (const empresaId of empresaIds) {
      const params = new URLSearchParams({
        empresa_id: empresaId,
        competencia: fmt(today).slice(0, 7),
        emissaoDe: fmt(start),
        emissaoAte: fmt(today),
        dataArmazenamentoInicio: fmt(start),
        dataArmazenamentoFim: fmt(today),
        pagina: "1",
        quantidade: "1",
        ordenar: "dataEmissao",
        sentido: "desc",
        tipo: "Tomador",
        retencoes: "todas",
      });
      const target = `${baseUrl}/api/notas-servico?${params.toString()}`;
      lastUrl = target;

      const started = Date.now();
      let resp: Response;
      try {
        resp = await fetch(target, {
          method: "GET",
          headers: { Authorization: authHeader, Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        results.push({
          empresaId,
          ok: false,
          status: 0,
          elapsedMs: Date.now() - started,
          total: null,
          error: `Falha de rede: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
      const elapsedMs = Date.now() - started;
      totalElapsed += elapsedMs;
      const bodyText = await resp.text().catch(() => "");
      lastPreview = bodyText.slice(0, 400);
      lastStatus = resp.status;
      lastStatusText = resp.statusText;

      let parsed: any = null;
      try { parsed = JSON.parse(bodyText); } catch { parsed = null; }
      let totalNotas: number | null = null;
      if (parsed && typeof parsed === "object") {
        const candidates = [parsed?.retorno, parsed?.meta, parsed?.pagination, parsed];
        for (const c of candidates) {
          if (c && typeof c === "object" && typeof (c as any).total === "number") {
            totalNotas = (c as any).total;
            break;
          }
        }
      }
      if (resp.ok) {
        totalOk++;
        if (typeof totalNotas === "number") totalNotasSum += totalNotas;
      }
      results.push({
        empresaId,
        ok: resp.ok,
        status: resp.status,
        elapsedMs,
        total: totalNotas,
        error: resp.ok ? undefined : `HTTP ${resp.status} ${bodyText.slice(0, 160)}`,
      });
    }

    const allOk = totalOk === empresaIds.length;
    return json({
      ok: allOk,
      status: lastStatus,
      statusText: lastStatusText,
      elapsedMs: totalElapsed,
      url: lastUrl,
      empresaIds,
      cnpj: cnpj || null,
      totalEmpresas: empresaIds.length,
      okEmpresas: totalOk,
      totalNotas: totalNotasSum,
      perEmpresa: results,
      bodyPreview: lastPreview,
      hint: allOk
        ? `Conexão OK — Master Tax respondeu para ${empresaIds.length} empresa(s) (${totalNotasSum} nota(s) nos últimos 60 dias).`
        : `${totalOk}/${empresaIds.length} empresa(s) responderam OK. Verifique os IDs com falha.`,
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
