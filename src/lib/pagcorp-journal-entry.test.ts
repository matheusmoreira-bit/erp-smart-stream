import { describe, expect, it } from "vitest";

import {
  applyPagCorpJournalDimensions,
  buildPagCorpJournalTransactionPairs,
} from "../../supabase/functions/_shared/pagcorp-journal-entry";

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

  it("creates an independent debit and credit pair for every transaction", () => {
    const lines = buildPagCorpJournalTransactionPairs([
      { amount: 75, lineMemo: "Transação 1", costCenter: "CC-1", project: "PR-1" },
      { amount: 125, lineMemo: "Transação 2", costCenter: "CC-2", project: "PR-2" },
    ], {
      branchId: 1,
      debitAccount: "4.2.2.03",
      creditAccount: "1.1.1.02",
    });

    expect(lines).toEqual([
      { AccountCode: "4.2.2.03", LineMemo: "Transação 1", Debit: 75, BPLID: 1, CostingCode: "CC-1", ProjectCode: "PR-1" },
      { AccountCode: "1.1.1.02", LineMemo: "Transação 1", Credit: 75, BPLID: 1, CostingCode: "CC-1", ProjectCode: "PR-1" },
      { AccountCode: "4.2.2.03", LineMemo: "Transação 2", Debit: 125, BPLID: 1, CostingCode: "CC-2", ProjectCode: "PR-2" },
      { AccountCode: "1.1.1.02", LineMemo: "Transação 2", Credit: 125, BPLID: 1, CostingCode: "CC-2", ProjectCode: "PR-2" },
    ]);
  });

  it("keeps foreign currency values balanced per transaction", () => {
    const lines = buildPagCorpJournalTransactionPairs([
      { amount: 49.9, currency: "USD", lineMemo: "USD", costCenter: "CC", project: "PR" },
    ], {
      branchId: 2,
      debitAccount: "D",
      creditAccount: "C",
    });

    expect(lines[0]).toMatchObject({ FCDebit: 49.9, FCCurrency: "USD" });
    expect(lines[1]).toMatchObject({ FCCredit: 49.9, FCCurrency: "USD" });
    expect(lines[0].CostingCode).toBe(lines[1].CostingCode);
    expect(lines[0].ProjectCode).toBe(lines[1].ProjectCode);
  });
});
