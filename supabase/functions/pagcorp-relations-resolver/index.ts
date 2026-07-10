// Edge function: pagcorp-relations-resolver
// Resolve internamente PC ↔ NF ↔ Pagamento a partir dos caches
// sap_purchase_order_cache, sap_nf_entrada_cache e sap_vendor_payment_cache.
// Grava tudo em pagcorp_document_relations (upsert por pagcorp_log_id).
//
// Modos:
//   - cron  (POST vazio): pega os logs com sap_doc_entry set, cujo last_resolved_at
//           é NULL ou mais antigo que STALE_MINUTES.
//   - manual: { logId } resolve uma linha; { companyDb } resolve todos os logs
//             daquela base.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sapFetch } from "../_shared/sap-fetch.ts";
import { AuthError, authErrorResponse, requireUserOrSapSession } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
};

const STALE_MINUTES = 5;
const BATCH_SIZE = 200;

interface LogRow {
  id: string;
  company_db: string | null;
  sap_doc_entry: number | null;
  pagcorp_data: Record<string, unknown> | null;
}

interface CallerContext {
  id: string;
  email: string | null;
  companyDB?: string;
  userName?: string;
  source?: string;
}

async function assertManualAccess(req: Request, log: LogRow): Promise<void> {
  const caller = await requireUserOrSapSession(req) as CallerContext;
  if (caller.source === "sap_session" && caller.companyDB && log.company_db && caller.companyDB !== log.company_db) {
    throw new AuthError("Acesso negado para a empresa deste documento.", 403);
  }
}

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, u: string, p: string): Promise<string> {
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: companyDB }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  await r.json().catch(() => ({}));
  const sc = r.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!s) throw new Error("B1SESSION ausente");
  return `B1SESSION=${s}${rt ? `; ROUTEID=${rt}` : ""}`;
}

async function loadSapCreds(sb: ReturnType<typeof createClient>, companyDb: string) {
  const { data } = await sb.from("system_credentials").select("credential_key,credential_value")
    .eq("system_name", "sap").eq("company_db", companyDb);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) return null;
  return kv;
}

/** Busca UM Pedido de Compra pelo DocEntry e grava no cache. Usado como fallback on-demand. */
async function fetchAndCachePo(
  sb: ReturnType<typeof createClient>,
  companyDb: string,
  docEntry: number,
): Promise<boolean> {
  const creds = await loadSapCreds(sb, companyDb);
  if (!creds) return false;
  const baseUrl = buildBaseUrl(creds.service_layer_url);
  let cookie: string;
  try {
    cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
  } catch { return false; }
  try {
    const url = `${baseUrl}/PurchaseOrders(${docEntry})?$select=DocEntry,DocNum,Series,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocTotalFc,DocCurrency,DocumentStatus,Cancelled,UpdateDate,UpdateTime`;
    const r = await sapFetch(url, { headers: { Cookie: cookie } });
    if (!r.ok) return false;
    const inv = await r.json();
    await sb.from("sap_purchase_order_cache").upsert({
      company_db: companyDb,
      doc_entry: inv.DocEntry,
      doc_num: inv.DocNum ?? null,
      series: inv.Series ?? null,
      card_code: inv.CardCode ?? null,
      card_name: inv.CardName ?? null,
      doc_date: inv.DocDate ?? null,
      doc_due_date: inv.DocDueDate ?? null,
      doc_total: inv.DocTotal ?? null,
      doc_total_fc: inv.DocTotalFc ?? null,
      doc_currency: inv.DocCurrency ?? null,
      document_status: inv.DocumentStatus ?? null,
      cancelled: inv.Cancelled ?? null,
      raw_json: inv,
      synced_at: new Date().toISOString(),
    }, { onConflict: "company_db,doc_entry" });
    return true;
  } catch { return false; }
  finally {
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  }
}


async function resolveOne(
  sb: ReturnType<typeof createClient>,
  log: LogRow,
  opts: { allowLiveFetch?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!log.company_db || !log.sap_doc_entry) {
    await sb.from("pagcorp_document_relations").upsert({
      pagcorp_log_id: log.id,
      company_db: log.company_db,
      po_doc_entry: log.sap_doc_entry,
      po_found: false,
      nf_found: false,
      payment_found: false,
      last_resolved_at: new Date().toISOString(),
      resolve_error: "log sem company_db ou sap_doc_entry",
    }, { onConflict: "pagcorp_log_id" });
    return { ok: false, error: "log sem company_db ou sap_doc_entry" };
  }

  try {
    // 1) PC no cache — se não achar e o modo permitir, busca direto no SAP e cacheia.
    let { data: po } = await sb
      .from("sap_purchase_order_cache")
      .select("doc_entry, doc_num, document_status, doc_total, doc_total_fc, doc_currency")
      .eq("company_db", log.company_db)
      .eq("doc_entry", log.sap_doc_entry)
      .maybeSingle();

    if (!po && opts.allowLiveFetch) {
      const fetched = await fetchAndCachePo(sb, log.company_db, log.sap_doc_entry);
      if (fetched) {
        const refetch = await sb
          .from("sap_purchase_order_cache")
          .select("doc_entry, doc_num, document_status, doc_total, doc_total_fc, doc_currency")
          .eq("company_db", log.company_db)
          .eq("doc_entry", log.sap_doc_entry)
          .maybeSingle();
        po = refetch.data;
      }
    }


    // 2) NFs no cache (base_po_doc_entry)
    const { data: nfs } = await sb
      .from("sap_nf_entrada_cache")
      .select("doc_entry")
      .eq("company_db", log.company_db)
      .eq("base_po_doc_entry", log.sap_doc_entry);

    const nfEntries = (nfs || []).map((n: { doc_entry: number }) => n.doc_entry).filter((n) => Number.isFinite(n));

    // 3) Pagamentos cujo invoice_links contenha alguma NF
    let paymentEntries: number[] = [];
    if (nfEntries.length > 0) {
      // Filtro via `?` (jsonb contains key) não é trivial em array de objetos. Fazemos
      // OR de contains para cada NF. Postgrest aceita or() com contains@> jsonb.
      const orParts = nfEntries.map((e) => `invoice_links.cs.[{"docEntry":${e}}]`).join(",");
      const { data: pays, error: payErr } = await sb
        .from("sap_vendor_payment_cache")
        .select("doc_entry, invoice_links")
        .eq("company_db", log.company_db)
        .or(orParts);
      if (payErr) throw new Error(`pagamentos: ${payErr.message}`);
      const nfSet = new Set(nfEntries);
      paymentEntries = (pays || [])
        .filter((p: { invoice_links: Array<{ docEntry?: number; invoiceType?: string }> }) =>
          (p.invoice_links || []).some((pi) =>
            (pi.invoiceType == null || pi.invoiceType === "it_PurchaseInvoice") &&
            typeof pi.docEntry === "number" && nfSet.has(pi.docEntry),
          ),
        )
        .map((p: { doc_entry: number }) => p.doc_entry);
    }

    // 4) Comparação de valor com o PagCorp (quando possível)
    let amountMatches: boolean | null = null;
    const expected = Number(
      (log.pagcorp_data as { amount?: number; totalAmount?: number; total?: number } | null)?.amount ??
      (log.pagcorp_data as { totalAmount?: number } | null)?.totalAmount ??
      (log.pagcorp_data as { total?: number } | null)?.total ??
      NaN,
    );
    if (po && Number.isFinite(expected)) {
      const cur = (po as { doc_currency?: string | null }).doc_currency || "BRL";
      const t = Number(
        cur && cur !== "BRL"
          ? (po as { doc_total_fc?: number }).doc_total_fc ?? 0
          : (po as { doc_total?: number }).doc_total ?? 0,
      );
      amountMatches = Math.abs(t - expected) < 0.01;
    }

    await sb.from("pagcorp_document_relations").upsert({
      pagcorp_log_id: log.id,
      company_db: log.company_db,
      po_doc_entry: (po as { doc_entry?: number } | null)?.doc_entry ?? log.sap_doc_entry,
      po_doc_num: (po as { doc_num?: number } | null)?.doc_num ?? null,
      po_status: (po as { document_status?: string } | null)?.document_status ?? null,
      po_total: (po as { doc_total?: number } | null)?.doc_total ?? null,
      po_total_fc: (po as { doc_total_fc?: number } | null)?.doc_total_fc ?? null,
      po_currency: (po as { doc_currency?: string } | null)?.doc_currency ?? null,
      nf_doc_entries: nfEntries,
      payment_doc_entries: paymentEntries,
      po_found: !!po,
      nf_found: nfEntries.length > 0,
      payment_found: paymentEntries.length > 0,
      amount_matches: amountMatches,
      last_resolved_at: new Date().toISOString(),
      resolve_error: null,
    }, { onConflict: "pagcorp_log_id" });
    return { ok: true };
  } catch (e) {
    await sb.from("pagcorp_document_relations").upsert({
      pagcorp_log_id: log.id,
      company_db: log.company_db,
      po_doc_entry: log.sap_doc_entry,
      po_found: false,
      nf_found: false,
      payment_found: false,
      last_resolved_at: new Date().toISOString(),
      resolve_error: (e as Error).message,
    }, { onConflict: "pagcorp_log_id" });
    return { ok: false, error: (e as Error).message };
  }
}

async function loadDetails(sb: ReturnType<typeof createClient>, logId: string) {
  const { data: relData, error: relErr } = await sb
    .from("pagcorp_document_relations")
    .select("po_doc_entry, po_doc_num, po_status, po_total, po_total_fc, po_currency, nf_doc_entries, payment_doc_entries, po_found, amount_matches, last_resolved_at, resolve_error, company_db")
    .eq("pagcorp_log_id", logId)
    .maybeSingle();
  if (relErr) throw new Error(relErr.message);

  const relation = relData ?? null;
  let nfs: unknown[] = [];
  let pays: unknown[] = [];
  const companyDb = (relation as { company_db?: string | null } | null)?.company_db;
  const nfEntries = ((relation as { nf_doc_entries?: number[] | null } | null)?.nf_doc_entries || [])
    .filter((n) => Number.isFinite(Number(n)));
  const payEntries = ((relation as { payment_doc_entries?: number[] | null } | null)?.payment_doc_entries || [])
    .filter((n) => Number.isFinite(Number(n)));

  if (companyDb && nfEntries.length > 0) {
    const { data, error } = await sb
      .from("sap_nf_entrada_cache")
      .select("doc_entry, doc_num, doc_date, doc_total, doc_currency, document_status")
      .eq("company_db", companyDb)
      .in("doc_entry", nfEntries);
    if (error) throw new Error(`notas: ${error.message}`);
    nfs = data || [];
  }

  if (companyDb && payEntries.length > 0) {
    const { data, error } = await sb
      .from("sap_vendor_payment_cache")
      .select("doc_entry, doc_num, doc_date, doc_total, doc_total_fc, doc_currency, invoice_links")
      .eq("company_db", companyDb)
      .in("doc_entry", payEntries);
    if (error) throw new Error(`pagamentos: ${error.message}`);
    pays = data || [];
  }

  return { relation, nfs, pays };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { logId?: string; companyDb?: string; readOnly?: boolean; includeDetails?: boolean } = {};
  try { body = await req.json(); } catch { /* cron sem corpo */ }

  try {
    let logs: LogRow[] = [];

    if (body.logId) {
      const { data, error } = await sb
        .from("pagcorp_integration_log")
        .select("id, company_db, sap_doc_entry, pagcorp_data")
        .eq("id", body.logId)
        .limit(1);
      if (error) throw new Error(error.message);
      logs = (data || []) as LogRow[];
      if (logs[0]) await assertManualAccess(req, logs[0]);
      if (body.readOnly) {
        const details = await loadDetails(sb, body.logId);
        return new Response(JSON.stringify({ ok: true, processed: 0, ...details }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (body.companyDb) {
      await requireUserOrSapSession(req);
      const { data, error } = await sb
        .from("pagcorp_integration_log")
        .select("id, company_db, sap_doc_entry, pagcorp_data")
        .eq("company_db", body.companyDb)
        .not("sap_doc_entry", "is", null)
        .limit(BATCH_SIZE);
      if (error) throw new Error(error.message);
      logs = (data || []) as LogRow[];
    } else {
      // Modo cron: logs com sap_doc_entry setado e relação stale.
      const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
      // Left join simulado: pega logs cujo pagcorp_document_relations.last_resolved_at
      // não existe ou é anterior ao cutoff. Simplificamos com 2 queries.
      const { data: recent, error: recErr } = await sb
        .from("pagcorp_document_relations")
        .select("pagcorp_log_id")
        .gt("last_resolved_at", cutoff);
      if (recErr) throw new Error(recErr.message);
      const fresh = new Set((recent || []).map((r: { pagcorp_log_id: string }) => r.pagcorp_log_id));
      const { data, error } = await sb
        .from("pagcorp_integration_log")
        .select("id, company_db, sap_doc_entry, pagcorp_data")
        .not("sap_doc_entry", "is", null)
        .order("updated_at", { ascending: false })
        .limit(BATCH_SIZE * 3);
      if (error) throw new Error(error.message);
      logs = ((data || []) as LogRow[]).filter((l) => !fresh.has(l.id)).slice(0, BATCH_SIZE);
    }

    const allowLiveFetch = !!body.logId; // apenas quando o usuário aciona uma linha específica
    let ok = 0, err = 0;
    for (const l of logs) {
      const r = await resolveOne(sb, l, { allowLiveFetch });
      if (r.ok) ok++; else err++;
    }
    if (body.logId && body.includeDetails) {
      const details = await loadDetails(sb, body.logId);
      return new Response(JSON.stringify({ ok: true, processed: logs.length, resolved: ok, failed: err, ...details }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, processed: logs.length, resolved: ok, failed: err }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const authResp = authErrorResponse(e, corsHeaders);
    if (authResp) return authResp;
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
