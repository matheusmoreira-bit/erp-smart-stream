import { useMyCapabilities } from "@/hooks/useMyCapabilities";

/**
 * Indica se o usuário pode enxergar/selecionar TODOS os centros de custo no
 * pedido de compra. Capacidade do grupo: `cost_centers_view_all`.
 */
export function useCanSeeAllCostCenters(): { canSeeAll: boolean; loading: boolean } {
  const { has, loading } = useMyCapabilities();
  return { canSeeAll: has("cost_centers_view_all"), loading };
}
