export type DocumentPaymentState = "paid" | "partial" | "open" | "closed";

export interface DocumentPaymentStatus {
  state: DocumentPaymentState;
  label: "Baixado/Pago" | "Pago Parcialmente" | "Em aberto" | "Fechado";
  paidAmount: number;
}

const PAYMENT_TOLERANCE = 0.01;

export function resolveDocumentPaymentStatus(
  totalValue: number | null | undefined,
  paidValue: number | null | undefined,
  rawStatus?: string | null,
): DocumentPaymentStatus {
  const total = Math.max(0, Number(totalValue) || 0);
  const paid = Math.max(0, Number(paidValue) || 0);
  const normalized = String(rawStatus || "").toLowerCase();

  if (total > 0 && paid >= total - PAYMENT_TOLERANCE) {
    return { state: "paid", label: "Baixado/Pago", paidAmount: paid };
  }
  if (paid > PAYMENT_TOLERANCE || normalized.includes("parcial") || normalized.includes("partial")) {
    return { state: "partial", label: "Pago Parcialmente", paidAmount: paid };
  }

  if (
    normalized.includes("liquidado") ||
    normalized.includes("settled") ||
    normalized === "pago" ||
    normalized === "paid"
  ) {
    return { state: "paid", label: "Baixado/Pago", paidAmount: total || paid };
  }
  if (normalized.includes("close") || normalized.includes("fechado")) {
    return { state: "closed", label: "Fechado", paidAmount: paid };
  }
  return { state: "open", label: "Em aberto", paidAmount: paid };
}
