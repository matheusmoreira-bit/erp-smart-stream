/**
 * Detecção de conflitos e sobreposição de regras de aprovação.
 *
 * Reaproveita o motor do "Raio-X da Regra" (`explainApproval`): em vez de
 * avaliar UM documento real contra a matriz, geramos documentos fictícios
 * derivados dos próprios critérios de cada regra e observamos QUANTAS regras
 * ativas disputam o mesmo cenário.
 *
 * Tipos de achado:
 *  - `tie`        → duas regras batem no mesmo cenário COM A MESMA prioridade.
 *                   A ordem de desempate é indeterminada → risco real.
 *  - `overlap`    → ambas batem, prioridades diferentes e cadeias diferentes:
 *                   a de menor prioridade nunca será usada nesse cenário.
 *  - `redundant`  → ambas batem e a cadeia de aprovadores é idêntica:
 *                   duplicidade de manutenção, sem risco de alçada.
 *  - `shadowed`   → a regra bate em cenários, mas perde em TODOS eles
 *                   (inclusive no cenário derivado dela mesma): regra morta.
 *
 * Somente leitura: nada aqui altera regras ou documentos.
 */
import type { ApprovalRule, RuleCriterion } from "@/hooks/useApprovalRules";
import { explainApproval, type ExplainVariables } from "@/lib/approval-rule-explain";

export type ConflictKind = "tie" | "overlap" | "redundant";
export type ConflictSeverity = "critical" | "warning" | "info";

export interface ConflictScenario {
  /** Descrição legível do documento fictício ("CC 1.5.1.3 · R$ 12.000 · Compra"). */
  label: string;
  /** Regra que originou o cenário. */
  originRuleId: string;
  vars: ExplainVariables;
}

export interface RuleConflict {
  id: string;
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** Regra que venceria o cenário (maior prioridade). */
  winner: ApprovalRule;
  /** Regra que também bate no mesmo cenário. */
  loser: ApprovalRule;
  /** Cenários (documentos fictícios) em que ambas competem. */
  scenarios: ConflictScenario[];
  message: string;
}

export interface ShadowedRule {
  rule: ApprovalRule;
  /** Regras que sempre vencem à sua frente. */
  blockedBy: ApprovalRule[];
}

export interface ConflictReport {
  conflicts: RuleConflict[];
  shadowed: ShadowedRule[];
  /** Nº de cenários fictícios avaliados. */
  scenariosEvaluated: number;
  /** Regras ativas para as quais não foi possível gerar cenário (critérios vazios/negativos). */
  unresolvable: ApprovalRule[];
}

/* ───────────────── Geração de cenários fictícios ───────────────── */

const NUMERIC_FIELDS = new Set(["total_amount"]);

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Converte um valor de critério em um texto que satisfaça o operador. */
function sampleText(c: RuleCriterion): string {
  const raw = String(c.value ?? "").trim();
  if (!raw) return "";
  if (c.operator === "like") return raw.replace(/%/g, "0").replace(/_/g, "0") || "0";
  return raw;
}

function baseVars(docType: string): ExplainVariables {
  return {
    costCenters: [],
    projects: [],
    totalAmount: 1000,
    currency: "BRL",
    itemCodes: [],
    itemNames: [],
    supplierName: "",
    supplierCode: "",
    requesterName: "",
    docType,
    rateioType: "padrao",
    rateioByCC: [],
  };
}

function applyCriterion(vars: ExplainVariables, c: RuleCriterion): void {
  const text = sampleText(c);

  if (NUMERIC_FIELDS.has(c.field)) {
    const a = num(c.value);
    const b = num(c.value2);
    switch (c.operator) {
      case "greater_than": vars.totalAmount = a + Math.max(1, Math.round(a * 0.1)); break;
      case "less_than": vars.totalAmount = Math.max(1, a - 1); break;
      case "between": vars.totalAmount = Math.round((a + (b || a)) / 2); break;
      case "equal": vars.totalAmount = a; break;
      default: break; // not_equal / contains em valor: mantém o default
    }
    return;
  }

  // Operadores negativos não definem um valor concreto — deixamos o default.
  if (c.operator === "not_equal" || c.operator === "not_contains") return;
  if (!text) return;

  switch (c.field) {
    case "cost_center": vars.costCenters = [text]; break;
    case "project": vars.projects = [text]; break;
    case "requester_name": vars.requesterName = text; break;
    case "supplier_name":
    case "supplier.name": vars.supplierName = text; break;
    case "supplier.code": vars.supplierCode = text; break;
    case "item_codes":
    case "item.code": vars.itemCodes = [...vars.itemCodes, text]; break;
    case "item.name": vars.itemNames = [...vars.itemNames, text]; break;
    case "item.any": vars.itemCodes = [...vars.itemCodes, text]; break;
    case "currency": vars.currency = text.toUpperCase(); break;
    case "doc_type": vars.docType = text.toLowerCase(); break;
    default: break; // campos sem representação no contexto (ex.: item_groups)
  }
}

/** Agrupa os critérios por `group` mantendo a ordem original. */
function groupsOf(rule: ApprovalRule): RuleCriterion[][] {
  const order: number[] = [];
  const buckets = new Map<number, RuleCriterion[]>();
  for (const c of Array.isArray(rule.criteria) ? rule.criteria : []) {
    const g = typeof c.group === "number" ? c.group : 0;
    if (!buckets.has(g)) { buckets.set(g, []); order.push(g); }
    buckets.get(g)!.push(c);
  }
  return order.map((g) => buckets.get(g)!);
}

const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const DOC_LABEL: Record<string, string> = {
  purchase: "Compra",
  sales: "Venda",
  advance: "Adiantamento",
};

export function describeScenario(v: ExplainVariables): string {
  const parts: string[] = [];
  parts.push(DOC_LABEL[v.docType] || v.docType);
  if (v.costCenters[0]) parts.push(`CC ${v.costCenters[0]}`);
  if (v.projects[0]) parts.push(`Projeto ${v.projects[0]}`);
  if (v.supplierName) parts.push(`Fornecedor ${v.supplierName}`);
  if (v.supplierCode) parts.push(`Cód. fornecedor ${v.supplierCode}`);
  if (v.itemCodes[0]) parts.push(`Item ${v.itemCodes[0]}`);
  if (v.itemNames[0]) parts.push(`Descrição "${v.itemNames[0]}"`);
  if (v.requesterName) parts.push(`Solicitante ${v.requesterName}`);
  if (v.currency && v.currency !== "BRL") parts.push(v.currency);
  parts.push(money(v.totalAmount));
  return parts.join(" · ");
}

/**
 * Gera cenários fictícios a partir de uma regra: um por grupo de critérios
 * (grupos ligados por "OU" representam cenários distintos) e um combinando
 * todos os grupos (para grupos ligados por "E").
 */
export function scenariosFromRule(rule: ApprovalRule): ExplainVariables[] {
  const docTypes = !rule.doc_type || rule.doc_type === "both" ? ["purchase", "sales"] : [rule.doc_type];
  const groups = groupsOf(rule);
  if (groups.length === 0) return [];

  const out: ExplainVariables[] = [];
  for (const dt of docTypes) {
    // Cenário combinando todos os grupos
    const all = baseVars(dt);
    for (const g of groups) for (const c of g) applyCriterion(all, c);
    out.push(all);

    // Um cenário por grupo (cobre grupos alternativos "OU")
    if (groups.length > 1) {
      for (const g of groups) {
        const v = baseVars(dt);
        for (const c of g) applyCriterion(v, c);
        out.push(v);
      }
    }
  }
  return out;
}

/* ───────────────── Detecção ───────────────── */

function chainSignature(rule: ApprovalRule): string {
  return (rule.levels || [])
    .slice()
    .sort((a, b) => a.level_order - b.level_order || (a.approver_email || a.approver_name || "").localeCompare(b.approver_email || b.approver_name || ""))
    .map((l) => `${l.level_order}:${(l.approver_email || l.approver_name || "").trim().toLowerCase()}`)
    .join(" > ");
}

function scenarioKey(v: ExplainVariables): string {
  return JSON.stringify([
    v.docType, v.costCenters, v.projects, v.totalAmount, v.currency,
    v.itemCodes, v.itemNames, v.supplierName, v.supplierCode, v.requesterName,
  ]);
}

/**
 * Analisa a matriz (opcionalmente com uma regra em rascunho mesclada) e
 * devolve os conflitos entre regras ativas.
 *
 * @param rules      matriz publicada
 * @param draftRule  regra em edição ainda não salva (opcional)
 */
export function detectRuleConflicts(
  rules: ApprovalRule[],
  draftRule?: ApprovalRule | null,
): ConflictReport {
  const merged = (() => {
    const list = Array.isArray(rules) ? [...rules] : [];
    if (!draftRule) return list;
    const idx = list.findIndex((r) => r.id === draftRule.id);
    if (idx >= 0) list[idx] = draftRule;
    else list.push(draftRule);
    return list;
  })();

  const active = merged.filter((r) => r.is_active);
  const unresolvable: ApprovalRule[] = [];

  // 1) Monta o conjunto de cenários fictícios (deduplicados).
  const scenarios = new Map<string, ConflictScenario>();
  for (const rule of active) {
    const vs = scenariosFromRule(rule);
    if (vs.length === 0) { unresolvable.push(rule); continue; }
    for (const v of vs) {
      const key = scenarioKey(v);
      if (!scenarios.has(key)) {
        scenarios.set(key, { label: describeScenario(v), originRuleId: rule.id, vars: v });
      }
    }
  }

  // 2) Avalia cada cenário contra a matriz e registra as disputas.
  const pairs = new Map<string, RuleConflict>();
  const matchedSomewhere = new Set<string>();
  const wonSomewhere = new Set<string>();
  const blockers = new Map<string, Map<string, ApprovalRule>>();

  for (const scenario of scenarios.values()) {
    const res = explainApproval(merged, scenario.vars, null);
    const winners = res.evaluated.filter((t) => t.matched).map((t) => t.rule);
    if (winners.length === 0) continue;

    winners.forEach((r) => matchedSomewhere.add(r.id));
    wonSomewhere.add(winners[0].id);

    for (let i = 1; i < winners.length; i++) {
      const winner = winners[0];
      const loser = winners[i];
      if (winner.id === loser.id) continue;

      if (!blockers.has(loser.id)) blockers.set(loser.id, new Map());
      blockers.get(loser.id)!.set(winner.id, winner);

      const samePriority = (winner.priority || 0) === (loser.priority || 0);
      const sameChain = chainSignature(winner) === chainSignature(loser);
      const kind: ConflictKind = samePriority ? "tie" : sameChain ? "redundant" : "overlap";
      const severity: ConflictSeverity =
        kind === "tie" ? (sameChain ? "warning" : "critical") : kind === "overlap" ? "warning" : "info";

      const id = `${winner.id}|${loser.id}`;
      const existing = pairs.get(id);
      if (existing) {
        if (existing.scenarios.length < 5) existing.scenarios.push(scenario);
        continue;
      }

      const message =
        kind === "tie"
          ? sameChain
            ? `"${winner.name}" e "${loser.name}" têm a mesma prioridade (${winner.priority}) e a mesma cadeia de aprovadores. Uma delas é redundante.`
            : `"${winner.name}" e "${loser.name}" têm a MESMA prioridade (${winner.priority}) e disputam o mesmo cenário com cadeias diferentes. O desempate é indeterminado — ajuste a prioridade ou restrinja os critérios.`
          : kind === "overlap"
            ? `"${winner.name}" (prioridade ${winner.priority}) sempre vence "${loser.name}" (prioridade ${loser.priority}) neste cenário, e as cadeias de aprovação são diferentes.`
            : `"${winner.name}" e "${loser.name}" cobrem o mesmo cenário com a mesma cadeia de aprovadores — duplicidade de manutenção.`;

      pairs.set(id, {
        id,
        kind,
        severity,
        winner,
        loser,
        scenarios: [scenario],
        message,
      });
    }
  }

  // 3) Regras que batem em algum cenário mas nunca vencem = sombreadas.
  const shadowed: ShadowedRule[] = [];
  for (const rule of active) {
    if (!matchedSomewhere.has(rule.id) || wonSomewhere.has(rule.id)) continue;
    shadowed.push({ rule, blockedBy: Array.from(blockers.get(rule.id)?.values() || []) });
  }

  const severityRank: Record<ConflictSeverity, number> = { critical: 0, warning: 1, info: 2 };
  const conflicts = Array.from(pairs.values()).sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.winner.name.localeCompare(b.winner.name),
  );

  return { conflicts, shadowed, scenariosEvaluated: scenarios.size, unresolvable };
}

export const CONFLICT_KIND_LABELS: Record<ConflictKind, string> = {
  tie: "Empate de prioridade",
  overlap: "Sobreposição",
  redundant: "Redundância",
};
