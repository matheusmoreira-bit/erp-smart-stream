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
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const STALE_MINUTES = 5;
const BATCH_SIZE = 200;

interface LogRow {
  id: string;
  company_db: string | null;
  sap_doc_entry: number | null;
  pagcorp_data: Record<string, unknown> | null;
}

async function resolveOne(sb: ReturnType<typeof createClient>, log: LogRow): Promise<{ ok: boolean; error?: string }> {
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
    // 1) PC no cache
    const { data: po } = await sb
      .from("sap_purchase_order_cache")
      .select("doc_entry, doc_num, document_status, doc_total, doc_total_fc, doc_currency")
      .eq("company_db", log.company_db)
      .eq("doc_entry", log.sap_doc_entry)
      .maybeSingle();

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { logId?: string; companyDb?: string } = {};
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
    } else if (body.companyDb) {
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

    let ok = 0, err = 0;
    for (const l of logs) {
      const r = await resolveOne(sb, l);
      if (r.ok) ok++; else err++;
    }
    return new Response(JSON.stringify({ ok: true, processed: logs.length, resolved: ok, failed: err }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
