export interface OmieSalesOrderExpense {
  id: string;
  supplier_code?: string | null;
  due_date?: string | null;
  cost_center?: string | null;
  remarks?: string | null;
}

export interface OmieSalesOrderItem {
  item_code?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  cost_center?: string | null;
}

export interface OmieSalesOrderPayload {
  cabecalho: {
    codigo_cliente: number;
    codigo_pedido_integracao: string;
    data_previsao: string;
    etapa: string;
    codigo_parcela: "999";
    qtde_parcelas: 1;
    origem_pedido: "API";
  };
  det: Array<{
    ide: { codigo_item_integracao: string };
    produto: {
      codigo_produto: number;
      descricao: string;
      quantidade: number;
      valor_unitario: number;
      tipo_desconto: "V";
      valor_desconto: 0;
    };
    inf_adic: { codigo_categoria_item: string };
    observacao?: { obs_item: string };
  }>;
  frete: { modalidade: "9" };
  informacoes_adicionais: {
    codigo_categoria: string;
    codigo_conta_corrente: number;
    consumidor_final: "N";
    enviar_email: "N";
  };
  lista_parcelas: {
    parcela: Array<{
      data_vencimento: string;
      numero_parcela: 1;
      percentual: 100;
      valor: number;
    }>;
  };
  observacoes: { obs_venda: string };
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
      throw new Error(`${label}: serviços devem ser integrados como Ordem de Serviço, não como Pedido de Venda.`);
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
  throw new Error("Data de vencimento inválida para o Pedido de Venda Omie.");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildOmieSalesOrderPayload(
  expense: OmieSalesOrderExpense,
  items: OmieSalesOrderItem[],
  currentAccountCode: unknown,
  stageCode = "10",
): OmieSalesOrderPayload {
  const customerId = omieInternalId(expense.supplier_code, "Cliente");
  const accountId = positiveNumber(currentAccountCode, "Conta corrente Omie");
  const category = String(expense.cost_center || items[0]?.cost_center || "").trim();
  if (!category) throw new Error("Categoria Omie de receita é obrigatória para criar o Pedido de Venda.");
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("O Pedido de Venda Omie precisa ter ao menos um produto.");
  }
  if (!/^\d{2}$/.test(stageCode)) throw new Error(`Etapa Omie inválida (${stageCode}).`);

  const integrationCode = `ERPFLOW-SALE-${String(expense.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 32)}`;
  const dueDate = toOmieDate(expense.due_date);
  const observation = String(expense.remarks || `Pedido gerado via ERP Flow (${expense.id})`).trim();
  const total = roundMoney(items.reduce(
    (sum, item, index) => sum +
      positiveNumber(item.quantity, `Quantidade do item ${index + 1}`) *
      positiveNumber(item.unit_price, `Valor unitário do item ${index + 1}`),
    0,
  ));

  return {
    cabecalho: {
      codigo_cliente: customerId,
      codigo_pedido_integracao: integrationCode,
      data_previsao: dueDate,
      etapa: stageCode,
      codigo_parcela: "999",
      qtde_parcelas: 1,
      origem_pedido: "API",
    },
    det: items.map((item, index) => {
      const description = String(item.description || "").trim();
      return {
        ide: { codigo_item_integracao: `${integrationCode.slice(0, 26)}${String(index + 1).padStart(3, "0")}` },
        produto: {
          codigo_produto: omieInternalId(item.item_code, `Item ${index + 1}`, true),
          descricao: description,
          quantidade: positiveNumber(item.quantity, `Quantidade do item ${index + 1}`),
          valor_unitario: positiveNumber(item.unit_price, `Valor unitário do item ${index + 1}`),
          tipo_desconto: "V",
          valor_desconto: 0,
        },
        inf_adic: { codigo_categoria_item: String(item.cost_center || category).trim() },
        ...(description ? { observacao: { obs_item: description } } : {}),
      };
    }),
    frete: { modalidade: "9" },
    informacoes_adicionais: {
      codigo_categoria: category,
      codigo_conta_corrente: accountId,
      consumidor_final: "N",
      enviar_email: "N",
    },
    lista_parcelas: {
      parcela: [{
        data_vencimento: dueDate,
        numero_parcela: 1,
        percentual: 100,
        valor: total,
      }],
    },
    observacoes: { obs_venda: observation },
  };
}
