// Edge function: nfse-xml-fetch
// Busca o XML autorizado da NFS-e direto do HANA (addon fiscal TaxOne), via
// HanaAPI V2, usando a view SBO_TaxOne.VW_NFSE_XML_AUTORIZADO — que devolve o
// BLOB fatiado em chunks hex (o gateway não serializa BLOB).
//
// Body: { company_db: string, doc_entry: number }
// Saída: { ok, path, signed_url, nfse, batch_id, bytes } | { unavailable, reason }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchHanaView, resolveHanaSchema } from "../_shared/hana-views.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db",
};

const TAXONE_SCHEMA = "SBO_TaxOne";
const XML_VIEW = "VW_NFSE_XML_AUTORIZADO";
const BUCKET = "nfse-xmls";
/** DocType do addon fiscal: 13 = Invoices (NF de saída de serviço). */
const DEFAULT_DOC_TYPE = 13;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
  if (!r.ok) {
    throw new Error(`Login SAP falhou ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  }
  const j = await r.json();
  const routeId = (r.headers.get("set-cookie") || "").match(/B1ROUTEID=([^;]+)/)?.[1] ?? "";
  return { sessionId: j.SessionId as string, routeId };
}

async function sapLogout(baseUrl: string, s: { sessionId: string; routeId: string }) {
  try {
    await fetch(`${baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}` },
    });
  } catch { /* ignore */ }
}

// deno-lint-ignore no-explicit-any
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

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    // Autenticação: exige JWT de usuário real.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || req.headers.get("x-company-db") || "").trim();
    const docEntry = Number(body?.doc_entry);
    const docType = Number(body?.doc_type ?? DEFAULT_DOC_TYPE);
    if (!companyDb) return json({ error: "company_db obrigatório" }, 400);
    if (!Number.isFinite(docEntry) || docEntry <= 0) return json({ error: "doc_entry inválido" }, 400);

    const creds = await loadCreds(admin, companyDb);
    if (!creds) return json({ unavailable: true, reason: "hana_indisponivel" });

    const baseUrl = buildBaseUrl(creds.service_layer_url);
    const dbName = creds.company_db || companyDb;
    const schema = resolveHanaSchema(companyDb, dbName);
    const session = await sapLogin(baseUrl, creds.username, creds.password, dbName);

    try {
      // 1) Entidade fiscal → 2) Doc do addon (para achar o BatchId da nota).
      const entities = await fetchHanaView({
        schema: TAXONE_SCHEMA,
        view: "Entidade",
        sessionId: session.sessionId,
        hanaApiUrl: creds.hana_api_url,
        limit: 200,
        filters: { CompanyDb__eq: schema },
      });
      const entityIds = entities.map((e) => Number(e.id)).filter((n) => Number.isFinite(n));
      if (entityIds.length === 0) return json({ unavailable: true, reason: "entidade_fiscal_nao_encontrada" });

      const docs = await fetchHanaView({
        schema: TAXONE_SCHEMA,
        view: "Doc",
        sessionId: session.sessionId,
        hanaApiUrl: creds.hana_api_url,
        limit: 50,
        filters: {
          EntityId__in: entityIds.join(","),
          DocType__eq: docType,
          DocEntry__eq: docEntry,
        },
      });
      const doc = docs
        .filter((d) => d.BatchId != null)
        .sort((a, b) => String(b.DataAutorizacao ?? "").localeCompare(String(a.DataAutorizacao ?? "")))[0];
      if (!doc) return json({ unavailable: true, reason: "documento_fiscal_nao_encontrado" });

      const batchId = Number(doc.BatchId);
      const nfse = doc.SerialNfSe != null ? String(doc.SerialNfSe) : null;

      // 3) XML fatiado em chunks hex.
      let chunks: Record<string, unknown>[];
      try {
        chunks = await fetchHanaView({
          schema: TAXONE_SCHEMA,
          view: XML_VIEW,
          sessionId: session.sessionId,
          hanaApiUrl: creds.hana_api_url,
          limit: 500,
          filters: { BatchId__eq: batchId },
        });
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        if (msg.includes("404")) return json({ unavailable: true, reason: "view_xml_nao_publicada" });
        throw e;
      }
      if (chunks.length === 0) return json({ unavailable: true, reason: "xml_nao_encontrado", batch_id: batchId });

      // Agrupa por evento/data (reemissões) e fica com a autorização mais recente.
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const row of chunks) {
        const key = `${row.Evento ?? ""}|${row.DateReturn ?? ""}|${row.StatusId ?? ""}`;
        const list = groups.get(key) || [];
        list.push(row);
        groups.set(key, list);
      }
      const bestKey = [...groups.keys()].sort((a, b) => b.localeCompare(a))[0];
      const rows = (groups.get(bestKey) || []).sort(
        (a, b) => Number(a.ChunkSeq ?? 0) - Number(b.ChunkSeq ?? 0),
      );

      const bytes = concatBytes(rows.map((r) => hexToBytes(String(r.XmlHex ?? ""))));
      if (bytes.byteLength === 0) return json({ unavailable: true, reason: "xml_vazio", batch_id: batchId });

      const path = `${companyDb}/${docEntry}.xml`;
      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, { upsert: true, contentType: "application/xml" });
      if (upErr) throw new Error(`Falha ao salvar XML: ${upErr.message}`);

      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);

      return json({
        ok: true,
        path,
        signed_url: signed?.signedUrl ?? null,
        nfse,
        batch_id: batchId,
        bytes: bytes.byteLength,
      });
    } finally {
      await sapLogout(baseUrl, session);
    }
  } catch (e) {
    console.error("[nfse-xml-fetch]", (e as Error)?.message);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
