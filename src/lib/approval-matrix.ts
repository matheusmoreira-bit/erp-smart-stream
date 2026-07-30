import {
  OPERATOR_LABELS,
  FIELD_OPTIONS,
  type ApprovalRule,
  type RuleCriterion,
} from "@/hooks/useApprovalRules";

/** Categorias de negócio usadas na visão executiva da matriz de alçadas. */
export type MatrixCategory =
  | "impostos"
  | "folha"
  | "reembolso"
  | "cost_center"
  | "project"
  | "supplier"
  | "value"
  | "general";

export const CATEGORY_LABELS: Record<MatrixCategory, string> = {
  impostos: "Impostos",
  folha: "Folha de Pagamento",
  reembolso: "Reembolsos",
  cost_center: "Centro de Custo",
  project: "Projeto",
  supplier: "Fornecedor",
  value: "Faixa de Valor",
  general: "Regra Geral",
};

/** Ordem de exibição das categorias no relatório. */
export const CATEGORY_ORDER: MatrixCategory[] = [
  "general",
  "value",
  "cost_center",
  "project",
  "impostos",
  "folha",
  "reembolso",
  "supplier",
];

export type MatrixFlow = "purchase" | "sales" | "advance" | "both";

export const FLOW_LABELS: Record<MatrixFlow, string> = {
  purchase: "Compras",
  sales: "Vendas",
  advance: "Adiantamentos",
  both: "Compras e Vendas",
};

const fieldLabel = (field: string) =>
  FIELD_OPTIONS.find((f) => f.value === field)?.label || field;

const currency = (raw: string) => {
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
};

/** Remove os curingas de um valor LIKE para leitura humana. */
const clean = (v: string) => String(v ?? "").replace(/%/g, "").trim();

/** Frase curta e legível para um critério (usada nos chips do relatório). */
export function describeCriterion(c: RuleCriterion): string {
  const isMoney = c.field === "total_amount";
  const label = fieldLabel(c.field);
  const v = isMoney ? currency(c.value) : clean(c.value) || "(vazio)";
  switch (c.operator) {
    case "greater_than":
      return `${label} acima de ${v}`;
    case "less_than":
      return `${label} até ${isMoney ? currency(c.value) : v}`;
    case "between":
      return `${label} entre ${isMoney ? currency(c.value) : clean(c.value)} e ${
        isMoney ? currency(c.value2 || "") : clean(c.value2 || "")
      }`;
    case "equal":
      return `${label} = ${v}`;
    case "not_equal":
      return `${label} ≠ ${v}`;
    case "contains":
      return `${label} contém "${v}"`;
    case "not_contains":
      return `${label} não contém "${v}"`;
    case "like":
      return `${label} começa com "${v}"`;
    default:
      return `${label} ${OPERATOR_LABELS[c.operator] ?? ""} ${v}`.trim();
  }
}

/** Classifica a regra em uma categoria de negócio a partir do nome e dos critérios. */
export function classifyRule(rule: ApprovalRule): MatrixCategory {
  const name = (rule.name || "").toLowerCase();
  const criteria = rule.criteria || [];
  const itemValues = criteria
    .filter((c) => c.field.startsWith("item"))
    .map((c) => clean(c.value).toLowerCase());
  const hasItem = (prefix: string) => itemValues.some((v) => v.startsWith(prefix));

  if (name.includes("imposto") || hasItem("imp") || criteria.some((c) => c.field === "item_groups" && clean(c.value).toLowerCase().includes("imposto")))
    return "impostos";
  if (name.includes("folha") || hasItem("fol")) return "folha";
  if (name.includes("reembolso") || hasItem("out00007")) return "reembolso";
  if (criteria.some((c) => c.field === "cost_center")) return "cost_center";
  if (criteria.some((c) => c.field === "project")) return "project";
  if (criteria.some((c) => c.field.startsWith("supplier"))) return "supplier";
  if (criteria.length > 0 && criteria.every((c) => c.field === "total_amount")) return "value";
  if (criteria.length === 0) return "general";
  return "general";
}

export interface MatrixLevel {
  order: number;
  /** Aprovadores em paralelo do mesmo nível (o primeiro que decidir encerra). */
  approvers: { name: string; email: string | null }[];
}

export interface MatrixRow {
  id: string;
  name: string;
  flow: MatrixFlow;
  category: MatrixCategory;
  priority: number;
  isActive: boolean;
  /** Faixa de valor extraída dos critérios (quando existir). */
  amountFrom: number | null;
  amountTo: number | null;
  conditions: string[];
  levels: MatrixLevel[];
  /** Centros de custo citados nos critérios (para filtros e agrupamento). */
  costCenters: string[];
}

const parseAmount = (raw: string | undefined) => {
  if (!raw) return null;
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Converte a regra crua em uma linha pronta para a visão executiva. */
export function toMatrixRow(rule: ApprovalRule): MatrixRow {
  const criteria = rule.criteria || [];
  let amountFrom: number | null = null;
  let amountTo: number | null = null;
  for (const c of criteria) {
    if (c.field !== "total_amount") continue;
    if (c.operator === "greater_than") amountFrom = parseAmount(c.value);
    if (c.operator === "less_than") amountTo = parseAmount(c.value);
    if (c.operator === "between") {
      amountFrom = parseAmount(c.value);
      amountTo = parseAmount(c.value2);
    }
  }

  const byOrder = new Map<number, MatrixLevel>();
  for (const lvl of [...(rule.levels || [])].sort((a, b) => a.level_order - b.level_order)) {
    const entry = byOrder.get(lvl.level_order) || { order: lvl.level_order, approvers: [] };
    entry.approvers.push({ name: lvl.approver_name, email: lvl.approver_email || null });
    byOrder.set(lvl.level_order, entry);
  }

  return {
    id: rule.id,
    name: rule.name,
    flow: (rule.doc_type as MatrixFlow) || "both",
    category: classifyRule(rule),
    priority: rule.priority ?? 0,
    isActive: !!rule.is_active,
    amountFrom,
    amountTo,
    conditions: criteria.map(describeCriterion),
    levels: [...byOrder.values()].sort((a, b) => a.order - b.order),
    costCenters: criteria
      .filter((c) => c.field === "cost_center")
      .map((c) => clean(c.value))
      .filter(Boolean),
  };
}

/** Texto curto da faixa de valor de uma regra. */
export function amountRangeLabel(row: MatrixRow): string {
  const fmt = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  if (row.amountFrom !== null && row.amountTo !== null) return `${fmt(row.amountFrom)} — ${fmt(row.amountTo)}`;
  if (row.amountFrom !== null) return `Acima de ${fmt(row.amountFrom)}`;
  if (row.amountTo !== null) return `Até ${fmt(row.amountTo)}`;
  return "Qualquer valor";
}

/** Gera o CSV da matriz (uma linha por regra). */
export function matrixToCsv(rows: MatrixRow[]): string {
  const head = [
    "Fluxo",
    "Categoria",
    "Regra",
    "Prioridade",
    "Faixa de valor",
    "Condições",
    "Alçadas",
  ];
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      FLOW_LABELS[r.flow],
      CATEGORY_LABELS[r.category],
      r.name,
      String(r.priority),
      amountRangeLabel(r),
      r.conditions.join(" • ") || "Sem condições (regra padrão)",
      r.levels
        .map((l) => `Nível ${l.order}: ${l.approvers.map((a) => a.name).join(" ou ")}`)
        .join(" → "),
    ]
      .map(esc)
      .join(";"),
  );
  return [head.map(esc).join(";"), ...lines].join("\n");
}
