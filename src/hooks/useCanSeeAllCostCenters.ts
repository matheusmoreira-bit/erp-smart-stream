import { useMyPermissionGroups } from "@/hooks/useMyPermissionGroups";
import { isBasicGroup, isDirectorateGroup, isFullCostCenterGroup } from "@/lib/permission-group-utils";

/**
 * Indica se o usuário logado pode enxergar/selecionar TODOS os centros de custo
 * em qualquer etapa do pedido de compra:
 * - super-usuário SAP / conta "manager" / bases OMIE
 * - admin do Cloud (user_roles.role = 'admin') ou admin no SAP
 * - qualquer grupo que não seja o básico "Usuário" (Facilities, Contábil,
 *   Fiscal, Financeiro, Contas a Pagar, CFO...), mesma regra usada para
 *   visibilidade de documentos.
 */
export function useCanSeeAllCostCenters(): { canSeeAll: boolean; loading: boolean } {
  const { groups, isPrivileged, loading } = useMyPermissionGroups();
  const canSeeAll =
    isPrivileged ||
    groups.some((g) => isFullCostCenterGroup(g) || (!isBasicGroup(g) && !isDirectorateGroup(g)));
  return { canSeeAll, loading };
}

