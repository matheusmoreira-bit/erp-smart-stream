import { describe, expect, it } from "vitest";
import { enrichAudit, identityIndex, reconcileDecisions, splitHanaPeople, uniqueHanaMatch } from "../../supabase/functions/approval-history-sync/document-reconciliation";
const index = identityIndex([
  { user_key: "dv", display_name: "Douglas Vinicius", sap_user_code: "douglas.vinicius" },
  { user_key: "df", display_name: "Douglas Ferreira", sap_user_code: "douglas.ferreira" },
], [{ user_key: "dv", email: "douglas.vinicius@anagaming.com.br" }, { user_key: "df", email: "douglas.ferreira@anagaming.com.br" }]);
const hana = { company_db: "SBO_ANAGAMING", external_id: "hana::E8682::both", doc_entry: 8682, doc_num: 7974, doc_object_type: "22", card_name: "GAMIFY TECH BRASIL LTDA", doc_total: 133271.05,
  requester_name: "Thiago Moreira", approver_name: "Douglas Ferreira, Douglas Vinicius", decision: "Y", decision_date: "2026-08-05T11:21:00Z", raw: { source: "hana_view" } };
const audit = { ...hana, external_id: "8964::douglas.vinicius", doc_entry: null, doc_num: 7952, requester_name: null, approver_name: "Douglas Vinicius", approver_email: "douglas.vinicius", raw: { source: "audit_log", docNum: 7952 } };
describe("SAP historical document reconciliation", () => {
  it("does not expand an already split person back to all document approvers", () => {
    const first = splitHanaPeople({ ...hana, raw: { source: "hana_view", "Aprovador(es)": "Douglas Ferreira, Douglas Vinicius" } }, index);
    expect(splitHanaPeople(first[1], index)).toHaveLength(1);
    expect(splitHanaPeople(first[1], index)[0].approver_name).toBe("Douglas Vinicius");
  });
  it("corrects 8964 Gamify to final order 7974, draft 8682 and Thiago Moreira", () => {
    const result = enrichAudit(audit, uniqueHanaMatch(audit, [hana]), { draftEntry: 8682 });
    expect([result.doc_num, result.doc_entry, result.requester_name]).toEqual([7974, 8682, "Thiago Moreira"]);
    expect(result.approver_email).toBe("douglas.vinicius");
  });
  it("keeps two distinct approvers and removes only the duplicated Vinicius HANA decision", () => {
    const result = reconcileDecisions([enrichAudit(audit, hana), hana], index);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.approver_name).sort()).toEqual(["Douglas Ferreira", "Douglas Vinicius"]);
  });
  it("resolves exact individual HANA names without assigning a document time", () => {
    const people = splitHanaPeople(hana, index);
    expect(people.map(p => p.approver_email)).toEqual(["douglas.ferreira@anagaming.com.br", "douglas.vinicius@anagaming.com.br"]);
    expect(people[1].decision_date).toBe("2026-08-05T00:00:00.000Z");
    expect(people[1].raw).toMatchObject({ decision_precision: "document" });
  });
  it("never treats provisional draft number 7952 as a final order", () => {
    expect(enrichAudit(audit, null).doc_num).toBeNull();
  });
  it("does not match ambiguous supplier amount date candidates", () => {
    expect(uniqueHanaMatch(audit, [hana, { ...hana, doc_entry: 9999, doc_num: 8000 }])).toBeNull();
  });
  it("limits fallback to the same company and plus or minus one day", () => {
    expect(uniqueHanaMatch(audit, [{ ...hana, company_db: "SBO_CACTUS" }])).toBeNull();
    expect(uniqueHanaMatch(audit, [{ ...hana, decision_date: "2026-08-07T00:00:00Z" }])).toBeNull();
    expect(uniqueHanaMatch(audit, [{ ...hana, decision_date: "2026-08-06T00:00:00Z" }])?.doc_num).toBe(7974);
  });
  it("does not merge a rejection into an approval", () => {
    expect(reconcileDecisions([enrichAudit({ ...audit, decision: "N" }, hana), hana], index)).toHaveLength(3);
  });
  it("keeps actual substitute actor and suppresses only the official's duplicated document decision", () => {
    const substitute = enrichAudit({ ...audit, approver_name: "Marco", approver_email: "marco@example.test", raw: { source: "audit_log", actedAsSubstitute: true, substitutedForEmail: "douglas.vinicius@anagaming.com.br" } }, hana);
    const rows = reconcileDecisions([substitute, hana], index);
    expect(rows).toHaveLength(2);
    expect(rows[0].approver_email).toBe("marco@example.test");
  });
  it("does not assign an ambiguous directory name an email", () => {
    const ambiguous = identityIndex([{ user_key: "a", display_name: "Same" }, { user_key: "b", display_name: "Same" }], []);
    expect(splitHanaPeople({ ...hana, approver_name: "Same" }, ambiguous)[0].approver_email).toBeNull();
  });
});