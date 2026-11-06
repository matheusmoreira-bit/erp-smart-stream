import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { findMatchingRule, pickHierarchicalFallbackRule, type RuleRow } from "./rule-match.ts";

/**
 * Reavalia a matriz de aprovação para um documento que está sem `approval_rule_id`.
 * Usa o CC do cabeçalho e, quando vazio, os CCs dos itens (caso de rateio/reembolso,
 * em que o CC só existe nas linhas). Só cai no fallback global quando nem a regra
 * exata nem a alçada do ramo do CC existem.
 */
export async function rematchRuleFromMatrix(
  admin: SupabaseClient,
  ctx: {
    companyDb: string;
    docType: string;
    totalAmount: number;
    costCenter: string;
    project: string;
    currency: string | null;
    requesterName: string | null;
    supplierName: string | null;
    supplierCode: string | null;
    expenseId: string;
    rateioType?: string | null;
    items?: Array<{ cost_center?: string | null }> | null;
  },
): Promise<string | null> {
  if (!ctx.companyDb) return null;

  let itemCcs: string[] = (ctx.items || [])
    .map((it) => String(it?.cost_center || "").trim())
    .filter(Boolean);
  if (itemCcs.length === 0) {
    const { data } = await admin
      .from("expense_items")
      .select("cost_center")
      .eq("expense_id", ctx.expenseId);
    itemCcs = ((data || []) as Array<{ cost_center: string | null }>)
      .map((it) => String(it.cost_center || "").trim())
      .filter(Boolean);
  }
  const candidateCcs = Array.from(new Set(ctx.costCenter ? [ctx.costCenter] : itemCcs));
  // Regras globais (inclusive aprovação automática) não dependem de CC.
  if (candidateCcs.length === 0) candidateCcs.push("");

  const { data: rulesRaw } = await admin
    .from("approval_rules")
    .select("*")
    .eq("company_db", ctx.companyDb)
    .eq("is_active", true);
  const rules = (rulesRaw || []) as unknown as RuleRow[];
  if (rules.length === 0) return null;

  const buildCtx = (cc: string) => ({
    total_amount: ctx.totalAmount,
    cost_center: cc,
    project: ctx.project,
    requester_name: ctx.requesterName || "",
    supplier_name: `${ctx.supplierName || ""} ${ctx.supplierCode || ""}`.trim(),
    "supplier.name": String(ctx.supplierName || "").toLowerCase(),
    "supplier.code": String(ctx.supplierCode || "").toLowerCase(),
    currency: ctx.currency || "BRL",
    doc_type: ctx.docType,
    rateio_type: String(ctx.rateioType || "padrao").toLowerCase(),
  });

  for (const cc of candidateCcs) {
    const match = findMatchingRule(rules, buildCtx(cc), ctx.docType);
    if (match) return match.id;
  }
  for (const cc of candidateCcs) {
    const hier = pickHierarchicalFallbackRule(rules, buildCtx(cc), ctx.docType);
    if (hier) return hier.rule.id;
  }
  return null;
}

