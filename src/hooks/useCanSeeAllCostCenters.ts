import { useMyPermissionGroups } from "@/hooks/useMyPermissionGroups";
import { isFullCostCenterGroup } from "@/lib/permission-group-utils";

/**
 * Indica se o usuário logado pode enxergar/selecionar TODOS os centros de custo
 * em qualquer etapa do pedido de compra:
 * - super-usuário SAP / conta "manager" / bases OMIE
 * - admin do Cloud (user_roles.role = 'admin') ou admin no SAP
 * - membro do grupo Facilities (ou grupo Admin)
 */
export function useCanSeeAllCostCenters(): { canSeeAll: boolean; loading: boolean } {
  const { groups, isPrivileged, loading } = useMyPermissionGroups();
  const canSeeAll = isPrivileged || groups.some(isFullCostCenterGroup);
  return { canSeeAll, loading };
}
