// Edge function: sap-vendor-payment-cache-sync
// Sincronização incremental de VendorPayments (baixas a fornecedores) para
// public.sap_vendor_payment_cache. Usa helpers compartilhados em _shared/sap-cache.ts.

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
  DocCurrency?: string;
  DocRate?: number;
  CashSum?: number;
  TransferSum?: number;
  Cancelled?: string;
  PaymentInvoices?: Array<{ DocEntry?: number; InvoiceType?: string; SumApplied?: number; AppliedFC?: number }>;
}

// ATENÇÃO: a entidade `Payments` do Service Layer NÃO possui `DocTotal`/`DocTotalFc`/
// `DocumentStatus` — pedi-los devolvia 400 ("Property 'DocTotal' of 'Payment' is invalid")
// e o cache ficava permanentemente vazio (baixas nunca apareciam no ERP Flow).
// O total é derivado das linhas aplicadas (PaymentInvoices) ou de CashSum/TransferSum.
// `UpdateDate`/`UpdateTime` também não existem em Payment: a paginação é feita por DocEntry.
const SELECT = "DocEntry,DocNum,Series,CardCode,CardName,DocDate,DocCurrency,DocRate,CashSum,TransferSum,Cancelled,PaymentInvoices";


function sumApplied(p: SapVendorPayment, key: "SumApplied" | "AppliedFC"): number | null {
  const lines = p.PaymentInvoices || [];
  let total = 0;
  let has = false;
  for (const l of lines) {
    const v = Number(l[key] ?? 0);
    if (Number.isFinite(v) && v !== 0) { total += v; has = true; }
  }
  return has ? Number(total.toFixed(4)) : null;
}


async function syncCompany(sb: Sb, companyDb: string, _opts: RunnerOpts): Promise<WatcherResult> {
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
    // O conjunto de propriedades expostas na entidade Payment varia por versão do
    // Service Layer. Em vez de falhar (400) e deixar o cache vazio, removemos a
    // propriedade recusada e tentamos novamente.
    let select = SELECT;
    let result: { totalSynced: number; error: string | null } = { totalSynced: 0, error: null };
    for (let attempt = 0; attempt < 6; attempt++) {
      result = await runIncrementalPager<SapVendorPayment, Record<string, unknown>>({
        sb,
        companyDb,
        cookie,
        baseUrl,
        entity: "VendorPayments",
        select,
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
          doc_total: sumApplied(p, "SumApplied") ?? ((Number(p.CashSum ?? 0) + Number(p.TransferSum ?? 0)) || null),
          doc_total_fc: sumApplied(p, "AppliedFC"),
          doc_currency: p.DocCurrency ?? null,
          document_status: p.Cancelled === "tYES" ? "bost_Cancelled" : "bost_Close",
          cancelled: p.Cancelled ?? null,
          invoice_links: (p.PaymentInvoices || []).map((pi) => ({
            docEntry: pi.DocEntry ?? null,
            invoiceType: pi.InvoiceType ?? null,
            sumApplied: pi.SumApplied ?? null,
            appliedFC: pi.AppliedFC ?? null,
          })),
          raw_json: p as unknown as Record<string, unknown>,
          sap_update_date: toIsoTimestamp(p.UpdateDate, p.DocDate ? p.UpdateTime : null),
          synced_at: new Date().toISOString(),
        }),
      });

      const bad = result.error?.match(/Property '([A-Za-z0-9_]+)' of 'Payment'/)?.[1];
      if (!bad) break;
      const next = select.split(",").filter((f) => f !== bad).join(",");
      if (next === select) break;
      console.warn(`[vendor-payment-sync] ${companyDb}: removendo propriedade não suportada '${bad}'`);
      select = next;
    }
    return { companyDb, synced: result.totalSynced, error: result.error ?? undefined };
  } finally {
    await sapLogout(baseUrl, cookie);
  }
}


Deno.serve((req) => runSapCacheWatcher(req, {
  watcherName: "sap-vendor-payment-cache-sync",
  supportBackfill: false,
  syncCompany,
}));
