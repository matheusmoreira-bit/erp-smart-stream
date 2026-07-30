/**
 * Motor de explicação da regra de aprovação ("Raio-X da Regra").
 *
 * Reproduz — de forma auditável e passo a passo — a mesma avaliação usada na
 * criação do documento (`findMatchingRule` em `useExpenses.ts`), para que o
 * aprovador entenda POR QUE aquela regra foi aplicada, quais variáveis do
 * documento entraram na conta e quais critérios passaram/falharam.
 *
 * Somente leitura/apresentação: não altera nenhuma decisão de negócio.
 */
import type { ApprovalRule, RuleCriterion } from "@/hooks/useApprovalRules";
import { OPERATOR_LABELS, FIELD_OPTIONS } from "@/hooks/useApprovalRules";

/* ───────────────── Variáveis do documento ───────────────── */

export interface ExplainVariables {
  /** Centros de custo presentes nas linhas (candidatos avaliados um a um). */
  costCenters: string[];
  projects: string[];
  totalAmount: number;
  currency: string;
  itemCodes: string[];
  itemNames: string[];
  supplierName: string;
  supplierCode: string;
  requesterName: string;
  /** "purchase" | "sales" | "advance" */
  docType: string;
  /** Tipo de rateio do documento ("padrao" = sem rateio especial). */
  rateioType: string;
  /** Rateio efetivo por centro de custo (valor e %). */
  rateioByCC: Array<{ code: string; amount: number; pct: number }>;
}

export const RATEIO_TYPE_LABELS: Record<string, string> = {
  padrao: "Padrão (sem rateio especial)",
  imposto: "Imposto",
  folha: "Folha de pagamento",
  rateio: "Rateio entre centros de custo",
  proporcional: "Rateio proporcional",
};

export function rateioLabel(type?: string | null): string {
  const t = (type || "padrao").toLowerCase();
  return RATEIO_TYPE_LABELS[t] || type || "Padrão";
}

export function fieldLabel(field: string): string {
  return FIELD_OPTIONS.find((f) => f.value === field)?.label || field;
}

export function operatorLabel(op: string): string {
  return (OPERATOR_LABELS as Record<string, string>)[op] || op;
}

/** Monta o contexto avaliado pela matriz para um centro de custo candidato. */
export function buildRuleContext(v: ExplainVariables, cc: string): Record<string, unknown> {
  return {
    total_amount: v.totalAmount,
    cost_center: cc,
    project: v.projects[0] || "",
    requester_name: v.requesterName,
    supplier_name: `${v.supplierName || ""} ${v.supplierCode || ""}`.trim(),
    "supplier.name": (v.supplierName || "").toLowerCase(),
    "supplier.code": (v.supplierCode || "").toLowerCase(),
    currency: v.currency || "BRL",
    doc_type: v.docType,
    item_codes: v.itemCodes.join(" "),
    "item.code": v.itemCodes.join(" ").toLowerCase(),
    "item.name": v.itemNames.join(" ").toLowerCase(),
    "item.any": [...v.itemCodes, ...v.itemNames].join(" ").toLowerCase(),
  };
}

/* ───────────────── Avaliação (espelha useExpenses) ───────────────── */

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function evaluateCriterion(c: RuleCriterion, ctx: Record<string, unknown>): boolean {
  const raw = ctx[c.field];
  if (raw === undefined || raw === null) return false;
  const val = String(raw).toLowerCase();
  const target = String(c.value ?? "").toLowerCase();
  const tokens = val.split(/\s+/).filter(Boolean);
  const matchesExact = val === target || tokens.includes(target);

  switch (c.operator) {
    case "greater_than": return Number(raw) > Number(c.value);
    case "less_than": return Number(raw) < Number(c.value);
    case "between": return Number(raw) >= Number(c.value) && Number(raw) <= Number(c.value2 ?? c.value);
    case "equal": return matchesExact;
    case "not_equal": return !matchesExact;
    case "contains": return val.includes(target);
    case "not_contains": return !val.includes(target);
    case "like": {
      const pattern = target.split("").map((ch) => (ch === "%" ? ".*" : ch === "_" ? "." : escapeRegex(ch))).join("");
      const re = new RegExp(`^${pattern}$`);
      return re.test(val) || tokens.some((t) => re.test(t));
    }
    default: return false;
  }
}

export interface CriterionTrace {
  criterion: RuleCriterion;
  group: number;
  /** Valor do documento comparado (já como texto legível). */
  actual: string;
  passed: boolean;
}

export interface GroupTrace {
  group: number;
  passed: boolean;
  /** Conector com o grupo anterior ("and"/"or"); undefined no primeiro grupo. */
  groupLogic?: "and" | "or";
  criteria: CriterionTrace[];
}

export interface RuleTrace {
  rule: ApprovalRule;
  matched: boolean;
  /** Centro de custo que fez a regra bater (ou o primeiro avaliado). */
  costCenterUsed: string;
  groups: GroupTrace[];
}

function traceRuleForCc(rule: ApprovalRule, ctx: Record<string, unknown>, cc: string): RuleTrace {
  const criteria = Array.isArray(rule.criteria) ? rule.criteria : [];
  const order: number[] = [];
  const buckets = new Map<number, RuleCriterion[]>();
  for (const c of criteria) {
    const g = typeof c.group === "number" ? c.group : 0;
    if (!buckets.has(g)) { buckets.set(g, []); order.push(g); }
    buckets.get(g)!.push(c);
  }

  const groups: GroupTrace[] = [];
  let overall = criteria.length > 0 ? false : false;
  let idx = 0;

  for (const g of order) {
    const bucket = buckets.get(g)!;
    const traces: CriterionTrace[] = bucket.map((c) => ({
      criterion: c,
      group: g,
      actual: formatActual(ctx[c.field]),
      passed: evaluateCriterion(c, ctx),
    }));
    let acc = traces[0]?.passed ?? false;
    for (let i = 1; i < bucket.length; i++) {
      const logic = bucket[i].logic === "or" ? "or" : "and";
      acc = logic === "or" ? acc || traces[i].passed : acc && traces[i].passed;
    }
    const gLogic: "and" | "or" | undefined = idx === 0 ? undefined : (bucket[0].groupLogic === "or" ? "or" : "and");
    groups.push({ group: g, passed: acc, groupLogic: gLogic, criteria: traces });
    if (idx === 0) overall = acc;
    else overall = gLogic === "and" ? overall && acc : overall || acc;
    idx++;
  }

  return { rule, matched: criteria.length > 0 && overall, costCenterUsed: cc, groups };
}

function formatActual(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "number") return String(v);
  return String(v);
}

export interface ExplainResult {
  /** Regras avaliadas em ordem de prioridade (desc), com o traço de cada uma. */
  evaluated: RuleTrace[];
  /** Primeira regra que bateu na simulação. */
  simulatedMatch: RuleTrace | null;
  /** Regra efetivamente gravada no documento (pode divergir da simulação). */
  appliedRule: ApprovalRule | null;
  appliedTrace: RuleTrace | null;
  /** true quando a regra gravada difere da que a simulação encontraria hoje. */
  divergent: boolean;
}

/**
 * Avalia a matriz da empresa contra as variáveis do documento.
 *
 * @param rules  regras da empresa (todas; filtramos ativas/doc_type aqui)
 * @param appliedRuleId regra gravada no documento (se houver)
 */
export function explainApproval(
  rules: ApprovalRule[],
  vars: ExplainVariables,
  appliedRuleId: string | null,
): ExplainResult {
  const candidates = (rules || [])
    .filter((r) => r.is_active)
    .filter((r) => !r.doc_type || r.doc_type === "both" || r.doc_type === vars.docType)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const ccs = vars.costCenters.length > 0 ? vars.costCenters : [""];

  const evaluated: RuleTrace[] = [];
  let simulatedMatch: RuleTrace | null = null;

  for (const rule of candidates) {
    let best: RuleTrace | null = null;
    for (const cc of ccs) {
      const t = traceRuleForCc(rule, buildRuleContext(vars, cc), cc);
      if (!best || (t.matched && !best.matched)) best = t;
      if (t.matched) break;
    }
    if (best) {
      evaluated.push(best);
      if (best.matched && !simulatedMatch) simulatedMatch = best;
    }
  }

  const appliedRule = appliedRuleId ? (rules || []).find((r) => r.id === appliedRuleId) || null : null;
  let appliedTrace: RuleTrace | null =
    appliedRule ? evaluated.find((t) => t.rule.id === appliedRule.id) || null : null;
  if (appliedRule && !appliedTrace) {
    // Regra inativa ou de outro doc_type: ainda assim mostramos o traço.
    let best: RuleTrace | null = null;
    for (const cc of ccs) {
      const t = traceRuleForCc(appliedRule, buildRuleContext(vars, cc), cc);
      if (!best || (t.matched && !best.matched)) best = t;
      if (t.matched) break;
    }
    appliedTrace = best;
  }

  const divergent = !!(
    appliedRule && simulatedMatch && simulatedMatch.rule.id !== appliedRule.id
  );

  return { evaluated, simulatedMatch, appliedRule, appliedTrace, divergent };
}

/** Texto curto, em português, explicando a decisão. */
export function summarizeExplanation(
  res: ExplainResult,
  vars: ExplainVariables,
  currentLevel: number | null,
  currentApprover: string,
): string {
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: vars.currency || "BRL" })
    .format(vars.totalAmount || 0);
  const cc = res.appliedTrace?.costCenterUsed || vars.costCenters[0] || "sem centro de custo";
  const proj = vars.projects[0] || "sem projeto";

  if (!res.appliedRule) {
    return (
      `Nenhuma regra da matriz foi gravada neste documento. Com CC ${cc}, projeto ${proj} e valor ${money}, ` +
      (res.simulatedMatch
        ? `a matriz atual apontaria a regra "${res.simulatedMatch.rule.name}". `
        : `nenhuma regra ativa da empresa atende a essa combinação. `) +
      `Por segurança o documento seguiu para aprovação administrativa (${currentApprover || "Administrador"}).`
    );
  }

  const lvlCount = res.appliedRule.levels?.length || 0;
  const base =
    `A regra "${res.appliedRule.name}" (prioridade ${res.appliedRule.priority}) foi aplicada porque o documento ` +
    `— CC ${cc}, projeto ${proj}, valor ${money}, ${vars.itemCodes.length} item(ns), rateio ${rateioLabel(vars.rateioType)} — ` +
    `atende aos critérios abaixo. Ela define ${lvlCount} nível(is) de aprovação` +
    (currentLevel ? `, e o documento está no nível ${currentLevel} com ${currentApprover || "—"}.` : `.`);

  if (res.divergent) {
    return (
      base +
      ` Atenção: a matriz vigente hoje apontaria "${res.simulatedMatch?.rule.name}" — a regra do documento foi ` +
      `definida no momento da criação e não é alterada retroativamente.`
    );
  }
  return base;
}
