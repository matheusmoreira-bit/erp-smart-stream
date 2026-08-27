export interface PagCorpJournalDimensions {
  branchId: number;
  costCenter: string;
  project: string;
}

export interface PagCorpJournalTransactionPair {
  amount: number;
  currency?: string | null;
  lineMemo: string;
  costCenter: string;
  project: string;
  /** Cotação (PTAX) aplicada quando a linha é em moeda estrangeira. */
  exchangeRate?: number | null;
}

export interface PagCorpJournalLine {
  AccountCode: string;
  LineMemo: string;
  BPLID: number;
  CostingCode: string;
  ProjectCode: string;
  Debit?: number;
  Credit?: number;
  FCDebit?: number;
  FCCredit?: number;
  FCCurrency?: string;
  Rate?: number;
}


export function applyPagCorpJournalDimensions<T extends Record<string, unknown>>(
  lines: T[],
  dimensions: PagCorpJournalDimensions,
): Array<T & { BPLID: number; CostingCode: string; ProjectCode: string }> {
  return lines.map((line) => ({
    ...line,
    BPLID: dimensions.branchId,
    CostingCode: dimensions.costCenter,
    ProjectCode: dimensions.project,
  }));
}

export function buildPagCorpJournalTransactionPairs(
  transactions: PagCorpJournalTransactionPair[],
  options: {
    branchId: number;
    debitAccount: string;
    creditAccount: string;
    localCurrency?: string;
  },
): PagCorpJournalLine[] {
  const localCurrency = String(options.localCurrency || "BRL").toUpperCase();

  return transactions.flatMap((transaction) => {
    const currency = String(transaction.currency || localCurrency).toUpperCase();
    const isForeignCurrency = currency !== localCurrency && /^[A-Z]{3}$/.test(currency);
    const dimensions = {
      branchId: options.branchId,
      costCenter: transaction.costCenter,
      project: transaction.project,
    };

    return applyPagCorpJournalDimensions([
      {
        AccountCode: options.debitAccount,
        LineMemo: transaction.lineMemo,
        ...(isForeignCurrency
          ? { FCDebit: transaction.amount, FCCurrency: currency }
          : { Debit: transaction.amount }),
      },
      {
        AccountCode: options.creditAccount,
        LineMemo: transaction.lineMemo,
        ...(isForeignCurrency
          ? { FCCredit: transaction.amount, FCCurrency: currency }
          : { Credit: transaction.amount }),
      },
    ], dimensions) as PagCorpJournalLine[];
  });
}
