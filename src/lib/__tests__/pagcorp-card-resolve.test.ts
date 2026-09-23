import { describe, it, expect } from "vitest";
import { resolveCardMapping } from "../pagcorp-card-resolve";

const rows = [
  { card_identifier: null, is_fallback: true, cost_center: "FB", project: "PFB", item_code: "IFB" },
  { card_identifier: "1234", is_fallback: false, cost_center: "C1", project: null, item_code: "I1" },
];
const rules = [
  { card_identifier: "**** 1234", supplier_code: "F1", cost_center: "CS", project: null, item_code: null, account_code: "A1", is_active: true },
];

describe("resolveCardMapping", () => {
  it("prioriza cartão+fornecedor e completa campo a campo", () => {
    const r = resolveCardMapping(["1234"], "F1", rows, rules);
    expect(r.costCenter).toBe("CS");
    expect(r.project).toBe("PFB");
    expect(r.itemCode).toBe("I1");
    expect(r.accountCode).toBe("A1");
    expect(r.source).toBe("card_supplier");
  });
  it("sem fornecedor usa cartão e fallback", () => {
    const r = resolveCardMapping(["1234"], null, rows, rules);
    expect(r.costCenter).toBe("C1");
    expect(r.source).toBe("card");
    expect(r.accountCode).toBeNull();
  });
  it("ignora regra inativa", () => {
    const r = resolveCardMapping(["1234"], "F1", rows, [{ ...rules[0], is_active: false }]);
    expect(r.costCenter).toBe("C1");
  });
});
