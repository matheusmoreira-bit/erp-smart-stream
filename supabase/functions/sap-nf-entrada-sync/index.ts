// Edge function: sap-nf-entrada-sync
// Sincronização incremental de PurchaseInvoices (NF de Entrada) para
// public.sap_nf_entrada_cache. Usa helpers compartilhados em _shared/sap-cache.ts.

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

interface SapPurchaseInvoice extends OdataDoc {
  DocNum?: number;
  Series?: number;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocDueDate?: string;
  TaxDate?: string;
  DocTotal?: number;
  PaidToDate?: number;
  DocCurrency?: string;
  DocumentStatus?: string;
  Cancelled?: string;
  DocumentLines?: Array<{ BaseType?: number; BaseEntry?: number; BaseLine?: number }>;
}

function extractBasePo(inv: SapPurchaseInvoice): number | null {
  for (const l of inv.DocumentLines || []) {
    if (l.BaseType === 22 && typeof l.BaseEntry === "number") return l.BaseEntry;
  }
  return null;
}

const SELECT = "DocEntry,DocNum,Series,CardCode,CardName,DocDate,DocDueDate,TaxDate,DocTotal,PaidToDate,DocCurrency,DocumentStatus,Cancelled,UpdateDate,UpdateTime,DocumentLines";

async function syncCompany(sb: Sb, companyDb: string, _opts: RunnerOpts): Promise<WatcherResult> {
  // NF de Entrada mantém comportamento original: aceita qualquer usuário SAP configurado.
  const creds = await loadSapCreds(sb, companyDb);
  if (!creds) return { companyDb, synced: 0, skipped: "no_credentials" };

  const baseUrl = buildSapBaseUrl(creds.service_layer_url);
  let cookie: string;
  try {
    cookie = await sapCookieLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
  } catch (e) {
    return { companyDb, synced: 0, error: (e as Error).message };
  }

  try {
    const { totalSynced, error } = await runIncrementalPager<SapPurchaseInvoice, Record<string, unknown>>({
      sb,
      companyDb,
      cookie,
      baseUrl,
      entity: "PurchaseInvoices",
      select: SELECT,
      stateTable: "sap_nf_entrada_sync_state",
      cacheTable: "sap_nf_entrada_cache",
      maxPages: 5,
      mapRow: (inv) => ({
        company_db: companyDb,
        doc_entry: inv.DocEntry,
        doc_num: inv.DocNum ?? null,
        series: inv.Series ?? null,
        card_code: inv.CardCode ?? null,
        card_name: inv.CardName ?? null,
        doc_date: inv.DocDate ?? null,
        doc_due_date: inv.DocDueDate ?? null,
        tax_date: inv.TaxDate ?? null,
        doc_total: inv.DocTotal ?? null,
        paid_to_date: inv.PaidToDate ?? null,
        doc_currency: inv.DocCurrency ?? null,
        document_status: inv.DocumentStatus ?? null,
        cancelled: inv.Cancelled ?? null,
        base_po_doc_entry: extractBasePo(inv),
        // raw_json intentionally omitted: campo não é lido em lugar nenhum e inflava a tabela.
        sap_update_date: toIsoTimestamp(inv.UpdateDate, inv.UpdateTime),
        synced_at: new Date().toISOString(),
      }),
    });
    return { companyDb, synced: totalSynced, error: error ?? undefined };
  } finally {
    await sapLogout(baseUrl, cookie);
  }
}

Deno.serve((req) => runSapCacheWatcher(req, {
  watcherName: "sap-nf-entrada-sync",
  supportBackfill: false,
  syncCompany,
}));
