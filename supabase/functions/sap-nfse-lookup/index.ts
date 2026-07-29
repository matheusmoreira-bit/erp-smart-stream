// Edge function: sap-nfse-lookup
// Retorna o número REAL da NFS-e (autorizada pela prefeitura) para notas de
// venda do SAP B1. O campo nativo `SequenceSerial` do Service Layer traz o
// número do RPS, não o número da NFS-e. O addon fiscal (TaxOne) grava o número
// autorizado em SBO_TaxOne.Doc.SerialNfSe, ligado por (EntityId, DocType, DocEntry).
//
// Entrada: { company_db: string, doc_entries: number[], doc_type?: number }
// Saída:   { map: { [docEntry]: { nfse, rps, key, authorized_at, status } } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchHanaView, resolveHanaSchema } from "../_shared/hana-views.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db",
};

const TAXONE_SCHEMA = "SBO_TaxOne";
/** DocType do addon fiscal: 13 = Invoices (NF de saída de serviço). */
const DEFAULT_DOC_TYPE = 13;

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
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s !== "0" ? s : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const companyDb: string | undefined = body?.company_db || req.headers.get("x-company-db") || undefined;
    const docType = Number(body?.doc_type ?? DEFAULT_DOC_TYPE);
    const docEntries: number[] = Array.isArray(body?.doc_entries)
      ? (body.doc_entries as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];

    if (!companyDb) {
      return new Response(JSON.stringify({ error: "company_db obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (docEntries.length === 0) {
      return new Response(JSON.stringify({ map: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const creds = await loadCreds(sb, companyDb);
    if (!creds) {
      // Sem HanaAPI para esta base — devolve vazio (frontend mantém fallback do SL).
      return new Response(JSON.stringify({ map: {}, unavailable: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = buildBaseUrl(creds.service_layer_url);
    const dbName = creds.company_db || companyDb;
    const schema = resolveHanaSchema(companyDb, dbName);
    const session = await sapLogin(baseUrl, creds.username, creds.password, dbName);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map: Record<string, any> = {};
    try {
      // 1) Entidades fiscais (TaxOne) vinculadas ao schema/base da empresa.
      const entities = await fetchHanaView({
        schema: TAXONE_SCHEMA,
        view: "Entidade",
        sessionId: session.sessionId,
        hanaApiUrl: creds.hana_api_url,
        limit: 200,
        filters: { CompanyDb__eq: schema },
      });
      const entityIds = entities
        .map((e) => Number(e.id))
        .filter((n) => Number.isFinite(n));
      if (entityIds.length === 0) {
        return new Response(JSON.stringify({ map: {}, unavailable: true, reason: "entidade_fiscal_nao_encontrada" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2) Documentos fiscais do addon, em blocos para não estourar a querystring.
      const CHUNK = 120;
      for (let i = 0; i < docEntries.length; i += CHUNK) {
        const chunk = docEntries.slice(i, i + CHUNK);
        const rows = await fetchHanaView({
          schema: TAXONE_SCHEMA,
          view: "Doc",
          sessionId: session.sessionId,
          hanaApiUrl: creds.hana_api_url,
          limit: CHUNK * entityIds.length,
          filters: {
            EntityId__in: entityIds.join(","),
            DocType__eq: docType,
            DocEntry__in: chunk.join(","),
          },
        });
        for (const row of rows) {
          const docEntry = Number(row.DocEntry);
          if (!Number.isFinite(docEntry)) continue;
          const nfse = toStr(row.SerialNfSe);
          if (!nfse) continue;
          const prev = map[String(docEntry)];
          const authorizedAt = toStr(row.DataAutorizacao);
          // Em caso de reemissão/substituição, prevalece a autorização mais recente.
          if (prev && prev.authorized_at && authorizedAt && prev.authorized_at >= authorizedAt) continue;
          map[String(docEntry)] = {
            nfse,
            rps: row.NumRPS != null ? String(row.NumRPS) : null,
            serie: toStr(row.SerieCustomizada),
            key: toStr(row.KeyNfe),
            batch: row.BatchId != null ? String(row.BatchId) : null,
            status: row.StatusId != null ? Number(row.StatusId) : null,
            authorized_at: authorizedAt,
          };
        }
      }
    } finally {
      await sapLogout(baseUrl, session);
    }

    return new Response(JSON.stringify({ map }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sap-nfse-lookup]", (e as Error)?.message);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e), map: {} }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
