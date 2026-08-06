// Edge function: sap-suppliers-hana
// Lista fornecedores (ou clientes) a partir da view HANA VW_FORNECEDORES
// (ou VW_CLIENTES quando `isSales=true`). Usa Apiuser + middleware n8n, mesma
// mecânica de sap-purchase-orders-hana. Retorna as linhas prontas para o
// combobox: { code, name, extra, currency, frozen, taxId, fantasyName }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchHanaView } from "../_shared/hana-views.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db",
};

// Mapa: companyDB (Service Layer) -> schema HANA onde as views estão publicadas.
const HANA_SCHEMA_OVERRIDES: Record<string, string> = {
  open_gaming_sa: "SBO_OPENGAMING",
};

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${await r.text().catch(() => "")}`);
  const json = await r.json();
  const cookies = r.headers.get("set-cookie") || "";
  const routeMatch = cookies.match(/B1ROUTEID=([^;]+)/);
  return { sessionId: json.SessionId as string, routeId: routeMatch?.[1] ?? "" };
}

async function sapLogout(baseUrl: string, s: { sessionId: string; routeId: string }) {
  try {
    await fetch(`${baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}` },
    });
  } catch { /* ignore */ }
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
    // case-insensitive fallback
    const lk = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lk) {
        const rv = row[rk];
        if (rv !== undefined && rv !== null && rv !== "") return rv;
      }
    }
  }
  return undefined;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function isFrozen(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "tyes" || s === "y" || s === "s" || s === "sim" || s === "true" || s === "1";
}

function mapRow(raw: Record<string, unknown>) {
  const code = toStr(pick(raw, "CardCode", "Código", "Codigo", "Código PN", "Codigo PN", "Codigo_PN", "cardcode"));
  const name = toStr(pick(raw, "CardName", "Nome", "Nome do fornecedor", "Nome_PN", "Fornecedor", "Nome do PN", "cardname"));
  const alias = toStr(pick(raw, "AliasName", "Nome Fantasia", "NomeFantasia", "Fantasia", "aliasname"));
  const taxId = toStr(pick(raw, "CNPJ / CPF", "CNPJ/CPF", "CNPJ", "CPF", "FederalTaxID", "Documento fiscal", "TaxId", "TaxID", "federaltaxid"));
  const taxId0 = toStr(pick(raw, "U_FGR_TaxId0", "TaxId0", "u_fgr_taxid0"));
  const currency = toStr(pick(raw, "Currency", "Moeda", "currency"));
  const frozen = isFrozen(pick(raw, "Frozen", "Bloqueado", "frozen"));
  if (!code) return null;
  return {
    code,
    name: name || code,
    extra: taxId || taxId0 || undefined,
    currency: currency && currency !== "R$" ? currency : "BRL",
    frozen,
    details: {
      fantasyName: alias || undefined,
      taxId: taxId || taxId0 || undefined,
    },
  };
}

async function loadCreds(sb: any, companyDb: string): Promise<Record<string, string> | null> {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP erro: ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) return null;
  if (kv.use_hana_db === "false") return null;
  if ((kv.username || "").trim().toLowerCase() !== "apiuser") return null;
  return kv;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const companyDb: string | undefined =
      body?.company_db || url.searchParams.get("company_db") || req.headers.get("x-company-db") || undefined;
    const isSales = Boolean(body?.is_sales ?? url.searchParams.get("is_sales") === "true");

    if (!companyDb) {
      return new Response(JSON.stringify({ error: "company_db obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (isSales) {
      // VW_CLIENTES não existe — retornamos hana_unavailable para que o
      // client caia no fallback via Service Layer (BusinessPartners).
      return new Response(JSON.stringify({
        error: "hana_unavailable",
        message: "VW_CLIENTES não disponível; usar Service Layer.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Cache server-side (service role) — o client não tem permissão de escrita
    // em sap_cache, então a gravação precisa acontecer aqui.
    const CACHE_KEY = "suppliers_hana_v1";
    const CACHE_TTL_MS = 30 * 60 * 1000;
    const force = Boolean(body?.force);
    if (!force) {
      const { data: cached } = await sb
        .from("sap_cache")
        .select("data, expires_at")
        .eq("cache_key", CACHE_KEY)
        .eq("company_db", companyDb)
        .maybeSingle();
      const cachedRows = cached?.data as unknown[] | undefined;
      if (
        Array.isArray(cachedRows) && cachedRows.length > 0 &&
        cached?.expires_at && new Date(cached.expires_at as string) > new Date()
      ) {
        return new Response(
          JSON.stringify({ rows: cachedRows, total: cachedRows.length, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const creds = await loadCreds(sb, companyDb);
    if (!creds) {
      return new Response(JSON.stringify({
        error: "hana_unavailable",
        message: "Empresa não possui HanaAPI habilitada (Apiuser/use_hana_db).",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = buildBaseUrl(creds.service_layer_url);
    const dbName = creds.company_db || companyDb;
    const schema = HANA_SCHEMA_OVERRIDES[companyDb] || dbName;
    const session = await sapLogin(baseUrl, creds.username, creds.password, dbName);

    const view = "VW_FORNECEDORES";
    let rawRows: Record<string, unknown>[] = [];
    try {
      rawRows = await fetchHanaView({
        schema,
        view,
        sessionId: session.sessionId,
        hanaApiUrl: creds.hana_api_url,
        useV2: creds.use_hana_v2 === "true" || creds.hana_api_v2 === "true",
      });
    } finally {
      await sapLogout(baseUrl, session);
    }

    const rows = rawRows.map(mapRow).filter((r): r is NonNullable<ReturnType<typeof mapRow>> => !!r);

    // Dedup por code — mantém a primeira ocorrência
    const seen = new Set<string>();
    const deduped: typeof rows = [];
    for (const r of rows) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      deduped.push(r);
    }

    if (deduped.length > 0) {
      await sb.from("sap_cache").upsert(
        {
          cache_key: CACHE_KEY,
          company_db: companyDb,
          data: deduped,
          expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
        },
        { onConflict: "cache_key,company_db" },
      );
    }

    return new Response(JSON.stringify({ rows: deduped, view, schema, total: deduped.length, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
// schema fix: SBO_OPENGAMING 1784592109
