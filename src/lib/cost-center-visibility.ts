/**
 * Regra de visibilidade de centros de custo LOTUS.
 *
 * Centros de custo cujo código ou nome contenham "LOTUS" só podem ser
 * visualizados/selecionados por usuários dos grupos Contábil, RH/DP/Folha
 * (grupo "Gente e Gestão"), CFO e Admin. Admins/super-usuário do sistema
 * seguem vendo tudo.
 */

import { normalizeText } from "@/lib/text-normalize";

/** Grupos autorizados (comparação normalizada, sem acento/caixa). */
export const LOTUS_ALLOWED_GROUPS = ["Admin", "CFO", "Contábil", "Gente e Gestão"];

/** Aliases aceitos para os grupos autorizados (nomes variam por base). */
const ALLOWED_GROUP_TOKENS = [
  "admin",
  "administrador",
  "cfo",
  "contabil",
  "contabilidade",
  "gente e gestao",
  "rh",
  "dp",
  "folha",
  "pessoas e cultura",
];

export function isLotusCostCenter(code?: string | null, name?: string | null): boolean {
  const hay = `${code ?? ""} ${name ?? ""}`;
  return normalizeText(hay).includes("lotus");
}

export function canViewLotusCostCenters(
  groups: string[] | null | undefined,
  isPrivileged = false,
  opts?: { hasCapability?: boolean; loading?: boolean },
): boolean {
  // Enquanto grupos/capacidades carregam, não escondemos nada (evita falso
  // negativo: o usuário autorizado abria o formulário sem os CCs LOTUS).
  if (opts?.loading) return true;
  if (isPrivileged) return true;
  // Fonte principal: capacidade configurada no grupo.
  if (opts?.hasCapability) return true;
  return (groups || []).some((g) => {
    const n = normalizeText(g);
    return ALLOWED_GROUP_TOKENS.some(
      (t) => n === t || new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(n),
    );
  });
}


/** Remove opções LOTUS quando o usuário não tem direito de vê-las. */
export function filterLotusCostCenters<T extends { code?: string | null; name?: string | null }>(
  options: T[],
  allowed: boolean,
): T[] {
  if (allowed) return options;
  return options.filter((o) => !isLotusCostCenter(o.code, o.name));
}
