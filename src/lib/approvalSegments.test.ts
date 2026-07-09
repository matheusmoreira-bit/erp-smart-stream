import { describe, it, expect } from "vitest";
import { evaluateCriteria, findMatchingRule } from "./approvalSegments";
import type { ApprovalRule, RuleCriterion } from "@/hooks/useApprovalRules";

// --- Helpers ---------------------------------------------------------------

const c = (
  field: string,
  operator: RuleCriterion["operator"],
  value: string,
  extra: Partial<RuleCriterion> = {},
): RuleCriterion => ({ field, operator, value, ...extra });

const makeRule = (
  id: string,
  criteria: RuleCriterion[],
  priority = 0,
  overrides: Partial<ApprovalRule> = {},
): ApprovalRule => ({
  id,
  name: id,
  is_active: true,
  priority,
  criteria,
  doc_type: "both",
  created_by: "test",
  created_at: "",
  updated_at: "",
  company_db: null,
  levels: [],
  ...overrides,
});

// --- evaluateCriteria: combinações E/OU -----------------------------------

describe("evaluateCriteria — 2 critérios (E/OU)", () => {
  const ctx = { total_amount: 1500, cost_center: "1.2.1.2" };

  it("A E B — ambos verdadeiros → true", () => {
    const crits = [
      c("total_amount", "greater_than", "1000"),
      c("cost_center", "equal", "1.2.1.2", { logic: "and" }),
    ];
    expect(evaluateCriteria(crits, ctx)).toBe(true);
  });

  it("A E B — B falso → false", () => {
    const crits = [
      c("total_amount", "greater_than", "1000"),
      c("cost_center", "equal", "9.9.9.9", { logic: "and" }),
    ];
    expect(evaluateCriteria(crits, ctx)).toBe(false);
  });

  it("A OU B — só A verdadeiro → true", () => {
    const crits = [
      c("total_amount", "greater_than", "1000"),
      c("cost_center", "equal", "9.9.9.9", { logic: "or" }),
    ];
    expect(evaluateCriteria(crits, ctx)).toBe(true);
  });

  it("A OU B — ambos falsos → false", () => {
    const crits = [
      c("total_amount", "greater_than", "9999"),
      c("cost_center", "equal", "9.9.9.9", { logic: "or" }),
    ];
    expect(evaluateCriteria(crits, ctx)).toBe(false);
  });
});

describe("evaluateCriteria — 3 critérios avaliados esquerda→direita", () => {
  const ctx = { a: 1, b: 0, cc: 1 };
  const A = c("a", "equal", "1");
  const Btrue = c("b", "equal", "0");
  const Bfalse = c("b", "equal", "9");
  const Ctrue = c("cc", "equal", "1");
  const Cfalse = c("cc", "equal", "9");

  it("A E B OU C — (A E B) OU C: A E B true → true", () => {
    const crits = [A, { ...Btrue, logic: "and" as const }, { ...Cfalse, logic: "or" as const }];
    expect(evaluateCriteria(crits, ctx)).toBe(true);
  });

  it("A E B OU C — (A E B=false) OU C=true → true", () => {
    const crits = [A, { ...Bfalse, logic: "and" as const }, { ...Ctrue, logic: "or" as const }];
    expect(evaluateCriteria(crits, ctx)).toBe(true);
  });

  it("A E B OU C — todos falhando exceto A → false", () => {
    const crits = [A, { ...Bfalse, logic: "and" as const }, { ...Cfalse, logic: "or" as const }];
    expect(evaluateCriteria(crits, ctx)).toBe(false);
  });

  it("A OU B E C — (A OU B) E C: A true, C true → true", () => {
    const crits = [A, { ...Bfalse, logic: "or" as const }, { ...Ctrue, logic: "and" as const }];
    expect(evaluateCriteria(crits, ctx)).toBe(true);
  });

  it("A OU B E C — (A OU B) E C=false → false (esquerda→direita, sem precedência)", () => {
    const crits = [A, { ...Bfalse, logic: "or" as const }, { ...Cfalse, logic: "and" as const }];
    expect(evaluateCriteria(crits, ctx)).toBe(false);
  });
});

describe("evaluateCriteria — 4+ critérios", () => {
  const ctx = { x: 1, y: 1, z: 0, w: 1 };
  const T = (f: string) => c(f, "equal", "1");
  const F = (f: string) => c(f, "equal", "1"); // z=0 → F("z")

  it("T E T E T E T → true", () => {
    const crits = [T("x"), { ...T("y"), logic: "and" as const }, { ...T("w"), logic: "and" as const }, { ...T("x"), logic: "and" as const }];
    expect(evaluateCriteria(crits, ctx)).toBe(true);
  });

  it("T E F E T OU T → (((T E F) E T) OU T) = true", () => {
    const crits = [
      T("x"),
      { ...F("z"), logic: "and" as const },
      { ...T("y"), logic: "and" as const },
      { ...T("w"), logic: "or" as const },
    ];
    expect(evaluateCriteria(crits, ctx)).toBe(true);
  });

  it("F E T E T E T → false (primeiro já falha e todos são AND)", () => {
    const crits = [
      F("z"),
      { ...T("x"), logic: "and" as const },
      { ...T("y"), logic: "and" as const },
      { ...T("w"), logic: "and" as const },
    ];
    expect(evaluateCriteria(crits, ctx)).toBe(false);
  });
});

// --- evaluateCriteria: grupos ---------------------------------------------

describe("evaluateCriteria — grupos (G1 OU G2 OU G3)", () => {
  const ctx = {
    cost_center: "1.2.1.2",
    "supplier.code": "F000001",
    "supplier.name": "cactus corp",
  };

  const g1 = [
    c("cost_center", "equal", "1.2.1.2", { group: 0 }),
    c("supplier.code", "equal", "F000001", { group: 0, logic: "and" }),
  ];
  const g2 = [
    c("cost_center", "equal", "9.9.9.9", { group: 1, groupLogic: "or" }),
    c("supplier.code", "equal", "F000999", { group: 1, logic: "and" }),
  ];
  const g3 = [
    c("supplier.name", "like", "cactus%", { group: 2, groupLogic: "or" }),
    c("supplier.code", "equal", "F0000123", { group: 2, logic: "or" }),
  ];

  it("G1 verdadeiro → true", () => {
    expect(evaluateCriteria([...g1, ...g2, ...g3], ctx)).toBe(true);
  });

  it("Apenas G3 verdadeiro → true", () => {
    const ctx2 = { ...ctx, "supplier.code": "F999", cost_center: "0" };
    expect(evaluateCriteria([...g1, ...g2, ...g3], ctx2)).toBe(true);
  });

  it("Nenhum grupo verdadeiro → false", () => {
    const ctx2 = { cost_center: "0", "supplier.code": "F999", "supplier.name": "outra" };
    expect(evaluateCriteria([...g1, ...g2, ...g3], ctx2)).toBe(false);
  });

  it("G1 E G2 (groupLogic=and) — só G1 passa → false", () => {
    const g2and = g2.map((x, i) => (i === 0 ? { ...x, groupLogic: "and" as const } : x));
    expect(evaluateCriteria([...g1, ...g2and], ctx)).toBe(false);
  });
});

// --- findMatchingRule: regra vencedora no simulador -----------------------

describe("findMatchingRule — regra vencedora", () => {
  const ctx = { total_amount: 5000, cost_center: "CC1" };

  it("escolhe a de maior prioridade quando ambas batem", () => {
    const low = makeRule("low", [c("total_amount", "greater_than", "1000")], 1);
    const high = makeRule("high", [c("total_amount", "greater_than", "1000")], 10);
    expect(findMatchingRule([low, high], ctx, "purchase")?.id).toBe("high");
  });

  it("ignora regras inativas", () => {
    const active = makeRule("a", [c("total_amount", "greater_than", "9999")], 10);
    const winner = makeRule("w", [c("total_amount", "greater_than", "1000")], 1);
    const inactive = makeRule("x", [c("total_amount", "greater_than", "1")], 999, { is_active: false });
    expect(findMatchingRule([active, winner, inactive], ctx, "purchase")?.id).toBe("w");
  });

  it("filtra por doc_type (sales não bate em purchase)", () => {
    const salesRule = makeRule("s", [c("total_amount", "greater_than", "1000")], 10, { doc_type: "sales" });
    const purchaseRule = makeRule("p", [c("total_amount", "greater_than", "1000")], 1, { doc_type: "purchase" });
    expect(findMatchingRule([salesRule, purchaseRule], ctx, "purchase")?.id).toBe("p");
  });

  it("respeita E/OU nos critérios ao selecionar a regra vencedora", () => {
    // r1 exige (>1000 E CC=X) — não deveria bater porque CC≠X
    const r1 = makeRule(
      "r1",
      [c("total_amount", "greater_than", "1000"), c("cost_center", "equal", "X", { logic: "and" })],
      10,
    );
    // r2 exige (>1000 OU CC=X) — bate por causa do total
    const r2 = makeRule(
      "r2",
      [c("total_amount", "greater_than", "1000"), c("cost_center", "equal", "X", { logic: "or" })],
      1,
    );
    expect(findMatchingRule([r1, r2], ctx, "purchase")?.id).toBe("r2");
  });

  it("retorna null quando nenhuma regra bate", () => {
    const r = makeRule("r", [c("total_amount", "greater_than", "99999")], 10);
    expect(findMatchingRule([r], ctx, "purchase")).toBeNull();
  });
});
