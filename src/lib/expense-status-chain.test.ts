import { describe, expect, it } from "vitest";

import { deriveExpenseLifecycleStatus } from "../../supabase/functions/_shared/expense-status-chain";

const base = {
  currentStatus: "pc_lancado",
  expenseTotal: 100,
  poDocumentStatus: "bost_Open",
  poCancelled: "tNO",
};

describe("deriveExpenseLifecycleStatus", () => {
  it("advances to NF de Entrada when an active invoice exists", () => {
    expect(deriveExpenseLifecycleStatus({
      ...base,
      invoices: [{ docTotal: 100, paidToDate: 0, cancelled: "tNO" }],
    })).toBe("nf_entrada");
  });

  it("marks a partially paid invoice", () => {
    expect(deriveExpenseLifecycleStatus({
      ...base,
      invoices: [{ docTotal: 100, paidToDate: 40, cancelled: "tNO" }],
    })).toBe("pagamento");
  });

  it("finalizes a fully invoiced and paid purchase", () => {
    expect(deriveExpenseLifecycleStatus({
      ...base,
      invoices: [{ docTotal: 100, paidToDate: 100, cancelled: "tNO" }],
    })).toBe("finalizado");
  });

  it("does not finalize when only part of the purchase was invoiced", () => {
    expect(deriveExpenseLifecycleStatus({
      ...base,
      invoices: [{ docTotal: 60, paidToDate: 60, cancelled: "tNO" }],
    })).toBe("pagamento");
  });

  it("regresses to the PO stage when every known invoice was cancelled", () => {
    expect(deriveExpenseLifecycleStatus({
      ...base,
      currentStatus: "nf_entrada",
      invoices: [{ docTotal: 100, paidToDate: 0, cancelled: "tYES" }],
    })).toBe("pc_lancado");
  });

  it("does not change approval workflow statuses", () => {
    expect(deriveExpenseLifecycleStatus({
      ...base,
      currentStatus: "pendente_aprovacao",
      invoices: [{ docTotal: 100, paidToDate: 100, cancelled: "tNO" }],
    })).toBe("pendente_aprovacao");
  });
});
