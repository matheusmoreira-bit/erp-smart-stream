// Edge function: pagcorp-settlement-watcher
//
// Fluxo: PagCorp → PO no SAP → NF de Entrada fecha o PO → **este watcher**
// emite um Pagamento de Fornecedor (VendorPayments) que baixa a
// PurchaseInvoice em Contas a Pagar, tendo como conta de saída a GL do
// cartão PagCorp cadastrada em `pagcorp_settlement_accounts`.
//
// (Antes de jul/2026 esta baixa era feita via JournalEntry avulso; foi
// substituída para que o AP realmente feche no SAP em vez de ficar em aberto.)
//
// Cron: a cada 5 minutos. Lê `pagcorp_integration_log` com status='success'
// e settlement_status ∈ (pending|awaiting_invoice|awaiting_settlement|error retryable).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { logIntegrationCall } from "../_shared/integration-log.ts";
import { linkNfToAp } from "../_shared/link-nf-ap.ts";

interface PagcorpLogRow {
  id: string;
  company_db: string;
  sap_doc_entry: number;
  sap_doc_num: number | null;
  pagcorp_data: Record<string, unknown> | null;
  settlement_status: string;
  settlement_attempts: number;
}

interface SettlementAccount {
  settlement_account_code: string;
  cost_center: string | null;
  project: string | null;
}

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, u: string, p: string): Promise<string> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: companyDB }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${(await r.text()).slice(0, 200)}`);
  await r.json().catch(() => ({}));
  const sc = r.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!s) throw new Error("B1SESSION ausente");
  return `B1SESSION=${s}${rt ? `; ROUTEID=${rt}` : ""}`;
}

async function loadCreds(sb: ReturnType<typeof createClient>, companyDb: string) {
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
  if (!kv.service_layer_url || !kv.username || !kv.password) {
    throw new Error(`Credenciais SAP ausentes para ${companyDb}`);
  }
  return kv;
}

function extractCardKey(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const tx = (payload.transaction || payload) as Record<string, unknown>;
  const last = tx?.cardLastDigits ? String(tx.cardLastDigits).trim() : "";
  if (last) return last;
  const cardId = tx?.cardId ? String(tx.cardId).trim() : "";
  if (cardId) return cardId;
  const name = tx?.cardName ? String(tx.cardName).trim() : "";
  return name || null;
}

async function resolveSettlementAccount(
  sb: ReturnType<typeof createClient>,
  companyDb: string,
  cardKey: string | null,
): Promise<SettlementAccount | null> {
  if (cardKey) {
    const { data } = await sb
      .from("pagcorp_settlement_accounts")
      .select("settlement_account_code, cost_center, project")
      .eq("company_db", companyDb)
      .eq("card_identifier", cardKey)
      .eq("enabled", true)
      .maybeSingle();
    if (data) return data as SettlementAccount;
  }
  const { data: fb } = await sb
    .from("pagcorp_settlement_accounts")
    .select("settlement_account_code, cost_center, project")
    .eq("company_db", companyDb)
    .is("card_identifier", null)
    .eq("enabled", true)
    .maybeSingle();
  return (fb as SettlementAccount) || null;
}

async function findInvoicesForPO(baseUrl: string, cookie: string, poEntry: number): Promise<
  Array<{ DocEntry: number; DocNum: number; CardCode: string; DocTotal: number; PaidToDate: number; DocumentStatus: string; DocCurrency: string; DocDate: string; BPLId?: number }>
> {
  // 1 PO → N NF de entrada: retornamos TODAS as PurchaseInvoices que apontam para o PO.
  const q = `${baseUrl}/PurchaseInvoices?$filter=DocumentLines/any(l:l/BaseType eq 22 and l/BaseEntry eq ${poEntry})` +
    `&$select=DocEntry,DocNum,CardCode,DocTotal,PaidToDate,DocumentStatus,DocCurrency,DocDate,BPL_IDAssignedToInvoice&$orderby=DocEntry asc&$top=50`;
  const r = await fetch(q, { headers: { Cookie: cookie } });
  if (!r.ok) throw new Error(`Consulta PurchaseInvoices falhou ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const arr = Array.isArray(j?.value) ? j.value : [];
  return arr.map((inv: any) => ({
    DocEntry: Number(inv.DocEntry),
    DocNum: Number(inv.DocNum),
    CardCode: String(inv.CardCode),
    DocTotal: Number(inv.DocTotal),
    PaidToDate: Number(inv.PaidToDate ?? 0),
    DocumentStatus: String(inv.DocumentStatus ?? ""),
    DocCurrency: String(inv.DocCurrency ?? ""),
    DocDate: String(inv.DocDate),
    BPLId: inv.BPL_IDAssignedToInvoice != null ? Number(inv.BPL_IDAssignedToInvoice) : undefined,
  }));
}

/**
 * Emite um Pagamento de Fornecedor (Outgoing Payment) que baixa a
 * PurchaseInvoice indicada. A contrapartida contábil é a `TransferAccount`
 * (GL configurada para o cartão PagCorp).
 *
 * Retorna { docEntry, docNum } do pagamento criado.
 */
async function createVendorPayment(
  baseUrl: string,
  cookie: string,
  args: {
    invoiceEntry: number;
    invoiceDocNum: number;
    invoiceDate: string;
    cardCode: string;
    docCurrency: string;
    accountCode: string;
    amount: number;
    memo: string;
    costCenter: string | null;
    project: string | null;
    bplId?: number;
  },
): Promise<{ docEntry: number; docNum: number }> {
  const body: Record<string, unknown> = {
    DocType: "rSupplier",
    CardCode: args.cardCode,
    DocDate: args.invoiceDate,
    TaxDate: args.invoiceDate,
    DueDate: args.invoiceDate,
    Remarks: args.memo.slice(0, 254),
    JournalRemarks: args.memo.slice(0, 50),
    TransferAccount: args.accountCode,
    TransferSum: args.amount,
    TransferDate: args.invoiceDate,
    PaymentInvoices: [
      {
        DocEntry: args.invoiceEntry,
        InvoiceType: "it_PurchaseInvoice",
        SumApplied: args.amount,
      },
    ],
  };
  if (args.docCurrency) body.DocCurrency = args.docCurrency;
  if (args.bplId != null) body.BPLID = args.bplId;
  if (args.costCenter) body.CostingCode = args.costCenter;
  if (args.project) body.ProjectCode = args.project;

  const r = await fetch(`${baseUrl}/VendorPayments`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`VendorPayments falhou ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return {
    docEntry: Number(j.DocEntry),
    docNum: Number(j.DocNum ?? j.DocEntry),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const gotLock = await tryWatcherLock(sb, "pagcorp-settlement-watcher", 10);
  if (!gotLock) {
    return new Response(JSON.stringify({ ok: true, skipped: "another_run_in_progress" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const TIME_BUDGET_MS = 90_000;
  const PAGE_SIZE = 50;
  const LOCK_TTL_MIN = 5;
  const results: Array<{ id: string; status: string; error?: string }> = [];

  try {
    const cutoffLockIso = new Date(Date.now() - LOCK_TTL_MIN * 60_000).toISOString();
    let offset = 0;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data: rows, error } = await sb
        .from("pagcorp_integration_log")
        .select("id, company_db, sap_doc_entry, sap_doc_num, pagcorp_data, settlement_status, settlement_attempts")
        .eq("status", "success")
        .not("sap_doc_entry", "is", null)
        .not("company_db", "is", null)
        .in("settlement_status", ["pending", "awaiting_invoice", "awaiting_settlement", "error"])
        .or(`settlement_locked_at.is.null,settlement_locked_at.lt.${cutoffLockIso}`)
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;

      // agrupar por company_db para reaproveitar sessão SAP
      const byCompany = new Map<string, PagcorpLogRow[]>();
      for (const r of rows as PagcorpLogRow[]) {
        if (isTestCompanyDb(r.company_db)) {
          results.push({ id: r.id, status: "skipped", error: "test_base" });
          continue;
        }
        // Backoff exponencial simples para linhas em erro
        if (r.settlement_status === "error" && r.settlement_attempts >= 10) {
          results.push({ id: r.id, status: "skipped", error: "max_attempts" });
          continue;
        }
        const arr = byCompany.get(r.company_db) || [];
        arr.push(r);
        byCompany.set(r.company_db, arr);
      }

      for (const [companyDb, list] of byCompany) {
        // Locka as linhas para evitar corrida com outra execução
        const ids = list.map((r) => r.id);
        await sb
          .from("pagcorp_integration_log")
          .update({ settlement_locked_at: new Date().toISOString() })
          .in("id", ids);

        let cookie = "";
        let baseUrl = "";
        try {
          const creds = await loadCreds(sb, companyDb);
          baseUrl = buildBaseUrl(creds.service_layer_url);
          cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
        } catch (e) {
          const msg = (e as Error).message;
          for (const r of list) {
            await sb
              .from("pagcorp_integration_log")
              .update({
                settlement_status: "error",
                settlement_error: msg,
                settlement_attempts: (r.settlement_attempts || 0) + 1,
                settlement_attempted_at: new Date().toISOString(),
                settlement_locked_at: null,
              })
              .eq("id", r.id);
            results.push({ id: r.id, status: "error", error: msg });
          }
          continue;
        }

        try {
          for (const row of list) {
            const t0 = Date.now();
            try {
              // 1. PO precisa estar fechado (indica que a NF já foi lançada)
              const poR = await fetch(
                `${baseUrl}/PurchaseOrders(${row.sap_doc_entry})?$select=DocEntry,DocNum,DocumentStatus`,
                { headers: { Cookie: cookie } },
              );
              if (!poR.ok) throw new Error(`Consulta PO falhou ${poR.status}`);
              const po = await poR.json();
              if (po.DocumentStatus !== "bost_Close") {
                await sb
                  .from("pagcorp_integration_log")
                  .update({
                    settlement_status: "awaiting_invoice",
                    settlement_error: null,
                    settlement_locked_at: null,
                    settlement_attempted_at: new Date().toISOString(),
                  })
                  .eq("id", row.id);
                results.push({ id: row.id, status: "awaiting_invoice" });
                continue;
              }

              // 2. Localiza TODAS as NFs que apontam para o PO (1 PO → N NF)
              const invoices = await findInvoicesForPO(baseUrl, cookie, row.sap_doc_entry);
              if (invoices.length === 0) {
                await sb
                  .from("pagcorp_integration_log")
                  .update({
                    settlement_status: "awaiting_settlement",
                    settlement_error: "PO fechado mas nenhuma NF vinculada encontrada",
                    settlement_locked_at: null,
                    settlement_attempted_at: new Date().toISOString(),
                  })
                  .eq("id", row.id);
                results.push({ id: row.id, status: "awaiting_settlement" });
                continue;
              }

              // 3. Resolve conta contábil de baixa
              const cardKey = extractCardKey(row.pagcorp_data);
              const account = await resolveSettlementAccount(sb, companyDb, cardKey);
              if (!account) {
                await sb
                  .from("pagcorp_integration_log")
                  .update({
                    settlement_status: "skipped",
                    settlement_error: `Sem conta contábil de baixa cadastrada (empresa=${companyDb}, cartão=${cardKey ?? "fallback"})`,
                    settlement_locked_at: null,
                    settlement_attempted_at: new Date().toISOString(),
                  })
                  .eq("id", row.id);
                results.push({ id: row.id, status: "skipped", error: "no_settlement_account" });
                continue;
              }

              // 4. Emite UM Pagamento de Fornecedor por NF, baixando a
              //    PurchaseInvoice em Contas a Pagar. Idempotente: se a NF já
              //    estiver totalmente paga (bost_Close ou PaidToDate >= DocTotal),
              //    apenas registra o vínculo e não emite pagamento duplicado.
              const paymentEntries: number[] = [];
              const paymentNums: number[] = [];
              const invoiceEntries: number[] = [];
              const invoiceNums: number[] = [];
              const skippedAlreadyPaid: number[] = [];
              for (const invoice of invoices) {
                const openAmount = Math.max(0, +(invoice.DocTotal - invoice.PaidToDate).toFixed(2));
                const alreadyClosed = invoice.DocumentStatus === "bost_Close" || openAmount <= 0;

                let paymentDocEntry: number | null = null;
                let paymentDocNum: number | null = null;

                if (!alreadyClosed) {
                  const payment = await createVendorPayment(baseUrl, cookie, {
                    invoiceEntry: invoice.DocEntry,
                    invoiceDocNum: invoice.DocNum,
                    invoiceDate: invoice.DocDate,
                    cardCode: invoice.CardCode,
                    docCurrency: invoice.DocCurrency,
                    accountCode: account.settlement_account_code,
                    amount: openAmount,
                    memo: `Baixa PagCorp PC ${po.DocNum ?? row.sap_doc_num} NF ${invoice.DocNum}`,
                    costCenter: account.cost_center,
                    project: account.project,
                    bplId: invoice.BPLId,
                  });
                  paymentDocEntry = payment.docEntry;
                  paymentDocNum = payment.docNum;
                  paymentEntries.push(payment.docEntry);
                  paymentNums.push(payment.docNum);
                } else {
                  skippedAlreadyPaid.push(invoice.DocEntry);
                }

                invoiceEntries.push(invoice.DocEntry);
                invoiceNums.push(invoice.DocNum);

                // Vincula NF ↔ Conta a Pagar (PurchaseInvoice) por PC (BaseEntry),
                // não por valor exato. Uma NF que consuma este PC é o vínculo.
                const { data: nfRow } = await sb
                  .from("nf_entrada_imports")
                  .select("id")
                  .eq("sap_company_db", companyDb)
                  .eq("sap_matched_po_doc_entry", String(row.sap_doc_entry))
                  .maybeSingle();
                if (nfRow?.id) {
                  await linkNfToAp(sb, {
                    nfImportId: nfRow.id,
                    source: "sap",
                    companyDb,
                    apDocEntry: invoice.DocEntry,
                    apDocNum: invoice.DocNum,
                    apTotal: invoice.DocTotal,
                    apPaid: (invoice.PaidToDate || 0) + (paymentDocEntry ? openAmount : 0),
                    apCurrency: invoice.DocCurrency || null,
                    linkedBy: "pagcorp-settlement-watcher",
                    notes: paymentDocEntry
                      ? `Pagamento ${paymentDocNum} emitido em ${invoice.DocDate}`
                      : `NF já quitada no SAP (${invoice.DocumentStatus})`,
                  });
                }
              }

              const settlementNote: string[] = [];
              if (paymentEntries.length > 1) settlementNote.push(`${paymentEntries.length} pagamentos emitidos (docs: ${paymentNums.join(", ")})`);
              if (skippedAlreadyPaid.length > 0) settlementNote.push(`${skippedAlreadyPaid.length} NF(s) já quitadas`);

              await sb
                .from("pagcorp_integration_log")
                .update({
                  settlement_status: "settled",
                  settlement_payment_doc_entry: paymentEntries[0] ?? null,
                  settlement_payment_doc_num: paymentNums[0] ?? null,
                  settlement_invoice_doc_entry: invoiceEntries[0],
                  settlement_invoice_doc_num: invoiceNums[0],
                  settlement_error: settlementNote.length ? settlementNote.join(" | ") : null,
                  settlement_attempts: (row.settlement_attempts || 0) + 1,
                  settlement_attempted_at: new Date().toISOString(),
                  settlement_completed_at: new Date().toISOString(),
                  settlement_locked_at: null,
                })
                .eq("id", row.id);

              await logIntegrationCall({
                system_name: "pagcorp",
                action: "settlement",
                company_db: companyDb,
                status: "ok",
                duration_ms: Date.now() - t0,
                request_meta: { poEntry: row.sap_doc_entry, invoiceEntries },
                response_meta: { paymentEntries, paymentNums, account: account.settlement_account_code, skippedAlreadyPaid },
              });
              results.push({ id: row.id, status: "settled" });
            } catch (e) {
              const msg = (e as Error).message;
              await sb
                .from("pagcorp_integration_log")
                .update({
                  settlement_status: "error",
                  settlement_error: msg,
                  settlement_attempts: (row.settlement_attempts || 0) + 1,
                  settlement_attempted_at: new Date().toISOString(),
                  settlement_locked_at: null,
                })
                .eq("id", row.id);
              await logIntegrationCall({
                system_name: "pagcorp",
                action: "settlement",
                company_db: companyDb,
                status: "error",
                error_message: msg,
                duration_ms: Date.now() - t0,
                request_meta: { poEntry: row.sap_doc_entry },
              });
              results.push({ id: row.id, status: "error", error: msg });
            }
          }
        } finally {
          await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
        }
      }

      offset += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }

    await releaseWatcherLock(sb, "pagcorp-settlement-watcher", "ok", `processed=${results.length}`);
    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    await releaseWatcherLock(sb, "pagcorp-settlement-watcher", "error", msg);
    return new Response(JSON.stringify({ error: msg, results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
