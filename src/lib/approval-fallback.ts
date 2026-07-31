/**
 * Fallback hierárquico de roteamento de aprovação.
 *
 * Problema: quando um centro de custo NÃO possui regra na matriz (ex.: CC
 * "1.80.1.3" existe no ERP mas ninguém cadastrou alçada), o documento caía no
 * `get_default_expense_approver` e ia parar na caixa de um admin qualquer, que
 * não é o aprovador daquele CC.
 *
 * Solução: antes de cair no admin padrão, procuramos uma regra "irmã" — do
 * mesmo ramo do CC (1.80.1.x → 1.80.x → 1.x) — cujos demais critérios (faixa de
 * valor, tipo de documento) batam com o documento. O aprovador dessa regra é a
 * alçada natural daquele ramo.
 */

import { evaluateCriteria } from "@/lib/approvalSegments";
import type { ApprovalRule, RuleCriterion } from "@/hooks/useApprovalRules";

/** ["1.80.1.3"] → ["1.80.1", "1.80"] (do mais específico ao mais genérico). */
export function costCenterParents(cc: string): string[] {
  const parts = String(cc || "").trim().split(".").filter(Boolean);
  const out: string[] = [];
  for (let n = parts.length - 1; n >= 2; n--) out.push(parts.slice(0, n).join("."));
  return out;
}

function ccCriteriaValues(criteria: RuleCriterion[]): string[] {
  return criteria
    .filter((c) => c.field === "cost_center")
    .map((c) => String(c.value ?? "").trim())
    .filter(Boolean);
}

export interface HierarchicalFallback {
  rule: ApprovalRule;
  matchedBranch: string;
  siblingCostCenter: string;
}

/**
 * Procura a regra do ramo mais próximo do CC informado. Ignora os critérios de
 * centro de custo (é justamente o que não bate) e exige que os demais critérios
 * — tipicamente faixa de valor — sejam satisfeitos.
 */
export function pickHierarchicalFallbackRule(
  rules: ApprovalRule[],
  ctx: Record<string, unknown>,
  docType: string,
): HierarchicalFallback | null {
  const cc = String(ctx.cost_center ?? "").trim();
  if (!cc) return null;

  const applicable = (rules || []).filter((r) => {
    if (!r.is_active) return false;
    const rdt = (r as { doc_type?: string | null }).doc_type;
    return !rdt || rdt === "both" || rdt === docType;
  });

  for (const branch of costCenterParents(cc)) {
    const candidates = applicable
      .map((r) => {
        const criteria: RuleCriterion[] = Array.isArray(r.criteria) ? (r.criteria as RuleCriterion[]) : [];
        const ccValues = ccCriteriaValues(criteria);
        const sibling = ccValues.find((v) => v === branch || v.startsWith(`${branch}.`));
        if (!sibling) return null;
        const rest = criteria.filter((c) => c.field !== "cost_center");
        // Sem outros critérios → regra genérica demais para o ramo; ainda vale.
        if (rest.length > 0 && !evaluateCriteria(rest, ctx)) return null;
        return { rule: r, matchedBranch: branch, siblingCostCenter: sibling };
      })
      .filter(Boolean) as HierarchicalFallback[];

    if (candidates.length > 0) {
      candidates.sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0));
      return candidates[0];
    }
  }
  return null;
}
