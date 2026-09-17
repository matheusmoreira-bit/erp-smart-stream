/**
 * Telas que não existem em determinados ERPs.
 *
 * O Omie não possui a parte contábil nem o fluxo de NF de Entrada/reconciliação
 * de adiantamentos do SAP B1 — essas telas ficam escondidas e bloqueadas para
 * empresas que rodam sobre o Omie.
 */
const ERP_DENIED_PATHS: Record<string, string[]> = {
  omie: [
    "/financeiro/nf-entrada",
    "/financeiro/reconciliacao",
  ],
};

export function normalizeErpType(erpType?: string | null): string {
  return String(erpType || "").trim().toLowerCase();
}

/** true quando a rota não existe para o ERP informado. */
export function isPathDeniedForErp(path: string, erpType?: string | null): boolean {
  const denied = ERP_DENIED_PATHS[normalizeErpType(erpType)];
  if (!denied || !path) return false;
  const clean = path.split("?")[0];
  return denied.some((base) => clean === base || clean.startsWith(`${base}/`));
}

/** Filtra uma lista de itens de navegação pelas telas suportadas pelo ERP. */
export function filterPathsForErp<T extends { path: string }>(
  items: T[],
  erpType?: string | null,
): T[] {
  return items.filter((item) => !isPathDeniedForErp(item.path, erpType));
}

/** O ERP suporta lançamento contábil manual (LCM)? O Omie não. */
export function erpSupportsJournalEntry(erpType?: string | null): boolean {
  return normalizeErpType(erpType) !== "omie";
}
