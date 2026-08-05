import type { ManagementSegment } from "@/hooks/useManagementSegments";

/**
 * Recorte de projetos por segmento de gestão (ANA Gaming).
 *
 * A trava é uma CAPACIDADE de grupo (`projects_scope_by_segment`): só é
 * aplicada aos grupos que a tenham ligada. O mapeamento abaixo define quais
 * projetos cada segmento enxerga nas bases da ANA Gaming.
 */
export const SEGMENT_PROJECT_CODES: Record<ManagementSegment, string[]> = {
  gestao_1: ["ANA GAMING", "7K"],
  gestao_2: ["VERA", "CASSINO"],
};

/** Bases em que o recorte por segmento vale (ANA Gaming produção e teste). */
const SCOPED_COMPANY_DBS = ["SBO_ANAGAMING", "SBO_TESTE_20260318_ANAGAMING"];

export function isSegmentScopedCompany(companyDb: string | null | undefined): boolean {
  return !!companyDb && SCOPED_COMPANY_DBS.includes(companyDb);
}

function normalize(value: unknown): string {
  return normalizeCompact(value).toUpperCase();
}

/** Filtra a lista de projetos conforme o segmento de gestão do usuário. */
export function filterProjectsBySegment<T extends { code: string; name?: string }>(
  options: T[],
  segment: ManagementSegment,
  companyDb: string | null | undefined,
): T[] {
  if (!isSegmentScopedCompany(companyDb)) return options;
  const allowed = SEGMENT_PROJECT_CODES[segment].map(normalize);
  const filtered = options.filter(
    (o) => allowed.includes(normalize(o.code)) || allowed.includes(normalize(o.name)),
  );
  // Se a base não tiver nenhum dos projetos mapeados, não trava o formulário.
  return filtered.length > 0 ? filtered : options;
}
