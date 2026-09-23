import { describe, it, expect } from "vitest";
import { findSupplierRule, ruleMatches, type PagCorpSupplierRule } from "@/lib/pagcorp-supplier-rules";

const rule = (p: Partial<PagCorpSupplierRule>): PagCorpSupplierRule => ({
  company_db: "SBO_ANAGAMING",
  pattern: "CURSOR,",
  match_type: "startswith",
  supplier_code: "F001636",
  ...p,
});

describe("pagcorp supplier rules", () => {
  it("matches a prefix ignoring case and accents", () => {
    expect(ruleMatches(rule({}), "CURSOR, AI POWERED IDESAN")).toBe(true);
    expect(ruleMatches(rule({}), "cursor, ai powered")).toBe(true);
    expect(ruleMatches(rule({}), "MEU CURSOR, AI")).toBe(false);
  });

  it("supports contains", () => {
    expect(ruleMatches(rule({ match_type: "contains", pattern: "powered" }), "CURSOR, AI POWERED")).toBe(true);
  });

  it("ignores inactive rules", () => {
    expect(ruleMatches(rule({ is_active: false }), "CURSOR, AI")).toBe(false);
  });

  it("prefers priority, then startswith, then the longest pattern", () => {
    const rules = [
      rule({ pattern: "cursor", match_type: "contains", supplier_code: "F1" }),
      rule({ pattern: "cursor,", match_type: "startswith", supplier_code: "F2" }),
      rule({ pattern: "cursor, ai", match_type: "startswith", supplier_code: "F3", priority: 10 }),
    ];
    expect(findSupplierRule(rules, "CURSOR, AI POWERED")?.supplier_code).toBe("F3");
    expect(findSupplierRule(rules.slice(0, 2), "CURSOR, AI POWERED")?.supplier_code).toBe("F2");
    expect(findSupplierRule(rules, "OUTRA COMPRA")).toBeNull();
  });
});
