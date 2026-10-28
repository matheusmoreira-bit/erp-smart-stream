import type { ApprovalHistoryRow } from "@/hooks/useApprovalHistory";
import { exportDocLabel } from "@/lib/doc-number";
export function historyDocumentLabel(row: ApprovalHistoryRow): string {
  if (row.source === "erp_flow") return exportDocLabel(row);
  if (row.po_doc_num) return `Pedido #${row.po_doc_num}`;
  if (row.draft_entry) return `Esboço #${row.draft_entry}`;
  // Legacy audit numbers are provisional, never proof of a final order.
  if (row.source === "audit_log") return "Documento não identificado";
  return row.doc_num ? `Pedido #${row.doc_num}` : "Documento não identificado";
}
export function historyDecisionDate(row: ApprovalHistoryRow): string {
  if (!row.decision_date) return row.decision_precision === "document" ? "Decisão do documento — data não informada" : "—";
  const date = new Date(row.decision_date);
  return row.decision_precision === "document"
    ? `${date.toLocaleDateString("pt-BR", { timeZone: "UTC" })} · decisão do documento`
    : date.toLocaleString("pt-BR");
}