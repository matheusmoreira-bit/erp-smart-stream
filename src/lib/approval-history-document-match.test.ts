import { describe, expect, it } from "vitest";
import { identityIndex, isEmptyDecision, matchDocumentDecisions } from "../../supabase/functions/approval-history-sync/document-reconciliation";
import { historyDocumentLabel } from "./approval-history-documents";
import type { ApprovalHistoryRow } from "@/hooks/useApprovalHistory";

const index = identityIndex([{ user_key: "dv", display_name: "Douglas Vinicius", sap_user_code: "douglas.vinicius" }],
  [{ user_key: "dv", email: "douglas.vinicius@anagaming.com.br" }]);
const hana = (draft: number, po: number, day: string, total = 14284.25, card = "PORTNET LTDA") => ({
  external_id: `hana::E${draft}::dv`, company_db: "SBO_ANAGAMING", decision: "Y", card_name: card, doc_total: total,
  doc_num: po, doc_entry: draft, requester_name: "Thiago Moreira", approver_name: "Douglas Vinicius",
  decision_date: `${day}T00:00:00.000Z`, raw: { source: "hana_view", identity_key: "dv", draft_entry: draft, po_doc_num: po },
});
const audit = (day = "2026-08-14T18:00:00Z", extra: Record<string, unknown> = {}) => ({
  external_id: "9001::douglas.vinicius@anagaming.com.br", company_db: "SBO_ANAGAMING", decision: "Y", card_name: "Portnet Ltda.",
  doc_total: 14284.255, currency: "BRL", doc_num: null, approver_email: "douglas.vinicius@anagaming.com.br", decision_date: day,
  raw: { source: "audit_log", docNum: 7999 }, ...extra,
});

describe("conciliação por documento", () => {
  it("concilia com candidata única até 15 dias depois, mantendo horário do audit", () => {
    const { writes, counts } = matchDocumentDecisions([audit(), hana(8729, 8269, "2026-08-19")], index);
    const row = writes.find(w => String(w.external_id).startsWith("9001"))!;
    expect(counts.audit_matched).toBe(1);
    expect(row.doc_num).toBe(8269);
    expect(row.doc_entry).toBe(8729);
    expect(row.decision_date).toBe("2026-08-14T18:00:00Z");
    expect((writes.find(w => String(w.external_id).startsWith("hana"))!.raw as Record<string, unknown>).superseded_by).toBe("audit_document_match");
  });
  it("não concilia após 16 dias", () => {
    expect(matchDocumentDecisions([audit(), hana(8729, 8269, "2026-08-30")], index).counts.audit_matched).toBe(0);
  });
  it("mantém não identificado com duas candidatas", () => {
    const r = matchDocumentDecisions([audit(), hana(8729, 8269, "2026-08-19"), hana(8730, 8270, "2026-08-20")], index);
    expect(r.counts.audit_matched).toBe(0);
  });
  it("valor fora da tolerância de 0,01 não concilia em BRL", () => {
    expect(matchDocumentDecisions([audit(), hana(8729, 8269, "2026-08-19", 14284.3)], index).counts.audit_matched).toBe(0);
  });
  it("moeda estrangeira aceita o total HANA em BRL", () => {
    const usd = audit("2026-08-06T18:36:00Z", { card_name: "TWILIO INS", doc_total: 3000, currency: "USD" });
    expect(matchDocumentDecisions([usd, hana(8690, 8004, "2026-08-06", 15346.2, "TWILIO INS")], index).counts.audit_matched).toBe(1);
  });
  it("une webhook e Approval Hub do mesmo pedido e concilia com HANA", () => {
    const base = { company_db: "SBO_ANAGAMING", decision: "Y", card_name: "PORTNET LTDA", doc_total: 14284.25, approver_email: "douglas.vinicius@anagaming.com.br", decision_date: "2026-08-14T11:10:00Z", raw: {} };
    const r = matchDocumentDecisions([{ ...base, external_id: "7594::douglas.vinicius@anagaming.com.br", currency: null, doc_num: 6318 },
      { ...base, external_id: "7594-82-20", currency: "R$", doc_num: 6434 }, hana(8729, 8269, "2026-08-19")], index);
    expect(r.counts.legacy_same_request).toBe(1);
    expect(r.counts.legacy_matched).toBe(1);
    const kept = r.writes.find(w => w.external_id === "7594::douglas.vinicius@anagaming.com.br")!;
    expect(kept.doc_num).toBe(8269);
    expect(kept.currency).toBe("BRL");
  });
  it("linha audit sem fornecedor, valor e número é vazia", () => {
    expect(isEmptyDecision({ card_name: null, doc_total: 0, raw: { source: "audit_log" } })).toBe(true);
    expect(isEmptyDecision(audit())).toBe(false);
  });
  it("legado sem candidata exibe Esboço, nunca Pedido", () => {
    const row = { source: "sap", doc_num: 6318, raw: {}, po_doc_num: null, draft_entry: null } as unknown as ApprovalHistoryRow;
    expect(historyDocumentLabel(row)).toBe("Esboço #6318");
  });
});
