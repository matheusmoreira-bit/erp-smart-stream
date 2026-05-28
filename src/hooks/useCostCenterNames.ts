import { useCallback, useEffect, useMemo, useState } from "react";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { useSap } from "@/contexts/SapContext";
import { sapQuery } from "@/lib/sap-client";

/**
 * Carrega a lista de centros de custo (ProfitCenters) do SAP a partir do cache,
 * expondo um Map code -> name e um helper para formatar como "Nome (código)".
 */
function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

export function useCostCenterNames(requestedCodes?: Iterable<string | null | undefined>) {
  const { session } = useSap();
  const [lookupByCode, setLookupByCode] = useState<Map<string, string>>(new Map());
  const mapRow = useCallback(
    (row: any) => ({ code: row.CenterCode, name: row.CenterName }),
    [],
  );

  const { options, isLoading } = useSapCachedList({
    cacheKey: "cost_centers_all",
    endpoint: "ProfitCenters",
    params: { $select: "CenterCode,CenterName" },
    mapRow,
  });

  const requestedKey = useMemo(() => {
    return Array.from(new Set(Array.from(requestedCodes || []).map((c) => (c || "").trim()).filter(Boolean)))
      .sort()
      .join("|");
  }, [requestedCodes]);

  const nameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) {
      if (o.code) m.set(String(o.code), String(o.name || ""));
    }
    for (const [code, name] of lookupByCode.entries()) {
      if (name) m.set(code, name);
    }
    return m;
  }, [options, lookupByCode]);

  useEffect(() => {
    if (!session || session.erpType !== "sap" || !requestedKey) return;

    const missing = requestedKey
      .split("|")
      .filter((code) => code && !nameByCode.has(code) && !lookupByCode.has(code));

    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(
        missing.map(async (code) => {
          try {
            const { data } = await sapQuery(
              session,
              "ProfitCenters",
              {
                $select: "CenterCode,CenterName",
                $filter: `CenterCode eq '${escapeODataString(code)}'`,
              },
              true,
            );
            const rows = (data as { value?: Array<{ CenterCode?: string; CenterName?: string }> })?.value || [];
            const row = rows[0];
            return { code, name: row?.CenterName || "" };
          } catch {
            return { code, name: "" };
          }
        }),
      );

      if (cancelled) return;
      setLookupByCode((prev) => {
        const next = new Map(prev);
        for (const item of resolved) next.set(item.code, item.name);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [session, requestedKey, nameByCode, lookupByCode]);

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
