import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Row {
  metric: string;
  value: number;
}

const WINDOWS: { label: string; hours: number }[] = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

const LABELS: Record<string, { label: string; hint?: string; tone?: "default" | "success" | "warning" | "destructive" }> = {
  expenses_created: { label: "Despesas criadas" },
  expenses_integrated: { label: "Integradas ao SAP", tone: "success" },
  approval_decisions: { label: "Decisões de aprovação" },
  active_requesters: { label: "Solicitantes ativos" },
  active_approvers: { label: "Aprovadores ativos" },
  sap_sync_runs: { label: "Execuções de sync SAP" },
  sap_sync_errors: { label: "Sync SAP com erro", tone: "destructive" },
  pagcorp_integrations: { label: "Integrações PagCorp" },
  nf_entrada_imports: { label: "NFs de entrada" },
  edge_calls: { label: "Chamadas de edge" },
  edge_errors: { label: "Erros de edge (4xx/5xx)", tone: "destructive" },
  retry_queue_pending: { label: "Retry pendente", tone: "warning" },
};

const ORDER = Object.keys(LABELS);

export function SystemActivityCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("get_system_activity", { _hours: hours });
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
  }, [load]);

  const byMetric = new Map(rows.map((r) => [r.metric, r.value]));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Atividade do sistema
            <Badge variant="secondary" className="ml-1">últimas {hours >= 24 ? `${hours / 24}d` : `${hours}h`}</Badge>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Recarregar métricas de atividade"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {ORDER.map((k) => {
            const spec = LABELS[k];
            const value = byMetric.get(k) ?? 0;
            const tone =
              spec.tone === "destructive" && value > 0
                ? "text-destructive"
                : spec.tone === "warning" && value > 0
                ? "text-amber-600"
                : spec.tone === "success" && value > 0
                ? "text-emerald-600"
                : "";
            return (
              <div
                key={k}
                className="rounded-lg border border-border bg-card/40 px-3 py-2"
              >
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {spec.label}
                </div>
                <div className={cn("text-2xl font-semibold tabular-nums mt-0.5", tone)}>
                  {value.toLocaleString("pt-BR")}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Agrega despesas, aprovações, integrações SAP/PagCorp/NF, chamadas de edge
          e fila de retry. Somente admins podem consultar.
        </p>
      </CardContent>
    </Card>
  );
}
