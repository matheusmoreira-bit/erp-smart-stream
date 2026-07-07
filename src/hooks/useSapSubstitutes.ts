import { useCallback, useEffect, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import {
  fetchSapSubstitutes,
  invalidateSapSubstitutesCache,
  type SapSubstituteRow,
} from "@/lib/sap-substitutes";

interface State {
  rows: SapSubstituteRow[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  updatedAt: string | null;
  fromCache: boolean;
  stale: boolean;
  warning: string | null;
}

/**
 * Consome a view SAP `VW_AG_APROVADORES_SUBSTITUTOS` normalizada.
 * Estratégia: cache 5min + stale fallback em caso de falha do middleware.
 */
export function useSapSubstitutes() {
  const { session } = useSap();
  const [state, setState] = useState<State>({
    rows: [],
    isLoading: true,
    isRefreshing: false,
    error: null,
    updatedAt: null,
    fromCache: false,
    stale: false,
    warning: null,
  });

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (!session || session.erpType !== "sap") {
      setState((s) => ({ ...s, rows: [], isLoading: false, isRefreshing: false }));
      return;
    }
    setState((s) => ({
      ...s,
      isLoading: s.rows.length === 0,
      isRefreshing: true,
      error: null,
    }));
    try {
      const res = await fetchSapSubstitutes(session, opts);
      setState({
        rows: res.rows,
        isLoading: false,
        isRefreshing: false,
        error: null,
        updatedAt: res.updatedAt,
        fromCache: res.fromCache,
        stale: res.stale,
        warning: res.warning ?? null,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        isLoading: false,
        isRefreshing: false,
        error: e instanceof Error ? e.message : "Falha ao consultar substitutos no SAP",
      }));
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const invalidate = useCallback(() => {
    if (session) invalidateSapSubstitutesCache(session);
  }, [session]);

  return {
    ...state,
    refresh: (force = true) => load({ force }),
    invalidate,
  };
}

/**
 * Retorna apenas as substituições ATIVAS agora (dentro da vigência e com
 * flag active=true) apontando o `substituteIdentifier` fornecido como
 * substituto do titular. Útil para hidratar o seletor "atuar como".
 */
export function filterActiveNow(
  rows: SapSubstituteRow[],
  now: Date = new Date(),
): SapSubstituteRow[] {
  const ts = now.getTime();
  return rows.filter((r) => {
    if (!r.active) return false;
    const from = r.validFrom ? Date.parse(r.validFrom) : Number.NEGATIVE_INFINITY;
    const to = r.validTo ? Date.parse(r.validTo) : Number.POSITIVE_INFINITY;
    return ts >= from && ts <= to;
  });
}
