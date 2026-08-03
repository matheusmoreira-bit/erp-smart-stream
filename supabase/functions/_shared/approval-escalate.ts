// Escalonamento de auto-aprovação.
//
// Quando TODOS os aprovadores da regra aplicável são o próprio solicitante,
// o documento não deve cair direto no validador global. Antes disso, subimos
// para a FAIXA DE VALOR SUPERIOR da mesma alçada (mesmo CC/projeto), que é o
// superior hierárquico natural na matriz.
//
// Ex.: CC 1.10.4.1 / DONALD / R$ 5.831 → regra "0-10k" = Leonardo Rossini
//      (solicitante) → escala para "10k-300k" = Santiago Macedo.
//
// Só quando não existe faixa superior (nem aprovador diferente nela) é que
// caímos no fallback global (Juliana Gavineli).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  evaluateCriteria,
  findMatchingRule,
  type RuleCriterion,
  type RuleRow,
} from "./rule-match.ts";
import {
  pickApproverSkippingRequester,
  requesterMatchesApprover,
  SELF_APPROVAL_FALLBACK,
  type ApprovalLevel,
  type ResolvedApprover,
} from "./approval-skip.ts";

export interface EscalationContext {
  companyDb: string;
  docType: string;
  totalAmount: number;
  costCenter?: string | null;
  project?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  supplierName?: string | null;
  supplierCode?: string | null;
  currency?: string | null;
}

export interface EscalatedApprover extends ResolvedApprover {
  /** Regra usada quando houve escalonamento por faixa superior. */
  escalated_rule_id?: string | null;
  escalated_rule_name?: string | null;
  /** true quando o aprovador veio da faixa de valor superior. */
  escalated?: boolean;
}

function criteriaOf(r: RuleRow): RuleCriterion[] {
  return Array.isArray(r.criteria) ? (r.criteria as RuleCriterion[]) : [];
}

/** Todos os limiares de valor presentes na matriz, acima do valor atual. */
function amountThresholdsAbove(rules: RuleRow[], amount: number): number[] {
  const set = new Set<number>();
  for (const r of rules) {
    for (const c of criteriaOf(r)) {
      if (c.field !== "total_amount") continue;
      for (const raw of [c.value, c.value2]) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > amount) set.add(n);
      }
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function buildCtx(input: EscalationContext, amount: number): Record<string, unknown> {
  return {
    total_amount: amount,
    cost_center: input.costCenter || "",
    project: input.project || "",
    requester_name: input.requesterName || input.requesterEmail || "",
    supplier_name: `${input.supplierName || ""} ${input.supplierCode || ""}`.trim(),
    "supplier.name": String(input.supplierName || "").toLowerCase(),
    "supplier.code": String(input.supplierCode || "").toLowerCase(),
    currency: input.currency || "BRL",
    doc_type: input.docType,
  };
}

async function levelsOf(admin: SupabaseClient, ruleId: string): Promise<ApprovalLevel[]> {
  const { data } = await admin
    .from("approval_rule_levels")
    .select("level_order, approver_name, approver_email")
    .eq("rule_id", ruleId)
    .order("level_order", { ascending: true });
  return ((data || []) as ApprovalLevel[]);
}

/**
 * Resolve o aprovador da regra `ruleId`, pulando níveis do próprio solicitante.
 * Se todos forem o solicitante, escala para a faixa de valor superior da mesma
 * alçada antes de recorrer ao fallback global.
 */
export async function resolveApproverWithEscalation(
  admin: SupabaseClient,
  ruleId: string | null,
  ctx: EscalationContext,
  startFrom = 1,
): Promise<EscalatedApprover> {
  const base = ruleId
    ? pickApproverSkippingRequester(
        await levelsOf(admin, ruleId),
        ctx.requesterName ?? null,
        ctx.requesterEmail ?? null,
        startFrom,
      )
    : {
        level_order: startFrom,
        approver_name: SELF_APPROVAL_FALLBACK.name,
        approver_email: SELF_APPROVAL_FALLBACK.email,
        fallback_used: true,
      };

  if (!base.fallback_used) return base;

  // Nenhum aprovador válido na regra atual → tentar faixa superior.
  const { data: rulesRaw } = await admin
    .from("approval_rules")
    .select("id, name, is_active, priority, doc_type, criteria, company_db")
    .eq("company_db", ctx.companyDb)
    .eq("is_active", true);
  const rules = ((rulesRaw || []) as RuleRow[]).filter((r) => r.id !== ruleId);
  if (rules.length === 0) return base;

  const amount = Number(ctx.totalAmount || 0);
  const thresholds = amountThresholdsAbove(rules, amount);
  const tried = new Set<string>();

  for (const t of thresholds) {
    // Avaliar logo acima do limiar para cair na faixa seguinte.
    for (const probe of [t, t + 0.01]) {
      const candidate = findMatchingRule(rules, buildCtx(ctx, probe), ctx.docType);
      if (!candidate || tried.has(candidate.id)) continue;
      tried.add(candidate.id);
      // A regra candidata precisa continuar válida para o CC/projeto do doc
      // (ignorando o critério de valor, que é justamente o que estamos subindo).
      const nonAmount = criteriaOf(candidate).filter((c) => c.field !== "total_amount");
      if (nonAmount.length > 0 && !evaluateCriteria(nonAmount, buildCtx(ctx, amount))) continue;

      const lvls = await levelsOf(admin, candidate.id);
      const picked = pickApproverSkippingRequester(
        lvls,
        ctx.requesterName ?? null,
        ctx.requesterEmail ?? null,
        1,
      );
      if (picked.fallback_used) continue;
      if (
        requesterMatchesApprover(
          ctx.requesterName ?? null,
          ctx.requesterEmail ?? null,
          picked.approver_name,
          picked.approver_email,
        )
      ) continue;
      return {
        ...picked,
        level_order: base.level_order,
        escalated: true,
        escalated_rule_id: candidate.id,
        escalated_rule_name: candidate.name ?? null,
      };
    }
  }

  return base;
}
