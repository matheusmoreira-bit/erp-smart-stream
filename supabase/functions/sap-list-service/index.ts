// Edge function: sap-list-service
// Fetches a paginated SAP Service Layer list (Items, BusinessPartners,
// CostCenters, Projects, ItemGroups, etc.) using the company's Apiuser
// credentials — bypassing per-user SAP authorization restrictions so that
// combobox lists are consistent regardless of who is logged in.
//
// Body:
//   { company_db: string, endpoint: string, params?: Record<string,string|number>, page_size?: number }
// Response:
//   { rows: any[], total: number, source: "apiuser" }
// Error:
//   4xx { error: string, code?: "no_apiuser" | "invalid_request" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sapFetch } from "../_shared/sap-fetch.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db",
};

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (!/\/b1s\/v\d+/.test(url)) url = `${url}/b1s/v1`;
  return url;
}

async function loadApiuserCreds(sb: any, companyDb: string): Promise<Record<string, string> | null> {
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
  if ((kv.username || "").trim().toLowerCase() !== "apiuser") return null;
  return kv;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string) {
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
    timeoutMs: 20_000,
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${await r.text().catch(() => "")}`);
  const json = await r.json();
  const cookies = r.headers.get("set-cookie") || "";
  const routeMatch = cookies.match(/B1ROUTEID=([^;]+)/);
  return { sessionId: json.SessionId as string, routeId: routeMatch?.[1] ?? "" };
}

async function sapLogout(baseUrl: string, s: { sessionId: string; routeId: string }) {
  try {
    await sapFetch(`${baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}` },
      timeoutMs: 10_000,
      maxAttempts: 1,
    });
  } catch { /* ignore */ }
}

function buildQS(params: Record<string, string | number> = {}, extra: Record<string, string | number> = {}): string {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...extra })) {
    if (v === undefined || v === null) continue;
    qp.set(k, String(v));
  }
  const s = qp.toString();
  return s ? `?${s}` : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const companyDb: string | undefined = body?.company_db || req.headers.get("x-company-db") || undefined;
    const endpoint: string | undefined = body?.endpoint;
    const params: Record<string, string | number> = body?.params || {};
    const pageSize: number = Math.min(Math.max(Number(body?.page_size) || 500, 20), 1000);

    if (!companyDb || !endpoint) {
      return new Response(
        JSON.stringify({ error: "company_db e endpoint são obrigatórios", code: "invalid_request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // Whitelist mínima para evitar uso arbitrário
    const safeEndpoint = /^[A-Za-z0-9_/'()]+$/.test(endpoint);
    if (!safeEndpoint) {
      return new Response(
        JSON.stringify({ error: "endpoint inválido", code: "invalid_request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const creds = await loadApiuserCreds(sb, companyDb);
    if (!creds) {
      return new Response(
        JSON.stringify({ error: "Apiuser não configurado para esta empresa", code: "no_apiuser" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const baseUrl = buildBaseUrl(creds.service_layer_url);
    const dbName = creds.company_db || companyDb;
    const session = await sapLogin(baseUrl, creds.username, creds.password, dbName);

    const cookieHeader = `B1SESSION=${session.sessionId}${session.routeId ? `; B1ROUTEID=${session.routeId}` : ""}`;
    const all: any[] = [];
    try {
      let skip = 0;
      // Paginação: SL retorna @odata.nextLink com $skip; fazemos manualmente.
      while (true) {
        const qs = buildQS(params, { $top: pageSize, $skip: skip });
        const url = `${baseUrl}/${endpoint}${qs}`;
        const r = await sapFetch(url, {
          method: "GET",
          headers: {
            Cookie: cookieHeader,
            "B1S-PageSize": String(pageSize),
            Prefer: `odata.maxpagesize=${pageSize}`,
            "Content-Type": "application/json",
          },
          timeoutMs: 30_000,
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(`SAP ${endpoint} falhou [${r.status}]: ${text.slice(0, 300)}`);
        }
        const json = await r.json();
        const rows: any[] = Array.isArray(json?.value) ? json.value : [];
        all.push(...rows);
        if (rows.length < pageSize) break;
        skip += rows.length;
        if (skip > 50_000) break; // safety
      }
    } finally {
      await sapLogout(baseUrl, session);
    }

    return new Response(
      JSON.stringify({ rows: all, total: all.length, source: "apiuser" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
