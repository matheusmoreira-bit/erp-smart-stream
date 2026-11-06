import { describe, expect, it, vi } from "vitest";
import { rematchRuleFromMatrix } from "../../supabase/functions/_shared/expense-rule-rematch";
import { findMatchingRule, type RuleCriterion, type RuleRow } from "../../supabase/functions/_shared/rule-match";
import { buildApprovalItemContext } from "../../supabase/functions/_shared/approval-item-context";
import type { SupabaseClient } from "@supabase/supabase-js";

const rule: RuleRow = {
  id: "48507a04-d5a4-46ca-84df-57cd12d985bf", name: "Reembolso (OUT00007) | 7K",
  company_db: "SBO_ANAGAMING", is_active: true, priority: 10000, doc_type: "both",
  criteria: [
    { field: "item.code", operator: "like", value: "%out00007%", group: 0 },
    { field: "project", operator: "equal", value: "7K", group: 0, logic: "and" },
  ],
};
const item = { item_code: "OUT00007", description: "JET A", cost_center: "1.81.1.3", project: "7K", line_total: 6300 };
const ctx = {
  companyDb: "SBO_ANAGAMING", docType: "purchase", totalAmount: 6300,
  costCenter: "", project: "", currency: "BRL", requesterName: "isabelle.santos",
  supplierName: null, supplierCode: null, expenseId: "fixture", rateioType: "padrao",
};
function client(items = [item], rules = [rule], error: { message: string } | null = null) {
  const from = vi.fn((table: string) => {
    const result = { data: table === "expense_items" ? items : rules, error };
    const query = { select: vi.fn(), eq: vi.fn(), then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    return query;
  });
  return { admin: { from } as unknown as SupabaseClient, from };
}
describe("expense matrix rematch", () => {
  it("matches OUT00007 + line project 7K with empty headers at creation", async () => {
    const { admin, from } = client();
    expect(await rematchRuleFromMatrix(admin, { ...ctx, items: [item] })).toBe(rule.id);
    expect(from).not.toHaveBeenCalledWith("expense_items");
  });
  it("matches the same rule from persisted items when no item payload is provided", async () => {
    const { admin } = client();
    expect(await rematchRuleFromMatrix(admin, ctx)).toBe(rule.id);
  });
  it("does not invent a match for a different code or project", async () => {
    const { admin } = client();
    expect(await rematchRuleFromMatrix(admin, { ...ctx, items: [{ ...item, item_code: "OTHER" }] })).toBeNull();
    expect(await rematchRuleFromMatrix(admin, { ...ctx, project: "VERA", items: [item] })).toBeNull();
  });
  it("does not borrow the first line project for another cost center", async () => {
    const ccRule = { ...rule, criteria: [...rule.criteria as RuleCriterion[], { field: "cost_center", operator: "equal", value: "9.9.9" }] };
    const { admin } = client([item], [ccRule]);
    expect(await rematchRuleFromMatrix(admin, { ...ctx, items: [item, { ...item, cost_center: "9.9.9", project: "VERA" }] })).toBeNull();
  });
  it("keeps company scoping and document type filtering", async () => {
    const { admin, from } = client([item], [{ ...rule, doc_type: "sales" }]);
    expect(await rematchRuleFromMatrix(admin, { ...ctx, items: [item] })).toBeNull();
    expect(from.mock.results.at(-1)?.value.eq).toHaveBeenCalledWith("company_db", "SBO_ANAGAMING");
  });
  it("fails visibly on a matrix read error instead of declaring a gap", async () => {
    const { admin } = client([item], [], { message: "read failed" });
    await expect(rematchRuleFromMatrix(admin, { ...ctx, items: [item] })).rejects.toThrow("read failed");
  });
  it("keeps item-specific rules isolated to the items of each segment", () => {
    expect(findMatchingRule([rule], { project: "7K", ...buildApprovalItemContext([item]) }, "purchase")?.id).toBe(rule.id);
    expect(findMatchingRule([rule], { project: "7K", ...buildApprovalItemContext([{ ...item, item_code: "OTHER" }]) }, "purchase")).toBeNull();
  });
});