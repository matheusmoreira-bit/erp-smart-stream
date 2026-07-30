import { useMyCapabilities } from "@/hooks/useMyCapabilities";
import { useCurrentUserCostCenter, costCenterBranch } from "@/hooks/useCurrentUserCostCenter";

export interface DirectorateScope {
  /** Diretoria visível (CC de 2º nível, ex.: "1.6") ou null. */
  branch: string | null;
  /** True quando o grupo tem a capacidade "ver documentos da própria diretoria". */
  isDirectorateUser: boolean;
  loading: boolean;
  /** Um centro de custo pertence à diretoria do usuário? */
  matches: (costCenter: string | null | undefined) => boolean;
}

/**
 * Escopo por diretoria — capacidade do grupo `documents_view_directorate`.
 * O recorte é o centro de custo de 2º nível informado pelo IdP (1.6.1.2 → 1.6.%).
 * Sem CC no IdP, `branch` fica null e o usuário continua vendo só os próprios.
 */
export function useDirectorateScope(): DirectorateScope {
  const { has, isPrivileged, capabilities, loading: loadingGroups } = useMyCapabilities();
  const { costCenter, loading: loadingCc } = useCurrentUserCostCenter();

  // Visão total prevalece sobre o recorte por diretoria.
  const isDirectorateUser =
    !isPrivileged &&
    capabilities.has("documents_view_directorate") &&
    !capabilities.has("expenses_view_all") &&
    !capabilities.has("approvals_view_all");
  void has;
  const branch = isDirectorateUser ? costCenterBranch(costCenter) : null;

  const matches = (cc: string | null | undefined) => {
    if (!branch) return false;
    const v = String(cc || "").trim();
    if (!v) return false;
    return v === branch || v.startsWith(`${branch}.`);
  };

  return { branch, isDirectorateUser, loading: loadingGroups || loadingCc, matches };
}
