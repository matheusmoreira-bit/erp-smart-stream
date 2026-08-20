import { describe, expect, it } from "vitest";
import { classifyExpenseEdit, normalizeExpenseItems } from "../../supabase/functions/_shared/expense-items";

describe("normalizeExpenseItems", () => {
  it("recalcula o total e preserva os campos necessários ao PATCH", () => {
    const [item] = normalizeExpenseItems([{
      item_code: "SI.05.0001",
      description: "Licenciamento",
      quantity: "2",
      unit_price: "506.50",
      line_total: 0,
      cost_center: "1.3.1.1",
      project: "ANA GAMING",
    }]);

    expect(item).toMatchObject({
      item_code: "SI.05.0001",
      quantity: 2,
      unit_price: 506.5,
      line_total: 1013,
      cost_center: "1.3.1.1",
      project: "ANA GAMING",
    });
  });

  it.each([
    ["quantidade", { quantity: 0, unit_price: 10 }],
    ["valor", { quantity: 1, unit_price: 0 }],
  ])("rejeita %s zerado", (_label, values) => {
    expect(() => normalizeExpenseItems([{
      description: "Linha inválida",
      cost_center: "1.1.1.1",
      ...values,
    }])).toThrow(/maior que zero/);
  });

  it("permite CC ausente somente quando o chamador define fallback", () => {
    const [item] = normalizeExpenseItems([{
      description: "Serviço",
      quantity: 1,
      unit_price: 100,
    }], { requireCostCenter: false });

    expect(item.cost_center).toBeNull();
  });
});

describe("classifyExpenseEdit", () => {
  it.each([
    ["pendente_aprovacao", false, "pending"],
    ["aprovado", false, "approved"],
    ["pc_lancado", true, "integrated"],
    ["nf_entrada", true, "blocked"],
  ])("classifica %s", (status, inSap, expected) => {
    expect(classifyExpenseEdit(status, inSap)).toBe(expected);
  });
});
