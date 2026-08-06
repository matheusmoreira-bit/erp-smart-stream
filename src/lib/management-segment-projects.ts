import type { ManagementSegment } from "@/hooks/useManagementSegments";
import { normalizeCompact } from "@/lib/text-normalize";

/**
 * Recorte de projetos por segmento de gestão (ANA Gaming).
 *
 * A trava é uma CAPACIDADE de grupo (`projects_scope_by_segment`): só é
 * aplicada aos grupos que a tenham ligada. O mapeamento abaixo define quais
 * projetos cada segmento enxerga nas bases da ANA Gaming.
 */
export const SEGMENT_PROJECT_CODES: Record<ManagementSegment, string[] | null> = {
  gestao_1: ["7K"],
  gestao_2: ["VERA", "CASSINO"],
  // CSC atende todas as frentes: sem recorte de projetos.
  csc: null,
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
  const codes = SEGMENT_PROJECT_CODES[segment];
  if (!codes) return options;
  const allowed = codes.map(normalize);
  const filtered = options.filter(
    (o) => allowed.includes(normalize(o.code)) || allowed.includes(normalize(o.name)),
  );
  // Se a base não tiver nenhum dos projetos mapeados, não trava o formulário.
  return filtered.length > 0 ? filtered : options;
}

/**
 * Projetos institucionais (homônimos às empresas do grupo). Em centros de
 * custo operacionais eles não devem ser usados — o lançamento pertence ao
 * projeto de negócio, não à holding.
 */
export const INSTITUTIONAL_PROJECT_CODES = ["ANA GAMING", "CACTUS", "OPEN GAMING"];

/** Prefixos de centro de custo considerados operacionais (todas as empresas). */
const OPERATIONAL_CC_PREFIXES = ["1.8.", "1.9.", "1.10.", "1.11."];

export function isOperationalCostCenter(code: string | null | undefined): boolean {
  const raw = String(code ?? "").trim();
  if (!raw) return false;
  return OPERATIONAL_CC_PREFIXES.some((p) => raw.startsWith(p));
}

function isInstitutionalProject(option: { code: string; name?: string }): boolean {
  const codes = INSTITUTIONAL_PROJECT_CODES.map(normalize);
  return codes.includes(normalize(option.code)) || codes.includes(normalize(option.name));
}

/**
 * Em CC operacional (1.8/1.9/1.10/1.11), esconde os projetos institucionais
 * para quem não é do segmento CSC. Vale para todas as empresas.
 */
export function filterInstitutionalProjects<T extends { code: string; name?: string }>(
  options: T[],
  segment: ManagementSegment,
  costCenterCode: string | null | undefined,
): T[] {
  if (segment === "csc") return options;
  if (!isOperationalCostCenter(costCenterCode)) return options;
  const filtered = options.filter((o) => !isInstitutionalProject(o));
  // Nunca deixa a lista vazia (base sem outros projetos cadastrados).
  return filtered.length > 0 ? filtered : options;
}

