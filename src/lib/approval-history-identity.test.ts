import { describe, expect, it } from "vitest";
import { approvalHistoryIdentityKeys, matchesApprovalHistoryIdentity } from "./approval-history-identity";

const keys = approvalHistoryIdentityKeys(" Douglas Goncalves ", "douglas.vinicius@anagaming.com.br", [{
  user_key: "douglasvinicius", sap_user_code: "douglas.vinicius", display_name: "Douglas Vinicius",
  is_active: true, emails: ["douglas.vinicius@anagaming.com.br", "douglas.v@cactusgaming.net"],
}]);

describe("Approval History personal identity", () => {
  it("includes Cloud email, local part, SAP code, directory name and aliases", () => {
    expect([...keys]).toEqual(expect.arrayContaining([
      "douglas goncalves", "douglas.vinicius@anagaming.com.br", "douglas.vinicius",
      "douglas vinicius", "douglas.v@cactusgaming.net", "douglas.v",
    ]));
  });
  it("matches approver email across domains", () => {
    expect(matchesApprovalHistoryIdentity(keys, [" Douglas.Vinicius@growth.gg "])).toBe(true);
  });
  it("matches SAP approver code and directory name", () => {
    expect(matchesApprovalHistoryIdentity(keys, ["douglas.vinicius"])).toBe(true);
    expect(matchesApprovalHistoryIdentity(keys, ["Douglas Vinicius"])).toBe(true);
  });
  it("does not include another user's decisions", () => {
    expect(matchesApprovalHistoryIdentity(keys, ["douglas.ferreira@anagaming.com.br", "Douglas Ferreira"])).toBe(false);
  });
});