export type ExpenseLifecycleStatus =
  | "rascunho"
  | "pendente_aprovacao"
  | "aprovado"
  | "rejeitado"
  | "cancelado"
  | "pc_lancado"
  | "nf_entrada"
  | "pagamento"
  | "finalizado";

export interface SapInvoiceLifecycle {
  docTotal: number | null;
  paidToDate: number | null;
  cancelled: string | null;
}

interface DeriveExpenseLifecycleStatusInput {
  currentStatus: string;
  expenseTotal: number | null;
  poDocumentStatus: string | null;
  poCancelled: string | null;
  invoices: SapInvoiceLifecycle[];
}

const MANAGED_STATUSES = new Set([
  "aprovado",
  "pc_lancado",
  "nf_entrada",
  "pagamento",
  "finalizado",
]);

const MONEY_TOLERANCE = 0.01;

/** Deriva o status da despesa pela etapa mais recente conhecida no SAP. */
export function deriveExpenseLifecycleStatus({
  currentStatus,
  expenseTotal,
  poDocumentStatus,
  poCancelled,
  invoices,
}: DeriveExpenseLifecycleStatusInput): ExpenseLifecycleStatus | string {
  if (!MANAGED_STATUSES.has(currentStatus)) return currentStatus;
  if (poCancelled === "tYES") return "cancelado";

  const activeInvoices = invoices.filter((invoice) => invoice.cancelled !== "tYES");
  if (activeInvoices.length > 0) {
    const invoicedTotal = activeInvoices.reduce(
      (sum, invoice) => sum + Math.max(0, Number(invoice.docTotal) || 0),
      0,
    );
    const paidTotal = activeInvoices.reduce((sum, invoice) => {
      const invoiceTotal = Math.max(0, Number(invoice.docTotal) || 0);
      const paid = Math.max(0, Number(invoice.paidToDate) || 0);
      return sum + Math.min(paid, invoiceTotal);
    }, 0);
    const targetTotal = Math.max(0, Number(expenseTotal) || 0);
    const fullyInvoiced = poDocumentStatus === "bost_Close"
      || targetTotal <= MONEY_TOLERANCE
      || invoicedTotal >= targetTotal - MONEY_TOLERANCE;
    const fullyPaid = invoicedTotal > MONEY_TOLERANCE
      && paidTotal >= invoicedTotal - MONEY_TOLERANCE;

    if (fullyInvoiced && fullyPaid) return "finalizado";
    if (paidTotal > MONEY_TOLERANCE) return "pagamento";
    return "nf_entrada";
  }

  // O cache conhece a NF, mas ela foi cancelada: o pedido volta a ser a etapa atual.
  if (invoices.length > 0) return "pc_lancado";

  // Sem cache de NF, preserva estados mais avançados para não regredir durante
  // uma janela de sincronização. Mantém também a compatibilidade com PO fechado.
  if (
    poDocumentStatus === "bost_Close"
    && (currentStatus === "aprovado" || currentStatus === "pc_lancado")
  ) {
    return "nf_entrada";
  }
  return currentStatus;
}
