export interface OmiePurchaseOrderExpense {
  id: string;
  supplier_code?: string | null;
  due_date?: string | null;
  cost_center?: string | null;
  remarks?: string | null;
}

export interface OmiePurchaseOrderItem {
  item_code?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  cost_center?: string | null;
}

export interface OmiePurchaseOrderPayload {
  cabecalho_incluir: {
    cCodIntPed: string;
    dDtPrevisao: string;
    nCodFor: number;
    cCodCateg: string;
    cObs: string;
    cObsInt: string;
  };
  produtos_incluir: Array<{
    cCodIntItem: string;
    nCodProd: number;
    nQtde: number;
    nValUnit: number;
    cCodCateg: string;
    cObs: string;
  }>;
}

function positiveNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} deve ser maior que zero.`);
  return number;
}

function omieInternalId(value: unknown, label: string, allowProductPrefix = false): number {
  const raw = String(value ?? "").trim();
  const match = raw.match(allowProductPrefix ? /^(?:P:)?(\d+)$/i : /^(\d+)$/);
  if (!match) {
    if (/^S:/i.test(raw)) {
      throw new Error(`${label}: serviços não podem ser enviados como produto em um Pedido de Compra Omie.`);
    }
    throw new Error(`${label}: código Omie inválido (${raw || "não informado"}).`);
  }
  return positiveNumber(match[1], label);
}

function toOmieDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  throw new Error("Data de vencimento inválida para o Pedido de Compra Omie.");
}

export function buildOmiePurchaseOrderPayload(
  expense: OmiePurchaseOrderExpense,
  items: OmiePurchaseOrderItem[],
): OmiePurchaseOrderPayload {
  const supplierId = omieInternalId(expense.supplier_code, "Fornecedor");
  const category = String(expense.cost_center || items[0]?.cost_center || "").trim();
  if (!category) throw new Error("Categoria Omie é obrigatória para criar o Pedido de Compra.");
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("O Pedido de Compra Omie precisa ter ao menos um produto.");
  }

  const integrationCode = `ERPFLOW-${String(expense.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
  const observation = String(expense.remarks || "Pedido gerado via ERP Flow").trim();

  return {
    cabecalho_incluir: {
      cCodIntPed: integrationCode,
      dDtPrevisao: toOmieDate(expense.due_date),
      nCodFor: supplierId,
      cCodCateg: category,
      cObs: observation,
      cObsInt: `ERP Flow ${expense.id}`,
    },
    produtos_incluir: items.map((item, index) => ({
      cCodIntItem: `${integrationCode.slice(0, 16)}${String(index + 1).padStart(3, "0")}`,
      nCodProd: omieInternalId(item.item_code, `Item ${index + 1}`, true),
      nQtde: positiveNumber(item.quantity, `Quantidade do item ${index + 1}`),
      nValUnit: positiveNumber(item.unit_price, `Valor unitário do item ${index + 1}`),
      cCodCateg: String(item.cost_center || category).trim(),
      cObs: String(item.description || "").trim(),
    })),
  };
}
