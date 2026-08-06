import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EdgeMetric {
  function_name: string;
  total: number;
  errors: number;
  error_rate: number | null;
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  last_at: string | null;
}

export interface EdgePoint {
  bucket: string;
  total: number;
  errors: number;
  avg_ms: number | null;
  p95_ms: number | null;
}

export interface ExpenseReadMetric {
  screen: string;
  total: number;
  errors: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  avg_rows: number | null;
  last_at: string;
}

export interface FlowStageMetric {
  stage: string;
  stage_order: number;
  docs: number;
  avg_hours: number;
  p50_hours: number;
  p95_hours: number;
  max_hours: number;
}

/** Bucket da série temporal proporcional à janela escolhida. */
function bucketFor(hours: number) {
  if (hours <= 6) return 15;
  if (hours <= 48) return 60;
  return 360;
}

export function useFlowPerformance(hours: number, days: number) {
  const [edge, setEdge] = useState<EdgeMetric[]>([]);
  const [series, setSeries] = useState<EdgePoint[]>([]);
  const [expenseReadSeries, setExpenseReadSeries] = useState<EdgePoint[]>([]);
  const [expenseRead, setExpenseRead] = useState<ExpenseReadMetric[]>([]);
  const [stages, setStages] = useState<FlowStageMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bucket = bucketFor(hours);
      const [a, b, c, d, e] = await Promise.all([
        supabase.rpc("get_edge_function_metrics", { _hours: hours }),
        supabase.rpc("get_edge_metrics_timeseries", { _hours: hours, _bucket_minutes: bucket, _function: null }),
        supabase.rpc("get_edge_metrics_timeseries", {
          _hours: hours,
          _bucket_minutes: bucket,
          _function: "expense-read",
        }),
        supabase.rpc("get_expense_read_metrics", { _hours: hours }),
        supabase.rpc("get_flow_stage_metrics", { _days: days }),
      ]);
      const first = [a, b, c, d, e].find((r) => r.error);
      if (first?.error) throw first.error;
      setEdge((a.data ?? []) as EdgeMetric[]);
      setSeries((b.data ?? []) as EdgePoint[]);
      setExpenseReadSeries((c.data ?? []) as EdgePoint[]);
      setExpenseRead((d.data ?? []) as ExpenseReadMetric[]);
      setStages((e.data ?? []) as FlowStageMetric[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar métricas");
    } finally {
      setLoading(false);
    }
  }, [hours, days]);

  useEffect(() => {
    void load();
  }, [load]);

  return { edge, series, expenseReadSeries, expenseRead, stages, loading, error, reload: load };
}
