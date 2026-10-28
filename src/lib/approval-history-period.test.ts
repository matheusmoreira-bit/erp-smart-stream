import { describe, it, expect } from "vitest";
import { periodRange, summarizeDecisions } from "./approval-history-period";

const now = new Date("2026-10-28T16:25:00Z");
describe("periodRange (America/Sao_Paulo)", () => {
  it("Este ano começa em 01/01 00:00 de São Paulo", () => {
    expect(periodRange("ytd", {}, now)).toEqual({ from: "2026-01-01T03:00:00.000Z", to: "2026-10-29T02:59:59.999Z" });
  });
  it("Último mês = 30 dias", () => {
    expect(periodRange("30d", {}, now).from).toBe("2026-09-28T03:00:00.000Z");
  });
  it("Personalizado é inclusivo nas duas pontas", () => {
    expect(periodRange("custom", { from: "2026-10-07", to: "2026-10-07" }, now)).toEqual({ from: "2026-10-07T03:00:00.000Z", to: "2026-10-08T02:59:59.999Z" });
  });
  it("Todo o período não limita", () => {
    expect(periodRange("all", {}, now)).toEqual({ from: null, to: null });
  });
});
describe("summarizeDecisions", () => {
  it("conta e soma por moeda", () => {
    const s = summarizeDecisions([
      { decision: "Y", doc_total: 10, currency: "BRL" },
      { decision: "N", doc_total: 5, currency: "USD" },
      { decision: "Y", doc_total: 2, currency: null },
      { decision: "P", doc_total: 99, currency: "BRL" },
    ]);
    expect(s).toEqual({ total: 3, approved: 2, rejected: 1, byCurrency: { BRL: 12, USD: 5 } });
  });
});
