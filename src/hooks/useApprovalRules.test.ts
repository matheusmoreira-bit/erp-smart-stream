import { describe, it, expect } from "vitest";
import { normalizeCriteria } from "./useApprovalRules";
import type { RuleCriterion } from "./useApprovalRules";

const c = (field: string, extra: Partial<RuleCriterion> = {}): RuleCriterion => ({
  field,
  operator: "equal",
  value: "1",
  ...extra,
});

describe("normalizeCriteria — persistência dos conectores E/OU", () => {
  it("preenche defaults: primeiro sem logic; demais com logic=and", () => {
    const out = normalizeCriteria([c("a"), c("b"), c("c")]);
    expect(out[0].logic).toBeUndefined();
    expect(out[1].logic).toBe("and");
    expect(out[2].logic).toBe("and");
  });

  it("preserva logic=or explicitamente escolhido pelo usuário", () => {
    const out = normalizeCriteria([c("a"), c("b", { logic: "or" }), c("c", { logic: "and" })]);
    expect(out[1].logic).toBe("or");
    expect(out[2].logic).toBe("and");
  });

  it("primeiro critério de grupo>0 recebe groupLogic default 'and' (fallback legado)", () => {
    const out = normalizeCriteria([
      c("a", { group: 0 }),
      c("b", { group: 1 }),
      c("c", { group: 1 }),
    ]);
    expect(out[0].groupLogic).toBeUndefined();
    expect(out[1].groupLogic).toBe("and");
    expect(out[2].groupLogic).toBeUndefined(); // só o primeiro do grupo carrega
    expect(out[1].logic).toBeUndefined();      // primeiro do grupo não tem logic
    expect(out[2].logic).toBe("and");
  });

  it("preserva groupLogic='or' explicitamente escolhido no 1º do grupo", () => {
    const out = normalizeCriteria([
      c("a", { group: 0 }),
      c("b", { group: 1, groupLogic: "or" }),
    ]);
    expect(out[1].groupLogic).toBe("or");
  });


  it("preserva groupLogic='and' escolhido pelo usuário no 1º do grupo", () => {
    const out = normalizeCriteria([
      c("a", { group: 0 }),
      c("b", { group: 1, groupLogic: "and" }),
    ]);
    expect(out[1].groupLogic).toBe("and");
  });

  it("hidrata regras legadas sem group: tudo no grupo 0", () => {
    const out = normalizeCriteria([c("a"), c("b")]);
    expect(out.every((x) => x.group === 0)).toBe(true);
    expect(out[0].groupLogic).toBeUndefined();
    expect(out[1].logic).toBe("and");
  });

  it("remove groupLogic residual de critérios que não são primeiro do grupo", () => {
    const out = normalizeCriteria([
      c("a", { group: 0 }),
      c("b", { group: 0, groupLogic: "or" as const }),
    ]);
    expect(out[1].groupLogic).toBeUndefined();
  });

  it("array vazio ou nulo → []", () => {
    expect(normalizeCriteria([])).toEqual([]);
    expect(normalizeCriteria(null)).toEqual([]);
    expect(normalizeCriteria(undefined)).toEqual([]);
  });
});
