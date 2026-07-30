import { useMyPermissionGroups } from "@/hooks/useMyPermissionGroups";
import { useCurrentUserCostCenter, costCenterBranch } from "@/hooks/useCurrentUserCostCenter";
import { isDirectorateGroup } from "@/lib/permission-group-utils";

export interface DirectorateScope {
  /** Diretoria visível (CC de 2º nível, ex.: "1.6") ou null. */
  branch: string | null;
  /** True quando o usuário pertence ao grupo "Usuário Administrativo". */
  isDirectorateUser: boolean;
  loading: boolean;
  /** Um centro de custo pertence à diretoria do usuário? */
  matches: (costCenter: string | null | undefined) => boolean;
}

/**
 * Escopo do grupo "Usuário Administrativo": vê todos os documentos (compras e
 * aprovações) da própria diretoria — o centro de custo de 2º nível informado
 * pelo IdP (1.6.1.2 → 1.6.%).
 *
 * Sem centro de custo no IdP, `branch` fica null e o usuário continua vendo
 * apenas os próprios documentos (mesmo comportamento do grupo "Usuário").
 */
export function useDirectorateScope(): DirectorateScope {
  const { groups, isPrivileged, loading: loadingGroups } = useMyPermissionGroups();
  const { costCenter, loading: loadingCc } = useCurrentUserCostCenter();

  const isDirectorateUser = !isPrivileged && groups.some((g) => isDirectorateGroup(g));
  const branch = isDirectorateUser ? costCenterBranch(costCenter) : null;

  const matches = (cc: string | null | undefined) => {
    if (!branch) return false;
    const v = String(cc || "").trim();
    if (!v) return false;
    return v === branch || v.startsWith(`${branch}.`);
  };

  return { branch, isDirectorateUser, loading: loadingGroups || loadingCc, matches };
}
