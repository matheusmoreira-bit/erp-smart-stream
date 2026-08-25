import { describe, expect, it } from "vitest";

import { applyPagCorpJournalDimensions } from "../../supabase/functions/_shared/pagcorp-journal-entry";

describe("applyPagCorpJournalDimensions", () => {
  it("applies cost center and project to debit and credit lines", () => {
    const lines = applyPagCorpJournalDimensions([
      { AccountCode: "1.1.01", Debit: 100 },
      { AccountCode: "2.1.01", Credit: 100 },
    ], {
      branchId: 1,
      costCenter: "ADM",
      project: "ANA",
    });

    expect(lines).toEqual([
      { AccountCode: "1.1.01", Debit: 100, BPLID: 1, CostingCode: "ADM", ProjectCode: "ANA" },
      { AccountCode: "2.1.01", Credit: 100, BPLID: 1, CostingCode: "ADM", ProjectCode: "ANA" },
    ]);
  });
});
