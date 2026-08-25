export interface PagCorpJournalDimensions {
  branchId: number;
  costCenter: string;
  project: string;
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
