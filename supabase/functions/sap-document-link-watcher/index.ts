// Edge function: sap-document-link-watcher
//
// Watcher assertivo de vínculos SAP B1:
// - PurchaseInvoices -> PurchaseOrders por DocumentLines.BaseType/BaseEntry
// - PurchaseDownPaymentInvoices -> PurchaseInvoices por DownPaymentsToDraw
// - Invoices -> Orders por DocumentLines.BaseType/BaseEntry
// - IncomingPayments -> Invoices por PaymentInvoices
// - documento fiscal/TaxOne -> Invoice SAP por sap-nfse-lookup
//
// Body opcional:
// { company_db?: string, days_back?: number, limit?: number, include_test?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { linkNfToAp } from "../_shared/link-nf-ap.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WATCHER = "sap-document-link-watcher";
const TIME_BUDGET_MS = 105_000;

type Sb = ReturnType<typeof createClient>;

interface SapCreds {
  company_db?: string;
  service_layer_url?: string;
  username?: string;
  password?: string;
}

interface SapConnection {
  companyDb: string;
  baseUrl: string;
  cookies: string;
}

interface SapDoc {
  DocEntry?: number;
  DocNum?: number;
  DocDate?: string;
  DocTotal?: number;
  PaidToDate?: number;
  DocCurrency?: string;
  CardCode?: string;
  CardName?: string;
  Cancelled?: string;
  DocumentLines?: Array<Record<string, unknown>>;
  PaymentInvoices?: Array<Record<string, unknown>>;
  DownPaymentsToDraw?: Array<Record<string, unknown>>;
}

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

function escapeOData(value: string) {
  return value.replace(/'/g, "''");
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadCreds(sb: Sb, companyDb: string): Promise<SapCreds> {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP ${companyDb}: ${error.message}`);
  const out: SapCreds = {};
  for (const row of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    (out as Record<string, string>)[row.credential_key] = row.credential_value ?? "";
  }
  if (!out.service_layer_url || !out.username || !out.password) {
    throw new Error(`Credenciais SAP incompletas para ${companyDb}`);
  }
  return out;
}

async function listCompanies(sb: Sb, requested: string | null, includeTest: boolean): Promise<string[]> {
  if (requested) return [requested];
  const { data, error } = await sb
    .from("system_credentials")
    .select("company_db")
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url");
  if (error) throw new Error(`Empresas SAP: ${error.message}`);
  const companies = Array.from(new Set((data || []).map((r: { company_db?: string | null }) => r.company_db).filter(Boolean))) as string[];
  return companies.filter((db) => includeTest || !isTestCompanyDb(db));
}

async function sapLogin(baseUrl: string, creds: SapCreds, companyDb: string): Promise<string> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      CompanyDB: creds.company_db || companyDb,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`Login SAP ${companyDb} falhou [${r.status}]: ${String(msg).slice(0, 240)}`);
  }
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = body?.SessionId || setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const rid = setCookie.match(/(?:B1)?ROUTEID=([^;]+)/)?.[1] || "";
  if (!sid) throw new Error(`SAP ${companyDb} não retornou B1SESSION`);
  return `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}`;
}

async function sapList<T = SapDoc>(conn: SapConnection, resource: string, query: string, maxRows = 1000): Promise<T[]> {
  const out: T[] = [];
  let skip = 0;
  while (skip < maxRows) {
    const sep = query.includes("?") ? "&" : "?";
    const pageSize = Math.min(100, maxRows - skip);
    const url = `${conn.baseUrl}/${resource}${query}${sep}$top=${pageSize}&$skip=${skip}`;
    const r = await fetch(url, { headers: { Cookie: conn.cookies } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body?.error?.message?.value || JSON.stringify(body);
      throw new Error(`${resource} [${r.status}]: ${String(msg).slice(0, 240)}`);
    }
    const rows = Array.isArray(body?.value) ? body.value : [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    skip += pageSize;
  }
  return out;
}

async function upsertRelation(sb: Sb, row: {
  company_db: string;
  source_type: string;
  source_doc_entry: number;
  source_doc_num?: string | number | null;
  target_type: string;
  target_doc_entry: number;
  target_doc_num?: string | number | null;
  relation_type: string;
  amount?: number | null;
  currency?: string | null;
  relation_date?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const payload = {
    ...row,
    source_doc_num: row.source_doc_num != null ? String(row.source_doc_num) : null,
    target_doc_num: row.target_doc_num != null ? String(row.target_doc_num) : null,
    confidence: "exact",
    detected_by: WATCHER,
    last_seen_at: new Date().toISOString(),
    metadata: row.metadata || {},
  };
  const { error } = await sb
    .from("sap_document_relations")
    .upsert(payload, {
      onConflict: "company_db,source_type,source_doc_entry,target_type,target_doc_entry,relation_type",
    });
  if (error) throw new Error(`sap_document_relations: ${error.message}`);
}

function baseEntries(doc: SapDoc, baseType: number): number[] {
  const found = new Set<number>();
  for (const line of doc.DocumentLines || []) {
    if (num(line.BaseType) !== baseType) continue;
    const entry = num(line.BaseEntry);
    if (entry != null) found.add(entry);
  }
  return Array.from(found);
}

async function updateNfEntradaLinks(sb: Sb, companyDb: string, poEntry: number, inv: SapDoc) {
  const invEntry = num(inv.DocEntry);
  if (invEntry == null) return;
  const { data } = await sb
    .from("nf_entrada_imports")
    .select("id, status")
    .eq("sap_company_db", companyDb)
    .eq("sap_matched_po_doc_entry", String(poEntry))
    .neq("status", "cancelled")
    .limit(20);

  for (const row of (data || []) as Array<{ id: string; status?: string | null }>) {
    await sb.from("nf_entrada_imports").update({
      erp_invoice_posted: true,
      erp_invoice_doc_entry: String(invEntry),
      erp_invoice_doc_num: inv.DocNum != null ? String(inv.DocNum) : null,
      erp_invoice_checked_at: new Date().toISOString(),
      status: "completed",
      last_error: null,
    }).eq("id", row.id);

    await linkNfToAp(sb, {
      nfImportId: row.id,
      source: "sap",
      companyDb,
      apDocEntry: invEntry,
      apDocNum: inv.DocNum ?? null,
      apTotal: num(inv.DocTotal),
      apPaid: num(inv.PaidToDate),
      apCurrency: inv.DocCurrency ? String(inv.DocCurrency) : null,
      linkedBy: WATCHER,
      notes: `Vínculo exato por PurchaseInvoice.DocumentLines.BaseEntry=${poEntry}`,
    });
  }
}

async function syncSalesInvoiceRow(sb: Sb, companyDb: string, orderEntry: number, inv: SapDoc) {
  const invoiceEntry = num(inv.DocEntry);
  if (invoiceEntry == null) return;

  const { data: expense } = await sb
    .from("expenses")
    .select("id, sap_doc_num")
    .eq("company_db", companyDb)
    .eq("doc_type", "sales")
    .eq("sap_doc_entry", orderEntry)
    .maybeSingle();

  const patch = {
    company_db: companyDb,
    expense_id: (expense as { id?: string } | null)?.id ?? null,
    sap_order_doc_entry: orderEntry,
    sap_order_doc_num: (expense as { sap_doc_num?: number | null } | null)?.sap_doc_num ?? null,
    sap_invoice_doc_entry: invoiceEntry,
    sap_invoice_doc_num: inv.DocNum ?? null,
    total_amount: num(inv.DocTotal) ?? 0,
    currency: inv.DocCurrency || "BRL",
    status: "issued",
    last_error: null,
  };

  const { data: byInvoice } = await sb
    .from("sales_order_invoices")
    .select("id")
    .eq("company_db", companyDb)
    .eq("sap_invoice_doc_entry", invoiceEntry)
    .maybeSingle();
  if (byInvoice?.id) {
    await sb.from("sales_order_invoices").update(patch).eq("id", byInvoice.id);
    return;
  }

  const { data: byOrder } = await sb
    .from("sales_order_invoices")
    .select("id")
    .eq("company_db", companyDb)
    .eq("sap_order_doc_entry", orderEntry)
    .maybeSingle();
  if (byOrder?.id) {
    await sb.from("sales_order_invoices").update(patch).eq("id", byOrder.id);
    return;
  }

  await sb.from("sales_order_invoices").insert(patch);
}

async function syncNfseInfo(sb: Sb, companyDb: string, invoiceEntries: number[]) {
  if (invoiceEntries.length === 0) return 0;
  const { data, error } = await sb.functions.invoke("sap-nfse-lookup", {
    body: { company_db: companyDb, doc_entries: invoiceEntries },
  });
  if (error || data?.unavailable) return 0;
  const map = (data?.map || {}) as Record<string, {
    nfse?: string | null;
    rps?: string | null;
    key?: string | null;
    authorized_at?: string | null;
    status?: string | null;
  }>;
  let updated = 0;
  for (const entry of invoiceEntries) {
    const info = map[String(entry)];
    if (!info?.nfse && !info?.key) continue;
    const patch: Record<string, unknown> = {
      fiscal_authorized_at: info.authorized_at || null,
      authorized_at: info.authorized_at || null,
      status: info.nfse ? "authorized" : "issued",
      last_error: null,
    };
    if (info.nfse) patch.nfse_number = String(info.nfse);
    if (info.rps) patch.rps_number = String(info.rps);
    if (info.key) patch.fiscal_doc_key = String(info.key);
    await sb.from("sales_order_invoices").update(patch).eq("company_db", companyDb).eq("sap_invoice_doc_entry", entry);

    if (info.nfse) {
      await upsertRelation(sb, {
        company_db: companyDb,
        source_type: "taxone_nfse",
        source_doc_entry: entry,
        source_doc_num: info.nfse,
        target_type: "ar_invoice",
        target_doc_entry: entry,
        relation_type: "fiscal_doc_to_ar_invoice",
        relation_date: info.authorized_at ? String(info.authorized_at).slice(0, 10) : null,
        metadata: info,
      });
    }
    updated++;
  }
  return updated;
}

async function runCompany(sb: Sb, companyDb: string, daysBack: number, limit: number, startedAt: number) {
  const counts = {
    purchase_invoice_po: 0,
    downpayment_invoice: 0,
    sales_invoice_order: 0,
    payment_invoice: 0,
    nfse_invoice: 0,
  };
  const creds = await loadCreds(sb, companyDb);
  const baseUrl = buildBaseUrl(creds.service_layer_url!);
  const cookies = await sapLogin(baseUrl, creds, companyDb);
  const conn: SapConnection = { companyDb, baseUrl, cookies };
  const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString().slice(0, 10);

  try {
    const piQuery = `?$filter=${encodeURIComponent(`DocDate ge '${since}' and Cancelled eq 'tNO'`)}&$orderby=DocEntry desc`;
    const purchaseInvoices = await sapList<SapDoc>(conn, "PurchaseInvoices", piQuery, limit);
    for (const inv of purchaseInvoices) {
      const invEntry = num(inv.DocEntry);
      if (invEntry == null) continue;
      for (const poEntry of baseEntries(inv, 22)) {
        await upsertRelation(sb, {
          company_db: companyDb,
          source_type: "purchase_order",
          source_doc_entry: poEntry,
          target_type: "ap_invoice",
          target_doc_entry: invEntry,
          target_doc_num: inv.DocNum ?? null,
          relation_type: "purchase_order_to_ap_invoice",
          amount: num(inv.DocTotal),
          currency: inv.DocCurrency || null,
          relation_date: inv.DocDate || null,
          metadata: { card_code: inv.CardCode, card_name: inv.CardName },
        });
        await updateNfEntradaLinks(sb, companyDb, poEntry, inv);
        counts.purchase_invoice_po++;
      }

      for (const dp of inv.DownPaymentsToDraw || []) {
        const dpEntry = num(dp.DocEntry ?? dp.DocInternalKey ?? dp.BaseAbs);
        if (dpEntry == null) continue;
        const amount = num(dp.AmountToDraw ?? dp.GrossAmountToDraw ?? dp.NetAmountToDraw);
        await upsertRelation(sb, {
          company_db: companyDb,
          source_type: "ap_downpayment_invoice",
          source_doc_entry: dpEntry,
          target_type: "ap_invoice",
          target_doc_entry: invEntry,
          target_doc_num: inv.DocNum ?? null,
          relation_type: "downpayment_to_ap_invoice",
          amount,
          currency: inv.DocCurrency || null,
          relation_date: inv.DocDate || null,
          metadata: { raw: dp },
        });
        await sb.from("advance_payments").update({
          applied_invoice_doc_entry: invEntry,
          applied_invoice_doc_num: inv.DocNum ?? null,
          applied_amount: amount,
          applied_at: new Date().toISOString(),
        }).eq("company_db", companyDb).eq("sap_doc_entry", dpEntry);
        counts.downpayment_invoice++;
      }
    }

    if (Date.now() - startedAt > TIME_BUDGET_MS) return counts;

    const arQuery = `?$filter=${encodeURIComponent(`DocDate ge '${since}' and Cancelled eq 'tNO'`)}&$orderby=DocEntry desc`;
    const arInvoices = await sapList<SapDoc>(conn, "Invoices", arQuery, limit);
    const arInvoiceEntries: number[] = [];
    for (const inv of arInvoices) {
      const invEntry = num(inv.DocEntry);
      if (invEntry == null) continue;
      arInvoiceEntries.push(invEntry);
      for (const orderEntry of baseEntries(inv, 17)) {
        await upsertRelation(sb, {
          company_db: companyDb,
          source_type: "sales_order",
          source_doc_entry: orderEntry,
          target_type: "ar_invoice",
          target_doc_entry: invEntry,
          target_doc_num: inv.DocNum ?? null,
          relation_type: "sales_order_to_ar_invoice",
          amount: num(inv.DocTotal),
          currency: inv.DocCurrency || null,
          relation_date: inv.DocDate || null,
          metadata: { card_code: inv.CardCode, card_name: inv.CardName },
        });
        await syncSalesInvoiceRow(sb, companyDb, orderEntry, inv);
        counts.sales_invoice_order++;
      }
    }
    counts.nfse_invoice += await syncNfseInfo(sb, companyDb, arInvoiceEntries.slice(0, limit));

    if (Date.now() - startedAt > TIME_BUDGET_MS) return counts;

    const cardCodes = Array.from(new Set(arInvoices.map((i) => i.CardCode).filter(Boolean))) as string[];
    const cardFilter = cardCodes.length
      ? ` and (${cardCodes.map((c) => `CardCode eq '${escapeOData(c)}'`).join(" or ")})`
      : "";
    const payQuery = `?$filter=${encodeURIComponent(`DocDate ge '${since}' and Cancelled eq 'tNO'${cardFilter}`)}&$orderby=DocEntry desc`;
    const payments = await sapList<SapDoc>(conn, "IncomingPayments", payQuery, limit);
    for (const pay of payments) {
      const payEntry = num(pay.DocEntry);
      if (payEntry == null) continue;
      for (const line of pay.PaymentInvoices || []) {
        if (String(line.InvoiceType || "") !== "it_Invoice") continue;
        const invoiceEntry = num(line.DocEntry);
        if (invoiceEntry == null) continue;
        const amount = num(line.SumApplied ?? line.AppliedFC ?? line.AppliedSys);
        await upsertRelation(sb, {
          company_db: companyDb,
          source_type: "ar_invoice",
          source_doc_entry: invoiceEntry,
          target_type: "incoming_payment",
          target_doc_entry: payEntry,
          target_doc_num: pay.DocNum ?? null,
          relation_type: "ar_invoice_to_incoming_payment",
          amount,
          currency: pay.DocCurrency || null,
          relation_date: pay.DocDate || null,
          metadata: { card_code: pay.CardCode, card_name: pay.CardName, raw: line },
        });
        await sb.from("sales_order_invoices").update({
          sap_incoming_payment_doc_entry: payEntry,
          sap_incoming_payment_doc_num: pay.DocNum ?? null,
          paid_amount: amount,
          paid_at: pay.DocDate || null,
          status: "settled",
          last_error: null,
        }).eq("company_db", companyDb).eq("sap_invoice_doc_entry", invoiceEntry);
        await sb.from("baixas_recebimento").update({
          sap_incoming_payment_doc_num: pay.DocNum ?? null,
        }).eq("company_db", companyDb).eq("sap_incoming_payment_doc_entry", payEntry);
        counts.payment_invoice++;
      }
    }
  } finally {
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookies } }).catch(() => {});
  }

  return counts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const requestId = crypto.randomUUID();
  const body = await req.json().catch(() => ({}));
  const companyDb = String(body?.company_db || "").trim() || null;
  const includeTest = body?.include_test === true;
  const daysBack = Math.min(Math.max(Number(body?.days_back || 21), 1), 120);
  const limit = Math.min(Math.max(Number(body?.limit || 250), 10), 1000);

  const gotLock = await tryWatcherLock(sb, WATCHER, 12);
  if (!gotLock) return json({ ok: true, request_id: requestId, skipped: "another_run_in_progress" });

  const results: Array<Record<string, unknown>> = [];
  try {
    const companies = await listCompanies(sb, companyDb, includeTest);
    for (const db of companies) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        results.push({ company_db: db, skipped: "time_budget" });
        break;
      }
      try {
        const counts = await runCompany(sb, db, daysBack, limit, startedAt);
        results.push({ company_db: db, ok: true, counts });
      } catch (e) {
        results.push({ company_db: db, ok: false, error: (e as Error).message });
      }
    }
    await releaseWatcherLock(sb, WATCHER, "ok", `companies=${results.length}`);
    return json({ ok: true, request_id: requestId, days_back: daysBack, results, duration_ms: Date.now() - startedAt });
  } catch (e) {
    await releaseWatcherLock(sb, WATCHER, "error", (e as Error).message);
    return json({ ok: false, request_id: requestId, error: (e as Error).message }, 500);
  }
});
