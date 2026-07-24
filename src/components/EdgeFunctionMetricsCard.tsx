import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

interface Row {
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

const WINDOWS: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

const fmtMs = (v: number | null | undefined) => {
  if (v == null) return "—";
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(1)}s`;
};

function latencyTone(p95: number | null | undefined): string {
  if (p95 == null) return "";
  if (p95 > 10_000) return "text-destructive";
  if (p95 > 5_000) return "text-amber-600";
  return "text-emerald-600";
}

function errorTone(rate: number | null): string {
  if (rate == null) return "";
  if (rate > 5) return "text-destructive";
  if (rate > 1) return "text-amber-600";
  return "text-emerald-600";
}

export function EdgeFunctionMetricsCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("get_edge_function_metrics", { _hours: hours });
      if (err) throw err;
      setRows((data ?? []) as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4" /> Latência de Edge Functions
            <Badge variant="secondary" className="ml-1">p50/p95/p99</Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w.hours}
                variant={hours === w.hours ? "default" : "ghost"}
                size="sm"
                onClick={() => setHours(w.hours)}
              >
                {w.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        {rows.length === 0 && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            Nenhuma métrica coletada ainda nessa janela. As funções instrumentadas
            começarão a alimentar este painel na próxima invocação.
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 pr-3">Função</th>
                  <th className="text-right py-2 pr-3">Total</th>
                  <th className="text-right py-2 pr-3">Erros</th>
                  <th className="text-right py-2 pr-3">Taxa</th>
                  <th className="text-right py-2 pr-3">p50</th>
                  <th className="text-right py-2 pr-3">p95</th>
                  <th className="text-right py-2 pr-3">p99</th>
                  <th className="text-right py-2 pr-3">Média</th>
                  <th className="text-right py-2">Última</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.function_name} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{r.function_name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.total}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.errors}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums font-medium", errorTone(r.error_rate))}>
                      {r.error_rate == null ? "—" : `${r.error_rate}%`}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p50_ms)}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums font-medium", latencyTone(r.p95_ms))}>
                      {fmtMs(r.p95_ms)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.p99_ms)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtMs(r.avg_ms)}</td>
                    <td className="py-2 text-right text-xs text-muted-foreground">
                      {r.last_at ? new Date(r.last_at).toLocaleTimeString("pt-BR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-3">
          Cores: p95 &gt; 10s = crítico · &gt; 5s = alerta · taxa de erro &gt; 5% = crítico ·
          &gt; 1% = alerta. Retenção: 14 dias. OPTIONS/preflight não contam.
        </p>
      </CardContent>
    </Card>
  );
}
