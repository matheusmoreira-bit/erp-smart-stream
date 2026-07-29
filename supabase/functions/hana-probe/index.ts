// Edge function: hana-probe (diagnóstico)
// Consulta uma tabela/view arbitrária do HanaAPI V2 para descobrir o que o
// gateway realmente expõe (ex.: tabelas do addon fiscal TaxOne com XML/PDF).
//
// Body: { company_db: string, schema?: string, table: string, limit?: number,
//         filters?: Record<string,string|number>, columns?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchHanaView, resolveHanaSchema } from "../_shared/hana-views.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db",
};

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  const j = await r.json();
  return j.SessionId as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "").trim();
    const tables: string[] = Array.isArray(body?.tables)
      ? body.tables.map(String)
      : body?.table
      ? [String(body.table)]
      : [];
    if (!companyDb || tables.length === 0) return json({ error: "company_db e table(s) obrigatórios" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await sb
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb);
    const kv: Record<string, string> = {};
    for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
      kv[r.credential_key] = r.credential_value ?? "";
    }
    if (!kv.service_layer_url || !kv.username || !kv.password) return json({ error: "sem credenciais" }, 400);

    const dbName = kv.company_db || companyDb;
    const sessionId = await sapLogin(buildBaseUrl(kv.service_layer_url), kv.username, kv.password, dbName);
    const defaultSchema = String(body?.schema || resolveHanaSchema(companyDb, dbName));
    const limit = Number(body?.limit ?? 1);

    const results: Record<string, unknown> = {};
    for (const t of tables) {
      const [schema, table] = t.includes(".") ? [t.split(".")[0], t.split(".").slice(1).join(".")] : [defaultSchema, t];
      try {
        const rows = await fetchHanaView({
          schema,
          view: table,
          sessionId,
          hanaApiUrl: kv.hana_api_url,
          limit,
          filters: (body?.filters || {}) as Record<string, string | number>,
        });
        results[`${schema}.${table}`] = {
          ok: true,
          count: rows.length,
          columns: rows[0] ? Object.keys(rows[0]) : [],
          sample: rows.slice(0, Number(body?.sample ?? 1)),
        };
      } catch (e) {
        results[`${schema}.${table}`] = { ok: false, error: String((e as Error)?.message || e).slice(0, 400) };
      }
    }
    return json({ results });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
