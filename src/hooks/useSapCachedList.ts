import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapQueryAll } from "@/lib/sap-client";
import { useSap } from "@/contexts/SapContext";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
// Chaves com atualização mais frequente (dados que mudam com frequência no ERP)
const FIVE_MIN_MS = 5 * 60 * 1000;
const CACHE_TTL_OVERRIDES: Record<string, number> = {
  items_purchase_active_v3: FIVE_MIN_MS,
  items_sales_active_v3: FIVE_MIN_MS,
  items_active_v2: FIVE_MIN_MS,
  suppliers_active_v2: FIVE_MIN_MS,
  customers_active_v2: FIVE_MIN_MS,
};
const getCacheTtlMs = (key: string) => CACHE_TTL_OVERRIDES[key] ?? DEFAULT_CACHE_TTL_MS;

// -----------------------------------------------------------------------------
// Cache invalidation bus
// -----------------------------------------------------------------------------
// Different parts of the app query the same SAP entity through different cache
// keys (ex.: a tela de Fornecedores usa `suppliers:<db>` enquanto o modal de
// criação de pedidos usa `suppliers_active_v2` / `customers_active_v2`). Quando
// um fornecedor é criado/atualizado, precisamos invalidar TODAS as chaves que
// derivam de BusinessPartners naquele companyDB — senão o usuário vê o BP na
// tela de fornecedores mas não no combobox do pedido.
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const listenerKey = (cacheKey: string, companyDb?: string | null) =>
  `${cacheKey}::${companyDb || ""}`;

function subscribe(cacheKey: string, companyDb: string | null | undefined, cb: Listener) {
  const key = listenerKey(cacheKey, companyDb);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(key);
  };
}

/**
 * Invalidate one or more SAP cached lists: deletes the persisted rows in
 * `sap_cache` and forces every mounted `useSapCachedList` with a matching
 * cacheKey/companyDb to refetch from SAP.
 */
export async function invalidateSapCache(
  cacheKeys: string | string[],
  companyDb?: string | null,
) {
  const keys = Array.isArray(cacheKeys) ? cacheKeys : [cacheKeys];
  // Best-effort DB cleanup — errors here shouldn't block the UI signal.
  try {
    let q = supabase.from("sap_cache").delete().in("cache_key", keys);
    if (companyDb) q = q.eq("company_db", companyDb);
    await q;
  } catch (e) {
    console.warn("invalidateSapCache: failed to purge sap_cache rows", e);
  }
  // Fire in-memory listeners so mounted hooks reload immediately.
  for (const k of keys) {
    const set = listeners.get(listenerKey(k, companyDb));
    if (set) for (const cb of set) cb();
    // Also broadcast to listeners that didn't scope by companyDb (rare).
    if (companyDb) {
      const globalSet = listeners.get(listenerKey(k, null));
      if (globalSet) for (const cb of globalSet) cb();
    }
  }
}

interface UseSapCachedListParams {
  cacheKey: string;
  endpoint: string;
  params?: Record<string, string | number>;
  mapRow: (row: any) => SapSearchOption;
  enabled?: boolean;
}

export function useSapCachedList({
  cacheKey,
  endpoint,
  params,
  mapRow,
  enabled = true,
}: UseSapCachedListParams) {
  const { session } = useSap();
  const [options, setOptions] = useState<SapSearchOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const loadedRef = useRef(false);
  const mapRowRef = useRef(mapRow);
  mapRowRef.current = mapRow;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const load = useCallback(async (forceRefresh = false) => {
    if (!enabled || (!forceRefresh && loadedRef.current)) return;
    setIsLoading(true);
    loadedRef.current = true;

    try {
      const companyDB = session?.companyDB;
      // 1. Try Supabase cache first — REQUIRE company_db to avoid leaking
      //    cached data from another company's SAP base.
      if (!forceRefresh && companyDB) {
        const cacheQuery = supabase
          .from("sap_cache")
          .select("data, expires_at")
          .eq("cache_key", cacheKey)
          .eq("company_db", companyDB)
          .order("updated_at", { ascending: false })
          .limit(1);

        const { data: cached } = await cacheQuery.maybeSingle();

        if (cached) {
          let cachedData = cached.data as any[];
          const isExpired = new Date(cached.expires_at) <= new Date();

          if (cachedData && cachedData.length > 0) {
            if (endpoint === "CostCenters" || endpoint === "ProfitCenters") {
              cachedData = cachedData.filter(
                (r: any) => !String(r?.CenterCode || "").startsWith("Centr_"),
              );
            }
            setOptions(cachedData.map(mapRowRef.current));

            // If cache is still valid or no SAP session to refresh, stop here
            if (!isExpired || !session) {
              setIsLoading(false);
              return;
            }
          }
        }
      }

      // 2. If no cache hit (or expired/forced) and we have a SAP session, fetch from SAP
      if (!session || session.erpType !== "sap" || !companyDB) {
        setIsLoading(false);
        return;
      }

      const { data } = await sapQueryAll(session, endpoint, paramsRef.current, false);
      let rows: any[] = data?.value || [];
      // Filtra centros de custo auto-gerados pelo SAP (prefixo "Centr_")
      if (endpoint === "CostCenters" || endpoint === "ProfitCenters") {
        rows = rows.filter((r: any) => !String(r?.CenterCode || "").startsWith("Centr_"));
      }

      // 3. Only cache non-empty results
      if (rows.length > 0) {
        const expiresAt = new Date(Date.now() + getCacheTtlMs(cacheKey)).toISOString();
        await supabase
          .from("sap_cache")
          .upsert(
            {
              cache_key: cacheKey,
              company_db: companyDB,
              data: rows as any,
              expires_at: expiresAt,
            },
            { onConflict: "cache_key,company_db" }
          );
      }

      setOptions(rows.map(mapRowRef.current));
    } catch (e) {
      console.error(`Failed to load cached list [${cacheKey}]:`, e);
    } finally {
      setIsLoading(false);
    }
  }, [session?.sessionId, session?.companyDB, enabled, cacheKey, endpoint]);

  // Reset loaded flag when session changes
  useEffect(() => {
    loadedRef.current = false;
  }, [session?.sessionId, session?.companyDB, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => {
    loadedRef.current = false;
    load(true);
  }, [load]);

  return { options, isLoading, reload };
}
