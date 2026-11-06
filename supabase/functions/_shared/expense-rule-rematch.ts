import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { findMatchingRule, pickHierarchicalFallbackRule, type RuleRow } from "./rule-match.ts";
import { buildApprovalItemContext, type ApprovalContextItem } from "./approval-item-context.ts";

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
    items?: ApprovalContextItem[] | null;
  },
): Promise<string | null> {
  if (!ctx.companyDb) return null;

  let items = ctx.items;
  if (items == null && ctx.expenseId) {
    const { data, error } = await admin
      .from("expense_items")
      .select("cost_center, project, item_code, description, items_group_name")
      .eq("expense_id", ctx.expenseId);
    if (error) throw new Error(`Falha ao ler itens para a matriz: ${error.message}`);
    items = (data || []) as ApprovalContextItem[];
  }
  items = items || [];
  const candidates = items.length ? items.map((item) => ({
    cc: String(ctx.costCenter || item.cost_center || "").trim(),
    project: String(ctx.project || item.project || "").trim(),
  })) : [{ cc: ctx.costCenter, project: ctx.project }];
  const itemCtx = buildApprovalItemContext(items);

  const { data: rulesRaw, error } = await admin
    .from("approval_rules")
    .select("*")
    .eq("company_db", ctx.companyDb)
    .eq("is_active", true);
  if (error) throw new Error(`Falha ao ler matriz de aprovação: ${error.message}`);
  const rules = (rulesRaw || []) as unknown as RuleRow[];
  if (rules.length === 0) return null;

  const buildCtx = ({ cc, project }: { cc: string; project: string }) => ({
    total_amount: ctx.totalAmount,
    cost_center: cc,
    project,
    requester_name: ctx.requesterName || "",
    supplier_name: `${ctx.supplierName || ""} ${ctx.supplierCode || ""}`.trim(),
    "supplier.name": String(ctx.supplierName || "").toLowerCase(),
    "supplier.code": String(ctx.supplierCode || "").toLowerCase(),
    currency: ctx.currency || "BRL",
    doc_type: ctx.docType,
    rateio_type: String(ctx.rateioType || "padrao").toLowerCase(),
    ...itemCtx,
  });

  for (const candidate of candidates) {
    const match = findMatchingRule(rules, buildCtx(candidate), ctx.docType);
    if (match) return match.id;
  }
  for (const candidate of candidates) {
    const hier = pickHierarchicalFallbackRule(rules, buildCtx(candidate), ctx.docType);
    if (hier) return hier.rule.id;
  }
  return null;
}

