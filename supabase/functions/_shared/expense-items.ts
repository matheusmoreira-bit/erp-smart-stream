export interface NormalizedExpenseItem {
  item_code: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cost_center: string | null;
  project: string | null;
  items_group_code: number | null;
  items_group_name: string | null;
}

export type ExpenseEditMode = "draft" | "pending" | "approved" | "integrated" | "blocked";

export function classifyExpenseEdit(status: string, alreadyInSap: boolean): ExpenseEditMode {
  if (["nf_entrada", "pagamento", "finalizado", "cancelado", "rejeitado"].includes(status)) {
    return "blocked";
  }
  if (status === "rascunho") return "draft";
  if (status === "pendente_aprovacao") return "pending";
  if (status === "aprovado") return alreadyInSap ? "integrated" : "approved";
  if (status === "pc_lancado" && alreadyInSap) return "integrated";
  return "blocked";
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Normaliza e valida as linhas no servidor antes de persistir ou enviar ao ERP. */
export function normalizeExpenseItems(
  input: unknown,
  options: { requireCostCenter?: boolean } = {},
): NormalizedExpenseItem[] {
  const requireCostCenter = options.requireCostCenter !== false;
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("O pedido precisa ter ao menos um item.");
  }

  return input.map((raw, index) => {
    const item = (raw || {}) as Record<string, unknown>;
    const line = index + 1;
    const description = String(item.description || "").trim();
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    const costCenter = String(item.cost_center || "").trim();

    if (!description) throw new Error(`Item ${line}: descrição é obrigatória.`);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Item ${line}: quantidade deve ser maior que zero.`);
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error(`Item ${line}: valor unitário deve ser maior que zero.`);
    }
    if (requireCostCenter && !costCenter) {
      throw new Error(`Item ${line}: centro de custo é obrigatório.`);
    }

    return {
      item_code: String(item.item_code || "").trim() || null,
      description,
      quantity,
      unit_price: unitPrice,
      // Nunca confiamos no total enviado pela tela: ele é derivado dos campos-base.
      line_total: money(quantity * unitPrice),
      cost_center: costCenter || null,
      project: String(item.project || "").trim() || null,
      items_group_code: item.items_group_code == null ? null : Number(item.items_group_code),
      items_group_name: String(item.items_group_name || "").trim() || null,
    };
  });
}
