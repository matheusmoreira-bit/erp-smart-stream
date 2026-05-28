import { useCallback, useMemo } from "react";
import { useSapCachedList } from "@/hooks/useSapCachedList";

/**
 * Carrega a lista de centros de custo (ProfitCenters) do SAP a partir do cache,
 * expondo um Map code -> name e um helper para formatar como "Nome (código)".
 */
export function useCostCenterNames() {
  const mapRow = useCallback(
    (row: any) => ({ code: row.CenterCode, name: row.CenterName }),
    [],
  );

  const { options, isLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow,
  });

  const nameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) {
      if (o.code) m.set(String(o.code), String(o.name || ""));
    }
    return m;
  }, [options]);

  const formatCostCenter = useCallback(
    (code?: string | null) => {
      const c = (code || "").trim();
      if (!c) return "—";
      const name = nameByCode.get(c);
      return name ? `${name} (${c})` : c;
    },
    [nameByCode],
  );

  return { nameByCode, formatCostCenter, isLoading };
}
