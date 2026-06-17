/**
 * External-data SWR cache backed by the `sap_cache` table.
 *
 * Strategy: stale-while-revalidate.
 *  - Reads the cached payload immediately (even if expired) so the UI can render fast.
 *  - Always fires a background refetch; replaces the cache + UI when fresh data arrives.
 *  - Default TTL = 6h.
 *
 * Keys are namespaced strings, e.g. `pagcorp:2025-01-01:2025-01-31`.
 * Cache is scoped per `company_db` so different SAP/OMIE bases never share data.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface CacheRow<T> {
  data: T;
  expires_at: string;
  updated_at: string;
}

export async function readCache<T>(cacheKey: string, companyDb: string | undefined | null): Promise<CacheRow<T> | null> {
  if (!companyDb) return null;
  const { data, error } = await supabase
    .from("sap_cache")
    .select("data, expires_at, updated_at")
    .eq("cache_key", cacheKey)
    .eq("company_db", companyDb)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as CacheRow<T>;
}

export async function writeCache<T>(
  cacheKey: string,
  companyDb: string,
  payload: T,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await supabase
    .from("sap_cache")
    .upsert(
      {
        cache_key: cacheKey,
        company_db: companyDb,
        data: payload as unknown as any,
        expires_at: expiresAt,
      },
      { onConflict: "cache_key,company_db" },
    );
}

export interface UseExternalCacheParams<T> {
  /** Stable cache key (already includes period/filters). Falsy → disabled. */
  cacheKey: string | null | undefined;
  /** Scope (typically session.companyDB). Falsy → disabled. */
  companyDb: string | null | undefined;
  /** Async fetcher that hits the external system. */
  fetcher: () => Promise<T>;
  /** TTL for "fresh" data. Default 6h. */
  ttlMs?: number;
  enabled?: boolean;
}

export interface UseExternalCacheResult<T> {
  data: T | null;
  isLoading: boolean;       // no cache yet AND fetching
  isRevalidating: boolean;  // cached data shown, background refetch in flight
  isStale: boolean;         // cached data is past TTL
  error: string | null;
  fromCache: boolean;       // last data returned came from cache
  refresh: () => Promise<void>;
}

/**
 * Stale-while-revalidate hook.
 *  - Renders cached data instantly when available.
 *  - Always revalidates from `fetcher` in the background and persists the result.
 */
export function useExternalCache<T>({
  cacheKey,
  companyDb,
  fetcher,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  enabled = true,
}: UseExternalCacheParams<T>): UseExternalCacheResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    if (!enabled || !cacheKey || !companyDb) return;
    setError(null);

    // 1. Try cache (instant paint)
    const cached = await readCache<T>(cacheKey, companyDb);
    if (cached) {
      setData(cached.data);
      setFromCache(true);
      setIsStale(new Date(cached.expires_at) <= new Date());
      setIsLoading(false);
      setIsRevalidating(true);
    } else {
      setIsLoading(true);
    }

    // 2. Revalidate in background
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      setFromCache(false);
      setIsStale(false);
      // Persist (fire-and-forget; failure shouldn't break the UI)
      writeCache(cacheKey, companyDb, fresh, ttlMs).catch((e) =>
        console.warn(`[external-cache] write failed for ${cacheKey}:`, e),
      );
    } catch (e) {
      console.error(`[external-cache] fetch failed for ${cacheKey}:`, e);
      // Keep cached data on screen; surface error only if we had nothing
      if (!cached) setError(e instanceof Error ? e.message : "Erro ao buscar dados");
    } finally {
      setIsLoading(false);
      setIsRevalidating(false);
    }
  }, [cacheKey, companyDb, enabled, ttlMs]);

  useEffect(() => {
    if (!enabled) return;
    void run();
  }, [run, enabled]);

  return { data, isLoading, isRevalidating, isStale, error, fromCache, refresh: run };
}
