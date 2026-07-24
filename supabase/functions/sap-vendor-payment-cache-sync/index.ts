// Edge function: sap-vendor-payment-cache-sync
// Sincronização incremental de VendorPayments (baixas a fornecedores) para
// public.sap_vendor_payment_cache. Usa helpers compartilhados em _shared/sap-cache.ts.

import { isTestCompanyDb } from "../_shared/watcher-lock.ts";
import {
  buildSapBaseUrl,
  loadSapCreds,
  runIncrementalPager,
  runSapCacheWatcher,
  sapCookieLogin,
  sapLogout,
  toIsoTimestamp,
  type OdataDoc,
  type RunnerOpts,
  type Sb,
  type WatcherResult,
} from "../_shared/sap-cache.ts";

interface SapVendorPayment extends OdataDoc {
  DocNum?: number;
  Series?: number;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocTotal?: number;
  DocTotalFc?: number;
  DocCurrency?: string;
  DocumentStatus?: string;
  Cancelled?: string;
  PaymentInvoices?: Array<{ DocEntry?: number; InvoiceType?: string; SumApplied?: number; AppliedFC?: number }>;
}

const SELECT = "DocEntry,DocNum,Series,CardCode,CardName,DocDate,DocTotal,DocTotalFc,DocCurrency,DocumentStatus,Cancelled,UpdateDate,UpdateTime,PaymentInvoices";

async function syncCompany(sb: Sb, companyDb: string, _opts: RunnerOpts): Promise<WatcherResult> {
  if (isTestCompanyDb(companyDb)) return { companyDb, synced: 0, skipped: "test_base" };
  const creds = await loadSapCreds(sb, companyDb, { requireApiuser: true });
  if (!creds) return { companyDb, synced: 0, skipped: "no_credentials_or_not_apiuser" };

  const baseUrl = buildSapBaseUrl(creds.service_layer_url);
  let cookie: string;
  try {
    cookie = await sapCookieLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
  } catch (e) {
    return { companyDb, synced: 0, error: (e as Error).message };
  }

  try {
    const { totalSynced, error } = await runIncrementalPager<SapVendorPayment, Record<string, unknown>>({
      sb,
      companyDb,
      cookie,
      baseUrl,
      entity: "VendorPayments",
      select: SELECT,
      stateTable: "sap_vendor_payment_sync_state",
      cacheTable: "sap_vendor_payment_cache",
      maxPages: 40,
      mapRow: (p) => ({
        company_db: companyDb,
        doc_entry: p.DocEntry,
        doc_num: p.DocNum ?? null,
        series: p.Series ?? null,
        card_code: p.CardCode ?? null,
        card_name: p.CardName ?? null,
        doc_date: p.DocDate ?? null,
        doc_total: p.DocTotal ?? null,
        doc_total_fc: p.DocTotalFc ?? null,
        doc_currency: p.DocCurrency ?? null,
        document_status: p.DocumentStatus ?? null,
        cancelled: p.Cancelled ?? null,
        invoice_links: (p.PaymentInvoices || []).map((pi) => ({
          docEntry: pi.DocEntry ?? null,
          invoiceType: pi.InvoiceType ?? null,
          sumApplied: pi.SumApplied ?? null,
          appliedFC: pi.AppliedFC ?? null,
        })),
        raw_json: p as unknown as Record<string, unknown>,
        sap_update_date: toIsoTimestamp(p.UpdateDate, p.UpdateTime),
        synced_at: new Date().toISOString(),
      }),
    });
    return { companyDb, synced: totalSynced, error: error ?? undefined };
  } finally {
    await sapLogout(baseUrl, cookie);
  }
}

Deno.serve((req) => runSapCacheWatcher(req, {
  watcherName: "sap-vendor-payment-cache-sync",
  supportBackfill: false,
  syncCompany,
}));
