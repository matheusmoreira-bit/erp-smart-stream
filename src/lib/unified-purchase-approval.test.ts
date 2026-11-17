import { describe, expect, it } from "vitest";
import { isPurchaseApprovalScope, unifiedApprovalTargets } from "../../supabase/functions/_shared/unified-purchase-approval";
import { approvalsSatisfyLevel, resolveReprocessedApprovalState } from "../../supabase/functions/_shared/approval-reprocess";

const levels = [
  { level_order: 1, approver_name: "Juliana Gavineli", approver_email: "juliana.gavineli@anagaming.com.br", require_all: false },
  { level_order: 1, approver_name: "Mauricio Farias", approver_email: "mauricio.farias@anagaming.com.br", require_all: false },
];
describe("unified purchase approval", () => {
  it("uses exactly one alternative level", () => {
    expect(unifiedApprovalTargets(levels, null, null).map((l) => l.level_order)).toEqual([1, 1]);
    expect(() => unifiedApprovalTargets([{ ...levels[0], level_order: 2 }, levels[1]], null, null)).toThrow();
  });
  it.each(["juliana.gavineli@anagaming.com.br", "mauricio.farias@anagaming.com.br"])("one decision from %s suffices", (email) => {
    expect(approvalsSatisfyLevel([{ approver_email: email }], levels)).toBe(true);
    expect(approvalsSatisfyLevel([{ approver_email: "other@example.com" }], levels)).toBe(false);
  });
  it("routes pending requests to Juliana without reusing old decisions", () => {
    expect(resolveReprocessedApprovalState(unifiedApprovalTargets(levels, null, null), [], null, null)).toMatchObject({ status: "pendente", current_approver: "Juliana Gavineli", current_level: 1 });
  });
  it("routes Juliana's request to Mauricio and forbids self approval", () => {
    expect(unifiedApprovalTargets(levels, "juliana.gavineli", "juliana.gavineli@anagaming.com.br").map((l) => l.approver_email)).toEqual(["mauricio.farias@anagaming.com.br"]);
  });
  it("keeps Juliana eligible when Mauricio requested", () => {
    expect(unifiedApprovalTargets(levels, "mauricio.farias", "mauricio.farias@anagaming.com.br").map((l) => l.approver_email)).toEqual(["juliana.gavineli@anagaming.com.br"]);
  });
  it("includes purchases and note payments but excludes sales", () => {
    expect(isPurchaseApprovalScope("purchase")).toBe(true);
    expect(isPurchaseApprovalScope("advance")).toBe(true);
    expect(isPurchaseApprovalScope("sales")).toBe(false);
  });
  it("rejects an all-approvers configuration", () => {
    expect(() => unifiedApprovalTargets([{ ...levels[0], require_all: true }, levels[1]], null, null)).toThrow();
  });
});