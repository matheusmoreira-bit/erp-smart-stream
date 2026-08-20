import { describe, expect, it } from "vitest";
import { hasInvoiceEquivalent } from "./pagcorp-document-classification";

describe("hasInvoiceEquivalent", () => {
  it("routes a Brazilian fiscal invoice to purchase order", () => {
    expect(hasInvoiceEquivalent([{ document_kind: "nota_fiscal", is_invoice_equivalent: true }])).toBe(true);
  });

  it("does not treat payment evidence or a simple receipt as an invoice", () => {
    expect(hasInvoiceEquivalent([
      { document_kind: "comprovante_pagamento", is_invoice_equivalent: false },
      { document_kind: "receipt", is_invoice_equivalent: false },
    ])).toBe(false);
  });

  it("supports invoice kinds returned by older AI responses", () => {
    expect(hasInvoiceEquivalent([{ document_kind: "invoice" }])).toBe(true);
  });
});
