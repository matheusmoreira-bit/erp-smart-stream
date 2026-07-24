// Edge function: sap-po-cache-sync
// Sincronização incremental de PurchaseOrders (Pedidos de Compra) para
// public.sap_purchase_order_cache. Usa helpers compartilhados em _shared/sap-cache.ts.

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

interface SapPurchaseOrder extends OdataDoc {
  DocNum?: number;
  Series?: number;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocDueDate?: string;
  DocTotal?: number;
  DocTotalFc?: number;
  DocCurrency?: string;
  DocumentStatus?: string;
  Cancelled?: string;
}

const SELECT = "DocEntry,DocNum,Series,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocTotalFc,DocCurrency,DocumentStatus,Cancelled,UpdateDate,UpdateTime";

async function syncCompany(sb: Sb, companyDb: string, opts: RunnerOpts): Promise<WatcherResult> {
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
    const { totalSynced, error } = await runIncrementalPager<SapPurchaseOrder, Record<string, unknown>>({
      sb,
      companyDb,
      cookie,
      baseUrl,
      entity: "PurchaseOrders",
      select: SELECT,
      stateTable: "sap_purchase_order_sync_state",
      cacheTable: "sap_purchase_order_cache",
      backfill: opts.backfill,
      fromDate: opts.fromDate,
      maxPages: opts.backfill ? 200 : 40,
      mapRow: (inv) => ({
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
        raw_json: inv as unknown as Record<string, unknown>,
        sap_update_date: toIsoTimestamp(inv.UpdateDate, inv.UpdateTime),
        synced_at: new Date().toISOString(),
      }),
    });
    return { companyDb, synced: totalSynced, error: error ?? undefined, mode: opts.backfill ? "backfill" : "incremental" };
  } finally {
    await sapLogout(baseUrl, cookie);
  }
}

Deno.serve((req) => runSapCacheWatcher(req, { watcherName: "sap-po-cache-sync", syncCompany }));
