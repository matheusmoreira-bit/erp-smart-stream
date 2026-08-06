import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ScreenMetric {
  screen: string;
  total: number;
  errors: number;
  error_rate: number | null;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  slow_count: number;
  total_ms: number;
  last_at: string;
}

export interface TargetMetric {
  target: string;
  source: string;
  operation: string;
  screens: number;
  total: number;
  errors: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  total_ms: number;
  last_at: string;
}

export interface SlowSample {
  started_at: string;
  screen: string;
  source: string;
  target: string;
  operation: string;
  duration_ms: number;
  ok: boolean;
  status_code: number | null;
  row_count: number | null;
  company_db: string | null;
}

export interface PgSlowQuery {
  query: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
  max_ms: number;
  rows_total: number;
}

export function useDbPerformance(hours: number, screen: string | null, minMs: number) {
  const [screens, setScreens] = useState<ScreenMetric[]>([]);
  const [targets, setTargets] = useState<TargetMetric[]>([]);
  const [slow, setSlow] = useState<SlowSample[]>([]);
  const [pgSlow, setPgSlow] = useState<PgSlowQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, b, c, d] = await Promise.all([
        supabase.rpc("get_db_query_metrics_by_screen", { _hours: hours }),
        supabase.rpc("get_db_query_metrics_by_target", { _hours: hours, _screen: screen }),
        supabase.rpc("get_db_slow_query_samples", { _hours: hours, _min_ms: minMs, _limit: 50 }),
        supabase.rpc("get_pg_slow_queries", { _limit: 20 }),
      ]);
      if (a.error) throw a.error;
      setScreens((a.data ?? []) as ScreenMetric[]);
      setTargets((b.data ?? []) as TargetMetric[]);
      setSlow((c.data ?? []) as SlowSample[]);
      setPgSlow((d.data ?? []) as PgSlowQuery[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours, screen, minMs]);

  useEffect(() => {
    void load();
  }, [load]);

  return { screens, targets, slow, pgSlow, loading, error, reload: load };
}
