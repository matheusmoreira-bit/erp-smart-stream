import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapQueryAll } from "@/lib/sap-client";
import { useSap } from "@/contexts/SapContext";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

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
      // 1. Try Supabase cache first (works without SAP session), unless forced refresh
      if (!forceRefresh) {
        let cacheQuery = supabase
          .from("sap_cache")
          .select("data, expires_at")
          .eq("cache_key", cacheKey)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (companyDB) cacheQuery = cacheQuery.eq("company_db", companyDB);

        const { data: cached } = await cacheQuery.maybeSingle();

        if (cached) {
          const cachedData = cached.data as any[];
          const isExpired = new Date(cached.expires_at) <= new Date();

          if (cachedData && cachedData.length > 0) {
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
      if (!session || session.erpType !== "sap") {
        setIsLoading(false);
        return;
      }

      const companyDB = session.companyDB;
      const { data } = await sapQueryAll(session, endpoint, paramsRef.current, false);
      const rows = data?.value || [];

      // 3. Only cache non-empty results
      if (rows.length > 0) {
        const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
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
