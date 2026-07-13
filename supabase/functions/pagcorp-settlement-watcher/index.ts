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
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { logIntegrationCall } from "../_shared/integration-log.ts";
import { linkNfToAp } from "../_shared/link-nf-ap.ts";

const sapCorsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
  "Access-Control-Expose-Headers": "x-request-id",
};

function responseHeaders(requestId: string, contentType = "application/json") {
  return {
    ...sapCorsHeaders,
    "x-request-id": requestId,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function safeLog(requestId: string, event: string, details: Record<string, unknown> = {}) {
  console.info(`[pagcorp-settlement-watcher:${requestId}] ${event}`, JSON.stringify(details));
}

function safeWarn(requestId: string, event: string, details: Record<string, unknown> = {}) {
  console.warn(`[pagcorp-settlement-watcher:${requestId}] ${event}`, JSON.stringify(details));
}

function safeError(requestId: string, event: string, details: Record<string, unknown> = {}) {
  console.error(`[pagcorp-settlement-watcher:${requestId}] ${event}`, JSON.stringify(details));
}

function hostFromUrl(raw: string): string | null {
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

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
  currency: string | null;
  event_classification: string | null;
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

function extractEventClassification(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const raw =
    (payload.eventClassification as string | undefined) ??
    (payload.event_classification as string | undefined) ??
    ((payload.transaction as Record<string, unknown> | undefined)?.eventClassification as string | undefined) ??
    null;
  return raw ? String(raw) : null;
}

/**
 * Normaliza classificação p/ comparação (colapsa espaços múltiplos, trim, lowercase).
 * O PagCorp devolve "Compra Internacional  - Saldo Dolar Utilizado" com 2 espaços;
 * a normalização evita quebrar o match se alguém cadastrar com 1 espaço.
 */
function normalizeClassification(v: string | null | undefined): string {
  return (v || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function resolveSettlementAccount(
  sb: ReturnType<typeof createClient>,
  companyDb: string,
  _cardKey: string | null,
  _currency: string | null,
  eventClassification: string | null,
): Promise<SettlementAccount | null> {
  // Regra: a conta de baixa é decidida pela classificação do evento
  // retornada pelo PagCorp. Cartão e moeda não participam mais.
  // Se não houver classificação no payload OU se nenhuma linha específica
  // bater, cai para a linha "fallback" (event_classification IS NULL)
  // cadastrada pelo usuário — se existir.
  const sel = "settlement_account_code, cost_center, project, currency, event_classification";
  const { data } = await sb
    .from("pagcorp_settlement_accounts")
    .select(sel)
    .eq("company_db", companyDb)
    .eq("enabled", true);

  const rows = (data as SettlementAccount[] | null) || [];
  if (eventClassification) {
    const target = normalizeClassification(eventClassification);
    const exact = rows.find(
      (r) => r.event_classification && normalizeClassification(r.event_classification) === target,
    );
    if (exact) return exact;
  }
  // Fallback: linha sem classificação específica.
  return rows.find((r) => !r.event_classification) || null;
}

async function findInvoicesForPO(
  baseUrl: string,
  cookie: string,
  poEntry: number,
  cardCode: string,
): Promise<
  Array<{ DocEntry: number; DocNum: number; CardCode: string; CardName: string; DocTotal: number; DocTotalSys: number; PaidToDate: number; PaidToDateSys: number; DocumentStatus: string; DocCurrency: string; DocRate: number; DocDate: string; BPLId?: number }>
> {
  // SAP B1 SL v2 rejeita `DocumentLines/any()` no $filter ("Query string error -
  // Invalid symbol"), então buscamos as PurchaseInvoices do fornecedor pelo
  // CardCode e filtramos as linhas do cliente-lado por BaseType=22 (PO) e
  // BaseEntry=poEntry. Um PO → N NFs.
  if (!cardCode) return [];
  const q = `${baseUrl}/PurchaseInvoices?$filter=${encodeURIComponent(
    `CardCode eq '${cardCode.replace(/'/g, "''")}'`,
  )}&$orderby=DocEntry desc&$top=100`;
  const r = await fetch(q, { headers: { Cookie: cookie } });
  if (!r.ok) throw new Error(`Consulta PurchaseInvoices falhou ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const arr = Array.isArray(j?.value) ? j.value : [];
  const matched = arr.filter((inv: any) =>
    Array.isArray(inv?.DocumentLines) &&
    inv.DocumentLines.some(
      (l: any) => Number(l?.BaseEntry) === poEntry && Number(l?.BaseType) === 22,
    ),
  );
  return matched.map((inv: any) => ({
    DocEntry: Number(inv.DocEntry),
    DocNum: Number(inv.DocNum),
    CardCode: String(inv.CardCode),
    CardName: String(inv.CardName ?? ""),
    DocTotal: Number(inv.DocTotal),
    DocTotalSys: Number(inv.DocTotalSys ?? inv.DocTotal ?? 0),
    PaidToDate: Number(inv.PaidToDate ?? 0),
    PaidToDateSys: Number(inv.PaidToDateSys ?? 0),
    DocumentStatus: String(inv.DocumentStatus ?? ""),
    DocCurrency: String(inv.DocCurrency ?? ""),
    DocRate: Number(inv.DocRate ?? 0),
    DocDate: String(inv.DocDate),
    BPLId: inv.BPL_IDAssignedToInvoice != null ? Number(inv.BPL_IDAssignedToInvoice) : undefined,
  }));
}


/**
 * Consulta a PTAX (cotação de venda) do Banco Central para uma moeda em uma data.
 * O endpoint da BCB (Olinda) só retorna cotação em dias úteis; se a data cair
 * em fim de semana / feriado, tentamos até 7 dias anteriores.
 * Retorna null se não encontrar cotação — a chamada deve tratar (sem baixa).
 */
async function fetchPtax(currency: string, isoDate: string): Promise<{ rate: number; ptaxDate: string } | null> {
  const cur = (currency || "").toUpperCase();
  if (!cur || cur === "BRL") return null;
  const base = new Date(`${isoDate}T12:00:00Z`);
  for (let back = 0; back < 8; back++) {
    const d = new Date(base.getTime() - back * 24 * 60 * 60 * 1000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    const dataParam = `${mm}-${dd}-${yyyy}`;
    const url =
      `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)` +
      `?@moeda='${cur}'&@dataCotacao='${dataParam}'&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao`;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = await r.json();
      const row = Array.isArray(j?.value) && j.value.length > 0 ? j.value[0] : null;
      const rate = row ? Number(row.cotacaoVenda) : NaN;
      if (row && Number.isFinite(rate) && rate > 0) {
        return { rate, ptaxDate: String(row.dataHoraCotacao || dataParam) };
      }
    } catch {
      // tenta dia anterior
    }
  }
  return null;
}

/**
 * Próximo horário elegível para tentar novamente uma baixa que ficou parada por
 * ausência de PTAX. O BCB publica a PTAX de fechamento por volta das 13h BRT
 * (16:00 UTC) em dias úteis. Retornamos o próximo slot 16:30 UTC futuro, pulando
 * fins de semana. Isso evita retentativas a cada 5 min sem chance real de sucesso.
 */
function nextPtaxRetryAfter(from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  // Hoje 16:30 UTC
  const candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 30, 0));
  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  // Se cair no fim de semana, pula para segunda
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}



/**
 * Emite um Pagamento de Fornecedor (Outgoing Payment) que baixa a
 * PurchaseInvoice indicada. A contrapartida contábil é a `TransferAccount`
 * (GL configurada para o cartão PagCorp).
 *
 * Para faturas em moeda estrangeira (ex.: USD), o campo `DocRate` é
 * preenchido com a PTAX de venda do BCB da data da fatura/compra.
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
    cardName: string;
    docCurrency: string;
    accountCode: string;
    /** Valor da baixa em moeda LOCAL (BRL). Vira TransferSum. */
    transferSumLocal: number;
    /** SumApplied em moeda LOCAL calculado pela DocRate da NF. */
    sumAppliedLocal: number;
    costCenter: string | null;
    project: string | null;
    bplId?: number;
    /** DocRate do pagamento (PTAX do dia da NF). Só para FC. */
    docRate?: number | null;
  },
): Promise<{ docEntry: number; docNum: number }> {
  // Formato do JournalRemarks e Reference1 replicam a baixa manual feita no SAP:
  //   JournalRemarks: "PAGAMENTO REF. CP Nº {DocNum} - {CardCode} - {CardName}"
  //   Reference1: {DocNum da NF de entrada sendo baixada}
  //   Remarks: null (SAP preenche automaticamente com o padrão da série)
  const journalRemarks =
    `PAGAMENTO REF. CP Nº ${args.invoiceDocNum} - ${args.cardCode} - ${args.cardName}`.slice(0, 50);

  const body: Record<string, unknown> = {
    DocType: "rSupplier",
    CardCode: args.cardCode,
    DocDate: args.invoiceDate,
    TaxDate: args.invoiceDate,
    DueDate: args.invoiceDate,
    JournalRemarks: journalRemarks,
    Reference1: String(args.invoiceDocNum),
    TransferAccount: args.accountCode,
    TransferSum: args.transferSumLocal,
    TransferDate: args.invoiceDate,
    PaymentInvoices: [
      {
        DocEntry: args.invoiceEntry,
        InvoiceType: "it_PurchaseInvoice",
        SumApplied: args.sumAppliedLocal,
      },
    ],
  };
  if (args.docCurrency) body.DocCurrency = args.docCurrency;
  if (args.docRate && args.docRate > 0) body.DocRate = args.docRate;
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
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    safeLog(requestId, "cors_preflight", {
      origin: req.headers.get("origin"),
      requestMethod: req.headers.get("access-control-request-method"),
      requestHeaders: req.headers.get("access-control-request-headers"),
      allowedHeaders: sapCorsHeaders["Access-Control-Allow-Headers"],
    });
    return new Response("ok", { headers: responseHeaders(requestId, "text/plain") });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Suporte a disparo manual de um único log (baixa automática pela UI):
  //   POST { logId: string, forceRetry?: true }
  // Ignora locks/backoff e processa apenas aquela linha. Chamadas sem body
  // permanecem sendo o fluxo do cron (varredura de várias linhas).
  let manualLogId: string | null = null;
  let manualForceRetry = false;
  // Sessão SAP do usuário (quando a UI dispara "Reprocessar baixa"). Usada
  // como fallback caso as credenciais salvas em system_credentials estejam
  // bloqueadas por SSO ("Fail to NONE-SSO login from SLD").
  const userSapSession = req.headers.get("x-sap-session") || "";
  const userSapRoute = req.headers.get("x-sap-route") || "";
  const userSapCompanyDb = req.headers.get("x-company-db") || "";
  const userSapUser = req.headers.get("x-sap-user") || "";
  const userSapCookie = userSapSession
    ? `B1SESSION=${userSapSession}${userSapRoute ? `; ROUTEID=${userSapRoute}` : ""}`
    : "";
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.logId === "string" && body.logId.length > 0) {
        manualLogId = body.logId;
        manualForceRetry = body.forceRetry !== false;
      }
    } catch { /* ignore */ }
  }

  safeLog(requestId, "request_received", {
    method: req.method,
    origin: req.headers.get("origin"),
    contentType: req.headers.get("content-type"),
    hasAuthorization: Boolean(req.headers.get("authorization")),
    hasApiKey: Boolean(req.headers.get("apikey")),
    hasSapSession: Boolean(userSapSession),
    sapSessionLength: userSapSession.length || 0,
    hasSapRoute: Boolean(userSapRoute),
    sapRoute: userSapRoute || null,
    sapUser: userSapUser || null,
    sapCompanyDb: userSapCompanyDb || null,
    manualLogId,
    manualForceRetry,
  });

  const lockName = manualLogId
    ? `pagcorp-settlement-watcher:${manualLogId}`
    : "pagcorp-settlement-watcher";
  const gotLock = await tryWatcherLock(sb, lockName, 10);
  if (!gotLock) {
    safeWarn(requestId, "lock_skipped", { lockName, manualLogId });
    return new Response(JSON.stringify({ ok: true, skipped: "another_run_in_progress" }), {
      headers: responseHeaders(requestId),
    });
  }

  const startedAt = Date.now();
  const TIME_BUDGET_MS = 90_000;
  const PAGE_SIZE = 50;
  const LOCK_TTL_MIN = 5;
  const results: Array<{ id: string; status: string; error?: string }> = [];

  try {
    // Se for retentativa manual, limpa gates de backoff da linha alvo antes
    // do select para garantir que ela seja pega neste run.
    if (manualLogId && manualForceRetry) {
      safeLog(requestId, "manual_retry_reset", { manualLogId });
      await sb
        .from("pagcorp_integration_log")
        .update({
          settlement_retry_after: null,
          settlement_locked_at: null,
          settlement_attempts: 0,
          settlement_error: null,
          settlement_status: "pending",
        })
        .eq("id", manualLogId);
    }

    const cutoffLockIso = new Date(Date.now() - LOCK_TTL_MIN * 60_000).toISOString();
    let offset = 0;

    const nowIso = new Date().toISOString();
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      let q = sb
        .from("pagcorp_integration_log")
        .select("id, company_db, sap_doc_entry, sap_doc_num, pagcorp_data, settlement_status, settlement_attempts")
        .eq("status", "success")
        .not("sap_doc_entry", "is", null)
        .not("company_db", "is", null);
      if (manualLogId) {
        q = q.eq("id", manualLogId);
      } else {
        q = q
          .in("settlement_status", ["pending", "awaiting_invoice", "awaiting_settlement", "error"])
          .or(`settlement_locked_at.is.null,settlement_locked_at.lt.${cutoffLockIso}`)
          .or(`settlement_retry_after.is.null,settlement_retry_after.lt.${nowIso}`);
      }
      const { data: rows, error } = await q
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      safeLog(requestId, "rows_selected", {
        manualLogId,
        offset,
        count: rows?.length || 0,
      });
      if (!rows || rows.length === 0) break;


      // agrupar por company_db para reaproveitar sessão SAP
      const byCompany = new Map<string, PagcorpLogRow[]>();
      for (const r of rows as PagcorpLogRow[]) {
        if (isTestCompanyDb(r.company_db)) {
          results.push({ id: r.id, status: "skipped", error: "test_base" });
          continue;
        }
        // Backoff exponencial simples para linhas em erro
        // No cron: pula linhas em erro que já esgotaram tentativas.
        // Em retentativa manual, ignora esse guard — o usuário decidiu tentar de novo.
        if (!manualLogId && r.settlement_status === "error" && r.settlement_attempts >= 10) {
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
          // Se a chamada veio da UI (manual) e o usuário tem sessão SAP
          // válida na MESMA companyDb, reaproveita a sessão do usuário —
          // evita "Fail to NONE-SSO login from SLD" quando o usuário técnico
          // salvo em system_credentials está com SSO obrigatório.
          if (manualLogId && userSapCookie && userSapCompanyDb === companyDb) {
            cookie = userSapCookie;
            safeLog(requestId, "sap_session_strategy", {
              companyDb,
              strategy: "user_sap_session",
              sapHost: hostFromUrl(baseUrl),
              hasUserSapCookie: true,
              userSapCompanyDb,
            });
          } else {
            safeLog(requestId, "sap_session_strategy", {
              companyDb,
              strategy: "stored_credentials_login",
              sapHost: hostFromUrl(baseUrl),
              hasUserSapCookie: Boolean(userSapCookie),
              userSapCompanyDb: userSapCompanyDb || null,
              userSapCompanyMatches: userSapCompanyDb === companyDb,
            });
            cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
          }
        } catch (e) {
          const msg = (e as Error).message;
          safeError(requestId, "sap_session_error", { companyDb, error: msg });
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
              safeLog(requestId, "row_start", {
                id: row.id,
                companyDb,
                poEntry: row.sap_doc_entry,
                poNum: row.sap_doc_num,
                settlementStatus: row.settlement_status,
                attempts: row.settlement_attempts,
              });
              // 1. PO precisa estar fechado (indica que a NF já foi lançada)
              const poR = await fetch(
                `${baseUrl}/PurchaseOrders(${row.sap_doc_entry})?$select=DocEntry,DocNum,DocumentStatus,CardCode`,
                { headers: { Cookie: cookie } },
              );
              if (!poR.ok) throw new Error(`Consulta PO falhou ${poR.status}`);
              const po = await poR.json();
              safeLog(requestId, "po_fetch_result", {
                id: row.id,
                poEntry: row.sap_doc_entry,
                httpStatus: poR.status,
                documentStatus: po.DocumentStatus,
                hasCardCode: Boolean(po.CardCode),
              });
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
              const invoices = await findInvoicesForPO(baseUrl, cookie, row.sap_doc_entry, String(po.CardCode ?? ""));
              safeLog(requestId, "invoices_found", {
                id: row.id,
                poEntry: row.sap_doc_entry,
                count: invoices.length,
                invoiceEntries: invoices.map((invoice) => invoice.DocEntry),
                invoiceStatuses: invoices.map((invoice) => invoice.DocumentStatus),
              });
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

              // 3. Card key + classificação do evento (primária) + moeda (fallback).
              //    A conta contábil é resolvida por NF: prioriza o mapeamento por
              //    `eventClassification` retornado pela API do PagCorp; se não
              //    houver, cai para moeda (BRL/USD) ou fallback global.
              const cardKey = extractCardKey(row.pagcorp_data);
              const eventClass = extractEventClassification(row.pagcorp_data);

              // 4. Emite UM Pagamento de Fornecedor por NF, baixando a
              //    PurchaseInvoice em Contas a Pagar. Idempotente: se a NF já
              //    estiver totalmente paga (bost_Close ou PaidToDate >= DocTotal),
              //    apenas registra o vínculo e não emite pagamento duplicado.
              const paymentEntries: number[] = [];
              const paymentNums: number[] = [];
              const invoiceEntries: number[] = [];
              const invoiceNums: number[] = [];
              const skippedAlreadyPaid: number[] = [];
              const accountsUsed: string[] = [];
              let firstMissingAccountMsg: string | null = null;
              let firstPtaxMissingMsg: string | null = null;
              let firstPtax: { rate: number; ptaxDate: string; source: string } | null = null;
              for (const invoice of invoices) {
                const openAmount = Math.max(0, +(invoice.DocTotal - invoice.PaidToDate).toFixed(2));
                const alreadyClosed = invoice.DocumentStatus === "bost_Close" || openAmount <= 0;

                const account = await resolveSettlementAccount(sb, companyDb, cardKey, invoice.DocCurrency || null, eventClass);
                if (!account) {
                  if (!firstMissingAccountMsg) {
                    firstMissingAccountMsg = eventClass
                      ? `Sem conta contábil de baixa cadastrada para a classificação "${eventClass}" (empresa=${companyDb}).`
                      : `Transação sem classificação de evento — reintegre a despesa para atualizar o cadastro (empresa=${companyDb}).`;
                  }
                  continue;
                }
                accountsUsed.push(account.settlement_account_code);

                let paymentDocEntry: number | null = null;
                let paymentDocNum: number | null = null;

                if (!alreadyClosed) {
                  // PTAX só se aplica a pagamentos em USD (dólar). Compras em
                  // BRL (real) — ou qualquer outra moeda que não seja USD —
                  // são baixadas pelo valor local (openAmount), sem conversão.
                  const invCur = (invoice.DocCurrency || "").toUpperCase();
                  let docRate: number | null = null;
                  if (invCur === "USD") {
                    const ptax = await fetchPtax(invCur, invoice.DocDate);
                    if (!ptax) {
                      if (!firstPtaxMissingMsg) {
                        firstPtaxMissingMsg = `PTAX ${invCur} indisponível para ${invoice.DocDate}`;
                      }
                      // remove desta iteração da contagem de "contas usadas" — nada foi pago
                      accountsUsed.pop();
                      continue;
                    }
                    docRate = ptax.rate;
                    if (!firstPtax) {
                      firstPtax = {
                        rate: ptax.rate,
                        ptaxDate: ptax.ptaxDate,
                        source: `BCB Olinda PTAX venda (${invCur})`,
                      };
                    }
                  }

                  // Cálculo dos valores em moeda LOCAL para replicar a baixa
                  // manual do SAP:
                  //  • TransferSum = valor FC × PTAX do pagamento (openAmount × docRate)
                  //  • SumApplied  = valor FC × DocRate da NF (mantém consistência
                  //    contábil do saldo aberto da NF; se DocRate da NF não veio,
                  //    cai para o mesmo valor de TransferSum).
                  //  Para BRL (docRate=null), tudo é o próprio openAmount.
                  const paymentRate = docRate && docRate > 0 ? docRate : 1;
                  const invoiceRate = invoice.DocRate && invoice.DocRate > 0 ? invoice.DocRate : paymentRate;
                  const transferSumLocal = docRate ? +(openAmount * paymentRate).toFixed(2) : openAmount;
                  const sumAppliedLocal = docRate ? +(openAmount * invoiceRate).toFixed(2) : openAmount;

                  const payment = await createVendorPayment(baseUrl, cookie, {
                    invoiceEntry: invoice.DocEntry,
                    invoiceDocNum: invoice.DocNum,
                    invoiceDate: invoice.DocDate,
                    cardCode: invoice.CardCode,
                    cardName: invoice.CardName,
                    docCurrency: invoice.DocCurrency,
                    accountCode: account.settlement_account_code,
                    transferSumLocal,
                    sumAppliedLocal,
                    costCenter: account.cost_center,
                    project: account.project,
                    bplId: invoice.BPLId,
                    docRate,
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

              // Se nenhuma NF conseguiu emitir baixa (falta de conta contábil ou
              // PTAX ainda não publicada), marca como awaiting_settlement e agenda
              // a próxima retentativa: para PTAX, só faz sentido tentar após ~13h BRT
              // (16:30 UTC) do próximo dia útil; para conta faltante, mantemos o
              // retry curto (5min) pois depende de configuração do usuário.
              if (invoices.length > 0 && accountsUsed.length === 0 && (firstMissingAccountMsg || firstPtaxMissingMsg)) {
                const isPtax = !firstMissingAccountMsg && !!firstPtaxMissingMsg;
                const retryAfter = isPtax ? nextPtaxRetryAfter().toISOString() : null;
                await sb
                  .from("pagcorp_integration_log")
                  .update({
                    settlement_status: "awaiting_settlement",
                    settlement_error: firstMissingAccountMsg ?? firstPtaxMissingMsg,
                    settlement_locked_at: null,
                    settlement_retry_after: retryAfter,
                    settlement_attempted_at: new Date().toISOString(),
                  })
                  .eq("id", row.id);
                results.push({
                  id: row.id,
                  status: "awaiting_settlement",
                  error: isPtax ? "ptax_missing" : "no_settlement_account",
                });
                continue;
              }

              // Se nenhum pagamento novo foi emitido nesta rodada (todas as NFs já
              // estavam quitadas — típico quando várias transações do PagCorp caem
              // no mesmo PC e a primeira já disparou a baixa), herda os números da
              // baixa da linha irmã (mesmo company_db + sap_doc_entry) que já foi
              // liquidada. Sem isso, esta linha ficaria "settled" mas sem
              // settlement_payment_doc_num, o que a UI interpreta como "Reprocessar
              // baixa" em vez de "Baixa #<num>".
              let inheritedPaymentEntry: number | null = null;
              let inheritedPaymentNum: number | null = null;
              let inheritedInvoiceEntry: number | null = null;
              let inheritedInvoiceNum: number | null = null;
              if (paymentEntries.length === 0) {
                const { data: sibling } = await sb
                  .from("pagcorp_integration_log")
                  .select("settlement_payment_doc_entry, settlement_payment_doc_num, settlement_invoice_doc_entry, settlement_invoice_doc_num")
                  .eq("company_db", companyDb)
                  .eq("sap_doc_entry", row.sap_doc_entry)
                  .not("settlement_payment_doc_num", "is", null)
                  .neq("id", row.id)
                  .order("settlement_completed_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (sibling) {
                  inheritedPaymentEntry = (sibling as { settlement_payment_doc_entry: number | null }).settlement_payment_doc_entry ?? null;
                  inheritedPaymentNum = (sibling as { settlement_payment_doc_num: number | null }).settlement_payment_doc_num ?? null;
                  inheritedInvoiceEntry = (sibling as { settlement_invoice_doc_entry: number | null }).settlement_invoice_doc_entry ?? null;
                  inheritedInvoiceNum = (sibling as { settlement_invoice_doc_num: number | null }).settlement_invoice_doc_num ?? null;
                  if (inheritedPaymentNum) {
                    settlementNote.push(`Baixa consolidada com transação irmã (pagamento ${inheritedPaymentNum})`);
                  }
                }
              }

              await sb
                .from("pagcorp_integration_log")
                .update({
                  settlement_status: "settled",
                  settlement_payment_doc_entry: paymentEntries[0] ?? inheritedPaymentEntry,
                  settlement_payment_doc_num: paymentNums[0] ?? inheritedPaymentNum,
                  settlement_invoice_doc_entry: invoiceEntries[0] ?? inheritedInvoiceEntry,
                  settlement_invoice_doc_num: invoiceNums[0] ?? inheritedInvoiceNum,
                  settlement_ptax_rate: firstPtax?.rate ?? null,
                  settlement_ptax_date: firstPtax?.ptaxDate ? firstPtax.ptaxDate.slice(0, 10) : null,
                  settlement_ptax_source: firstPtax?.source ?? null,
                  settlement_error: settlementNote.length ? settlementNote.join(" | ") : null,
                  settlement_attempts: (row.settlement_attempts || 0) + 1,
                  settlement_attempted_at: new Date().toISOString(),
                  settlement_completed_at: new Date().toISOString(),
                  settlement_locked_at: null,
                  settlement_retry_after: null,
                })
                .eq("id", row.id);

              await logIntegrationCall({
                system_name: "pagcorp",
                action: "settlement",
                company_db: companyDb,
                status: "ok",
                duration_ms: Date.now() - t0,
                request_meta: { poEntry: row.sap_doc_entry, invoiceEntries },
                response_meta: { paymentEntries, paymentNums, accountsUsed, skippedAlreadyPaid },
              });
              safeLog(requestId, "row_success", {
                id: row.id,
                status: "settled",
                durationMs: Date.now() - t0,
                paymentEntries,
                invoiceEntries,
                skippedAlreadyPaid,
              });
              results.push({ id: row.id, status: "settled" });
            } catch (e) {
              const msg = (e as Error).message;
              safeError(requestId, "row_error", {
                id: row.id,
                companyDb,
                poEntry: row.sap_doc_entry,
                durationMs: Date.now() - t0,
                error: msg,
              });
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

    await releaseWatcherLock(sb, lockName, "ok", `processed=${results.length}`);
    safeLog(requestId, "request_completed", { processed: results.length, results });
    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: responseHeaders(requestId),
    });
  } catch (e) {
    const msg = (e as Error).message;
    safeError(requestId, "request_failed", { error: msg, results });
    await releaseWatcherLock(sb, lockName, "error", msg);
    return new Response(JSON.stringify({ error: msg, results }), {
      status: 500,
      headers: responseHeaders(requestId),
    });
  }
});
