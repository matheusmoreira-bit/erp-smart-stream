import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyPagCorpDocuments,
  hasInvoiceEquivalent,
  isPagCorpAiEligible,
} from "./pagcorp-document-classification";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

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

  const eligibleTransaction = {
    accountabilityApproved: true,
    integrated: false,
    integrationStatusResolved: true,
    isReversed: false,
  };

  it("only considers approved, unintegrated transactions eligible for AI", () => {
    expect(isPagCorpAiEligible(eligibleTransaction)).toBe(true);
    expect(isPagCorpAiEligible({ ...eligibleTransaction, accountabilityApproved: false })).toBe(false);
    expect(isPagCorpAiEligible({ ...eligibleTransaction, integrated: true })).toBe(false);
    expect(isPagCorpAiEligible({ ...eligibleTransaction, integrationStatusResolved: false })).toBe(false);
    expect(isPagCorpAiEligible({ ...eligibleTransaction, isReversed: true })).toBe(false);
  });

  it("does not call storage or AI for an unapproved transaction", async () => {
    const result = await classifyPagCorpDocuments({
      id: 100,
      ...eligibleTransaction,
      accountabilityApproved: false,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as unknown as PagCorpTransaction, "EMPRESA");

    expect(result.status).toBe("pending");
    expect(mocks.sapFunctionFetch).not.toHaveBeenCalled();
    expect(mocks.publicFunctionFetch).not.toHaveBeenCalled();
  });

  it("does not call storage or AI for an integrated transaction", async () => {
    const result = await classifyPagCorpDocuments({
      id: 101,
      ...eligibleTransaction,
      integrated: true,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as unknown as PagCorpTransaction, "EMPRESA", { force: true });

    expect(result.status).toBe("pending");
    expect(mocks.sapFunctionFetch).not.toHaveBeenCalled();
    expect(mocks.publicFunctionFetch).not.toHaveBeenCalled();
  });

  it("does not invoke AI when the server detects an existing integration", async () => {
    mocks.sapFunctionFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ classifications: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        classificationBlocked: true,
        reason: "already_integrated",
      }), { status: 200 }));

    const result = await classifyPagCorpDocuments({
      id: 102,
      ...eligibleTransaction,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as unknown as PagCorpTransaction, "EMPRESA");

    expect(result.status).toBe("pending");
    expect(mocks.sapFunctionFetch).toHaveBeenCalledTimes(2);
    expect(mocks.publicFunctionFetch).not.toHaveBeenCalled();
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
      ...eligibleTransaction,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as unknown as PagCorpTransaction, "EMPRESA");

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
      ...eligibleTransaction,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as unknown as PagCorpTransaction, "EMPRESA");

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Tabela indisponível");
    expect(mocks.publicFunctionFetch).not.toHaveBeenCalled();
    expect(mocks.sapFunctionFetch).toHaveBeenCalledTimes(3);
  });

  it("does not invoke AI when the classification store is unavailable", async () => {
    mocks.sapFunctionFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ classifications: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        classificationStoreUnavailable: true,
        warning: "Store indisponível",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const result = await classifyPagCorpDocuments({
      id: 789,
      ...eligibleTransaction,
      receipts: [{ downloadUrl: "https://example.test/nf.pdf", fileName: "nf.pdf" }],
      attachments: [],
    } as unknown as PagCorpTransaction, "EMPRESA");

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Store indisponível");
    expect(mocks.publicFunctionFetch).not.toHaveBeenCalled();
    expect(mocks.sapFunctionFetch).toHaveBeenCalledTimes(3);
  });
});
