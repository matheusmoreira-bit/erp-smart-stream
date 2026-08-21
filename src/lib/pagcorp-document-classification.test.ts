import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPagCorpDocuments, hasInvoiceEquivalent } from "./pagcorp-document-classification";

const mocks = vi.hoisted(() => ({
  publicFunctionFetch: vi.fn(),
  sapFunctionFetch: vi.fn(),
}));

vi.mock("@/lib/auth-fetch", () => mocks);

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

describe("classifyPagCorpDocuments", () => {
  beforeEach(() => {
    mocks.publicFunctionFetch.mockReset();
    mocks.sapFunctionFetch.mockReset();
  });

  it("returns the persisted classification without invoking AI again", async () => {
    mocks.sapFunctionFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      classifications: [{
        pagcorp_expense_id: 123,
        status: "completed",
        has_fiscal_document: true,
        document_kinds: ["nota_fiscal"],
        confidence: 0.91,
      }],
    }), { status: 200 }));

    const result = await classifyPagCorpDocuments({
      id: 123,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as any, "EMPRESA");

    expect(result).toEqual({
      status: "completed",
      hasFiscalDocument: true,
      documentKinds: ["nota_fiscal"],
      confidence: 0.91,
      errorMessage: undefined,
    });
    expect(mocks.publicFunctionFetch).not.toHaveBeenCalled();
    expect(mocks.sapFunctionFetch).toHaveBeenCalledTimes(1);
  });

  it("returns an error without invoking AI when classification persistence fails", async () => {
    mocks.sapFunctionFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ classifications: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Tabela indisponível" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const result = await classifyPagCorpDocuments({
      id: 456,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as any, "EMPRESA");

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Tabela indisponível");
    expect(mocks.publicFunctionFetch).not.toHaveBeenCalled();
    expect(mocks.sapFunctionFetch).toHaveBeenCalledTimes(3);
  });
});
