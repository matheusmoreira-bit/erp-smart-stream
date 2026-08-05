// Edge function: sales-nfse-transmit-watcher
//
// Garante que toda NFS-e criada pelo ERP Flow seja realmente TRANSMITIDA pelo
// addon fiscal, sem depender de clique manual no SAP.
//
// A cada execução:
//   1. Busca notas em `sales_order_invoices` com status `issued` e sem número
//      de NFS-e autorizado (nfse_number nulo), criadas nos últimos 30 dias.
//   2. Para cada empresa, faz login no Service Layer e lê o documento.
//   3. Se o UDF de fila do addon (U_XmlServiceStatus) não estiver marcado para
//      envio (vazio, "0" ou erro), aplica PATCH com "1" (enviar).
//   4. Consulta o número real da NFS-e via `sap-nfse-lookup`; quando disponível,
//      grava em `sales_order_invoices.nfse_number` e marca status `authorized`.
//
// Idempotente: pode rodar em cron (a cada 10 min) sem efeitos colaterais.
// Body opcional: { company_db?: string, doc_entry?: number } para forçar um doc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Valores do UDF que indicam "já está na fila / enviado / autorizado". */
const SENT_STATUSES = new Set(["1", "2", "3", "4"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildBaseUrl(raw: string): string {
  let url = String(raw || "").replace(/\/+$/, "");
  if (!url) throw new Error("URL do SAP B1 não configurada");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

// deno-lint-ignore no-explicit-any
async function loadCreds(sb: any, companyDb: string): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP: ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  return kv;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Login SAP falhou [${r.status}]: ${t.slice(0, 200)}`);
  }
  const j = await r.json().catch(() => ({}));
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = j?.SessionId || setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const rid = setCookie.match(/(?:B1)?ROUTEID=([^;]+)/)?.[1] || "";
  if (!sid) throw new Error("SAP não retornou SessionId.");
  return `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}`;
}

interface Row {
  id: string;
  company_db: string;
  sap_invoice_doc_entry: number | null;
  sap_invoice_doc_num: number | null;
  status: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const filterCompany = String(body?.company_db || "").trim() || null;
    const filterDocEntry = Number(body?.doc_entry) || null;

    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    let q = sb
      .from("sales_order_invoices")
      .select("id, company_db, sap_invoice_doc_entry, sap_invoice_doc_num, status")
      .in("status", ["issued"])
      .is("nfse_number", null)
      .not("sap_invoice_doc_entry", "is", null)
      .gte("created_at", cutoff)
      .limit(100);
    if (filterCompany) q = q.eq("company_db", filterCompany);
    if (filterDocEntry) q = q.eq("sap_invoice_doc_entry", filterDocEntry);

    const { data, error } = await q;
    if (error) throw new Error(`select: ${error.message}`);
    const rows = (data || []) as Row[];

    if (rows.length === 0) {
      return json({ ok: true, request_id: requestId, pending: 0, duration_ms: Date.now() - startedAt });
    }

    const byCompany = new Map<string, Row[]>();
    for (const r of rows) {
      if (!r.company_db) continue;
      const list = byCompany.get(r.company_db) ?? [];
      list.push(r);
      byCompany.set(r.company_db, list);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const [companyDb, list] of byCompany) {
      let cookies: string;
      let baseUrl: string;
      try {
        const creds = await loadCreds(sb, companyDb);
        if (!creds.service_layer_url || !creds.username || !creds.password) {
          results.push({ company_db: companyDb, error: "credenciais SAP ausentes" });
          continue;
        }
        if (String(creds.nfse_autosend ?? "true").toLowerCase() === "false") {
          results.push({ company_db: companyDb, skipped: "nfse_autosend desativado" });
          continue;
        }
        baseUrl = buildBaseUrl(creds.service_layer_url);
        cookies = await sapLogin(baseUrl, creds.username, creds.password, creds.company_db || companyDb);
      } catch (e) {
        results.push({ company_db: companyDb, error: (e as Error).message });
        continue;
      }

      for (const row of list) {
        const docEntry = Number(row.sap_invoice_doc_entry);
        const item: Record<string, unknown> = {
          company_db: companyDb,
          doc_entry: docEntry,
          doc_num: row.sap_invoice_doc_num,
        };
        try {
          const r = await fetch(`${baseUrl}/Invoices(${docEntry})`, { headers: { Cookie: cookies } });
          const doc = await r.json().catch(() => ({}));
          if (!r.ok) {
            item.error = `GET Invoice [${r.status}]`;
            results.push(item);
            continue;
          }
          if (String(doc?.Cancelled || "tNO") === "tYES") {
            await sb.from("sales_order_invoices")
              .update({ status: "cancelled", last_error: "Nota cancelada no ERP" })
              .eq("id", row.id);
            item.action = "marcada como cancelada";
            results.push(item);
            continue;
          }

          const current = doc?.U_XmlServiceStatus == null ? "" : String(doc.U_XmlServiceStatus).trim();
          item.xml_service_status = current || null;

          if (!SENT_STATUSES.has(current)) {
            const patch = await fetch(`${baseUrl}/Invoices(${docEntry})`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Cookie: cookies },
              body: JSON.stringify({ U_XmlServiceStatus: "1" }),
            });
            if (patch.ok) {
              item.action = "transmissão solicitada";
              await sb.from("sales_order_invoices")
                .update({ last_error: null })
                .eq("id", row.id);
            } else {
              const t = await patch.text().catch(() => "");
              item.error = `PATCH [${patch.status}]: ${t.slice(0, 200)}`;
              await sb.from("sales_order_invoices")
                .update({ last_error: String(item.error).slice(0, 1000) })
                .eq("id", row.id);
            }
          } else {
            item.action = "já estava na fila do addon";
          }
        } catch (e) {
          item.error = (e as Error).message?.slice(0, 200);
        }
        results.push(item);
      }

      // Número real da NFS-e (TaxOne) para as notas desta empresa.
      try {
        const entries = list.map((r) => Number(r.sap_invoice_doc_entry)).filter(Boolean);
        const { data: lookup } = await sb.functions.invoke("sap-nfse-lookup", {
          body: { company_db: companyDb, doc_entries: entries },
        });
        const map = (lookup?.map || {}) as Record<string, { nfse?: string | null }>;
        for (const row of list) {
          const nfse = map[String(row.sap_invoice_doc_entry)]?.nfse;
          if (nfse) {
            await sb.from("sales_order_invoices")
              .update({ nfse_number: String(nfse), status: "authorized", last_error: null })
              .eq("id", row.id);
          }
        }
      } catch (e) {
        console.warn(`[sales-nfse-transmit-watcher:${requestId}] lookup falhou`, (e as Error).message);
      }
    }

    console.info(`[sales-nfse-transmit-watcher:${requestId}] done`, JSON.stringify({
      pending: rows.length,
      companies: byCompany.size,
      duration_ms: Date.now() - startedAt,
    }));

    return json({
      ok: true,
      request_id: requestId,
      pending: rows.length,
      results,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error(`[sales-nfse-transmit-watcher:${requestId}] fatal`, (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
