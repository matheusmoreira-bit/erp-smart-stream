import type { Expense } from "@/hooks/useExpenses";

/**
 * Monta o payload de esboço (mesmo formato usado por `document_drafts`)
 * a partir de um lançamento já existente, para permitir "duplicar pedido".
 *
 * Campos que NÃO devem ser copiados: anexos, número/ID do ERP, status,
 * aprovadores e datas do documento original (a data do documento passa a ser
 * a data de hoje e o vencimento é deixado em branco para revisão).
 */
export function buildDuplicateDraftPayload(exp: Expense) {
  const today = new Date().toISOString().slice(0, 10);
  const asOption = (code?: string | null) =>
    code && code.trim() ? { code: code.trim(), name: code.trim() } : null;

  return {
    supplier: exp.supplier_code
      ? { code: exp.supplier_code, name: exp.supplier_name || exp.supplier_code }
      : null,
    currency: /^[A-Z]{3}$/.test(exp.currency || "") ? exp.currency : "",
    docDate: today,
    dueDate: "",
    remarks: exp.remarks || "",
    headerCostCenter: asOption(exp.cost_center),
    headerProject: asOption(exp.project),
    items: (exp.items || []).map((it) => ({
      description: it.description || "",
      quantity: Number(it.quantity) || 1,
      unit_price: Number(it.unit_price) || 0,
      line_total: Number(it.line_total) || 0,
      cost_center: it.cost_center || "",
      project: it.project || "",
      item_code: it.item_code || undefined,
      sapItem: it.item_code
        ? { code: it.item_code, name: it.description || it.item_code }
        : null,
      sapCostCenter: asOption(it.cost_center),
      sapProject: asOption(it.project),
    })),
    fileNames: [],
  };
}
