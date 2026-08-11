// Construção dos snapshots (baseline × settlement) para a auditoria de pagamentos.
import { admin, sapGet, sapList } from "./sap.ts";
import type { Snapshot, SnapshotLine } from "./engine.ts";

function n(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function emptySnapshot(source: string): Snapshot {
  return {
    source,
    document_ref: null,
    doc_date: null,
    fornecedor_code: null,
    fornecedor_name: null,
    valor: null,
    currency: null,
    cost_center: null,
    project: null,
    solicitante: null,
    aprovadores: [],
    bank: null,
    lines: [],
  };
}

/** Dados bancários cadastrados do fornecedor (BP) no SAP. */
export async function bpBank(baseUrl: string, cookie: string, cardCode: string) {
  if (!cardCode) return null;
  const bp = await sapGet<any>(
    baseUrl,
    cookie,
    `BusinessPartners('${encodeURIComponent(cardCode)}')?$select=CardCode,CardName,BPBankAccounts,DefaultBankCode,DefaultAccount,DefaultBranch`,
  ).catch(() => null);
  if (!bp) return null;
  const accounts: any[] = Array.isArray(bp.BPBankAccounts) ? bp.BPBankAccounts : [];
  const preferred =
    accounts.find((a) => String(a?.BankCode ?? "") === String(bp.DefaultBankCode ?? "")) ?? accounts[0] ?? null;
  return {
    bank_code: preferred?.BankCode ? String(preferred.BankCode) : (bp.DefaultBankCode ? String(bp.DefaultBankCode) : null),
    branch: preferred?.Branch ? String(preferred.Branch) : (bp.DefaultBranch ? String(bp.DefaultBranch) : null),
    account: preferred?.AccountNo ? String(preferred.AccountNo) : (bp.DefaultAccount ? String(bp.DefaultAccount) : null),
    pix: preferred?.BankAccountName ? String(preferred.BankAccountName) : null,
  };
}

function mapSapLines(lines: any[]): SnapshotLine[] {
  return (lines ?? []).map((l) => ({
    item_code: l?.ItemCode ? String(l.ItemCode) : (l?.ItemDescription ? null : null),
    description: l?.ItemDescription ? String(l.ItemDescription) : null,
    quantity: n(l?.Quantity),
    unit_price: n(l?.UnitPrice ?? l?.Price),
    line_total: n(l?.LineTotal),
    cost_center: l?.CostingCode ? String(l.CostingCode) : null,
    project: l?.ProjectCode ? String(l.ProjectCode) : (l?.Project ? String(l.Project) : null),
  }));
}

/** Snapshot do pagamento: fatura de compra + pagamento efetuado (GET-only). */
export async function buildSettlementSnapshot(
  baseUrl: string,
  cookie: string,
  documentType: string,
  docEntry: number,
): Promise<Snapshot> {
  const snap = emptySnapshot("sap_settlement");
  const resource = documentType === "purchase_order" ? "PurchaseOrders" : "PurchaseInvoices";
  const inv = await sapGet<any>(baseUrl, cookie, `${resource}(${docEntry})`);
  if (!inv) return snap;

  snap.document_ref = `${resource}:${inv.DocEntry}`;
  snap.doc_date = inv.DocDate ?? null;
  snap.fornecedor_code = inv.CardCode ? String(inv.CardCode) : null;
  snap.fornecedor_name = inv.CardName ? String(inv.CardName) : null;
  snap.valor = n(inv.DocTotal);
  snap.currency = inv.DocCurrency ? String(inv.DocCurrency) : null;
  snap.lines = mapSapLines(inv.DocumentLines);
  snap.cost_center = snap.lines.find((l) => l.cost_center)?.cost_center ?? null;
  snap.project = inv.Project ? String(inv.Project) : (snap.lines.find((l) => l.project)?.project ?? null);
  snap.solicitante = inv.Requester ? String(inv.Requester) : null;

  // Pagamentos que liquidam esta fatura
  let payments: any[] = [];
  if (resource === "PurchaseInvoices") {
    payments = await sapList<any>(
      baseUrl,
      cookie,
      `VendorPayments?$filter=PaymentInvoices/any(i: i/DocEntry eq ${docEntry})&$top=20`,
    ).catch(() => []);
  }
  const pay = payments[0] ?? null;
  if (pay) {
    snap.extra = {
      payments: payments.map((p) => ({
        DocEntry: p.DocEntry,
        DocNum: p.DocNum,
        DocDate: p.DocDate,
        CardCode: p.CardCode,
        TransferSum: p.TransferSum,
        CashSum: p.CashSum,
        CheckSum: p.CheckSum,
        DocTotal: p.DocTotal,
      })),
      paid_to_date: inv.PaidToDate ?? null,
    };
    if (n(inv.PaidToDate)) snap.valor = n(inv.PaidToDate);
    snap.bank = {
      bank_code: pay.TransferAccount ? String(pay.TransferAccount) : null,
      branch: pay.BankChargeAmount != null ? null : null,
      account: pay.TransferAccount ? String(pay.TransferAccount) : null,
      pix: null,
    };
  }
  // Se o pagamento não trouxe conta, usa a conta bancária do fornecedor efetivamente pago
  if (!snap.bank?.account && snap.fornecedor_code) {
    snap.bank = await bpBank(baseUrl, cookie, snap.fornecedor_code);
  }
  return snap;
}

/** Snapshot do baseline a partir da aprovação registrada no ERP Flow. */
export async function buildFlowBaselineSnapshot(
  companyDb: string,
  hints: { poDocEntry?: number | null; invoiceDocEntry?: number | null; cardCode?: string | null },
  bankLookup?: (cardCode: string) => Promise<Snapshot["bank"]>,
): Promise<Snapshot> {
  const snap = emptySnapshot("erp_flow_approval");
  const sb = admin();
  let expense: any = null;

  if (hints.poDocEntry) {
    const { data } = await sb
      .from("expenses")
      .select("*")
      .eq("company_db", companyDb)
      .eq("sap_doc_entry", hints.poDocEntry)
      .limit(1);
    expense = data?.[0] ?? null;
  }
  if (!expense && hints.invoiceDocEntry) {
    const { data } = await sb
      .from("expenses")
      .select("*")
      .eq("company_db", companyDb)
      .eq("sap_doc_entry", hints.invoiceDocEntry)
      .limit(1);
    expense = data?.[0] ?? null;
  }
  if (!expense) return snap;

  const { data: items } = await sb
    .from("expense_items")
    .select("item_code, description, quantity, unit_price, line_total, cost_center, project")
    .eq("expense_id", expense.id);
  const { data: segments } = await sb
    .from("expense_approval_segments")
    .select("cost_center, project, current_approver, decided_by, status, rule_name")
    .eq("expense_id", expense.id);

  snap.document_ref = `expense:${expense.id}`;
  snap.doc_date = expense.doc_date ?? expense.created_at ?? null;
  snap.fornecedor_code = expense.supplier_code ?? null;
  snap.fornecedor_name = expense.supplier_name ?? null;
  snap.valor = n(expense.total_amount);
  snap.currency = expense.currency ?? null;
  snap.cost_center = expense.cost_center ?? null;
  snap.project = expense.project ?? null;
  snap.solicitante = expense.requester_email || expense.created_by_email || expense.requester_name || null;
  snap.aprovadores = (segments ?? [])
    .map((s: any) => s.decided_by || s.current_approver)
    .filter(Boolean);
  snap.lines = (items ?? []).map((i: any) => ({
    item_code: i.item_code ?? null,
    description: i.description ?? null,
    quantity: n(i.quantity),
    unit_price: n(i.unit_price),
    line_total: n(i.line_total),
    cost_center: i.cost_center ?? null,
    project: i.project ?? null,
  }));
  snap.extra = {
    expense_id: expense.id,
    status: expense.status,
    rateio_type: expense.rateio_type,
    segments: segments ?? [],
    sap_doc_num: expense.sap_doc_num,
  };
  if (snap.fornecedor_code && bankLookup) {
    snap.bank = await bankLookup(snap.fornecedor_code).catch(() => null);
  }
  return snap;
}

/** Snapshot do baseline a partir do Pedido de Compra no SAP. */
export async function buildPoBaselineSnapshot(
  baseUrl: string,
  cookie: string,
  poDocEntry: number,
): Promise<Snapshot> {
  const snap = emptySnapshot("sap_purchase_order");
  const po = await sapGet<any>(baseUrl, cookie, `PurchaseOrders(${poDocEntry})`);
  if (!po) return snap;
  snap.document_ref = `PurchaseOrders:${po.DocEntry}`;
  snap.doc_date = po.DocDate ?? null;
  snap.fornecedor_code = po.CardCode ? String(po.CardCode) : null;
  snap.fornecedor_name = po.CardName ? String(po.CardName) : null;
  snap.valor = n(po.DocTotal);
  snap.currency = po.DocCurrency ? String(po.DocCurrency) : null;
  snap.lines = mapSapLines(po.DocumentLines);
  snap.cost_center = snap.lines.find((l) => l.cost_center)?.cost_center ?? null;
  snap.project = po.Project ? String(po.Project) : (snap.lines.find((l) => l.project)?.project ?? null);
  snap.solicitante = po.Requester ? String(po.Requester) : null;
  if (snap.fornecedor_code) snap.bank = await bpBank(baseUrl, cookie, snap.fornecedor_code);
  return snap;
}

/** Descobre o DocEntry do PC de origem a partir das linhas da fatura. */
export function basePoEntryFromInvoice(inv: any): number | null {
  const lines: any[] = Array.isArray(inv?.DocumentLines) ? inv.DocumentLines : [];
  const l = lines.find((x) => Number(x?.BaseType) === 22 && Number(x?.BaseEntry) > 0);
  return l ? Number(l.BaseEntry) : null;
}
