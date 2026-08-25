import { describe, expect, it } from "vitest";

import { resolveDocumentPaymentStatus } from "./relations-payment-status";

describe("resolveDocumentPaymentStatus", () => {
  it("marks a fully settled document as paid", () => {
    expect(resolveDocumentPaymentStatus(100, 100)).toMatchObject({
      state: "paid",
      label: "Baixado/Pago",
    });
  });

  it("marks a partially settled document as partially paid", () => {
    expect(resolveDocumentPaymentStatus(100, 40)).toMatchObject({
      state: "partial",
      label: "Pago Parcialmente",
    });
  });

  it("recognizes ERP settlement statuses even when the paid amount is omitted", () => {
    expect(resolveDocumentPaymentStatus(100, null, "LIQUIDADO")).toMatchObject({
      state: "paid",
      label: "Baixado/Pago",
      paidAmount: 100,
    });
  });

  it("recognizes an explicit partial status", () => {
    expect(resolveDocumentPaymentStatus(100, null, "PAGO_PARCIAL")).toMatchObject({
      state: "partial",
      label: "Pago Parcialmente",
    });
  });

  it("does not treat an unpaid closed document as paid", () => {
    expect(resolveDocumentPaymentStatus(100, 0, "bost_Close")).toMatchObject({
      state: "closed",
      label: "Fechado",
    });
  });
});
