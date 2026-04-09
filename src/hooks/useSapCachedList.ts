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

  const paramsKey = JSON.stringify(params || {});

  const load = useCallback(async () => {
    if (!session || !enabled || loadedRef.current) return;
    const companyDB = session.companyDB;
    setIsLoading(true);
    loadedRef.current = true;

    try {
      // 1. Check Supabase cache
      const { data: cached } = await supabase
        .from("sap_cache")
        .select("data, expires_at")
        .eq("cache_key", cacheKey)
        .eq("company_db", companyDB)
        .maybeSingle();

      if (cached && new Date(cached.expires_at) > new Date()) {
        const items = (cached.data as any[]).map(mapRowRef.current);
        setOptions(items);
        setIsLoading(false);
        return;
      }

      // 2. Fetch from SAP
      const { data } = await sapQueryAll(session, endpoint, params, false);
      const rows = data?.value || [];

      // 3. Store in cache
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

      setOptions(rows.map(mapRowRef.current));
    } catch (e) {
      console.error(`Failed to load cached list [${cacheKey}]:`, e);
    } finally {
      setIsLoading(false);
    }
  }, [session, enabled, cacheKey, endpoint, paramsKey]);

  useEffect(() => {
    loadedRef.current = false; // reset when deps change
  }, [session?.companyDB, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => {
    loadedRef.current = false;
    load();
  }, [load]);

  return { options, isLoading, reload };
}
