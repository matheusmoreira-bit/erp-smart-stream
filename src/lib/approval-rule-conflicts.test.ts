import { describe, it, expect } from "vitest";
import { detectRuleConflicts } from "@/lib/approval-rule-conflicts";
const rule = (id: string, priority: number, value: string, approver: string) => ({
  id, name: `R${id}`, is_active: true, priority,
  criteria: [{ field: "cost_center", operator: "equal" as const, value }],
  doc_type: "purchase" as const, created_by: "", created_at: "", updated_at: "", company_db: null,
  levels: [{ level_order: 1, approver_name: approver, approver_email: `${approver}@x.com` }],
});
describe("conflitos", () => {
  it("detecta empate de prioridade", () => {
    const r = detectRuleConflicts([rule("a", 10, "1.5.1.3", "ana"), rule("b", 10, "1.5.1.3", "bia")]);
    expect(r.conflicts[0].kind).toBe("tie");
    expect(r.conflicts[0].severity).toBe("critical");
  });
  it("detecta sobreposicao e regra sombreada", () => {
    const r = detectRuleConflicts([rule("a", 20, "1.5.1.3", "ana"), rule("b", 5, "1.5.1.3", "bia")]);
    expect(r.conflicts[0].kind).toBe("overlap");
    expect(r.shadowed.map((s) => s.rule.id)).toEqual(["b"]);
  });
  it("nao acusa conflito entre CCs distintos", () => {
    const r = detectRuleConflicts([rule("a", 10, "1.5.1.3", "ana"), rule("b", 10, "2.2.2.2", "bia")]);
    expect(r.conflicts).toHaveLength(0);
  });
});
