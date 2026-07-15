/** Regex de bases de teste (a serem excluídas de análises de ROI/uso). */
export const TEST_COMPANY_DB_RE = /^(SBO_TESTE_|TST[_-]?)/i;

export function isTestCompanyDb(db: string | null | undefined): boolean {
  if (!db) return false;
  return TEST_COMPANY_DB_RE.test(db);
}
