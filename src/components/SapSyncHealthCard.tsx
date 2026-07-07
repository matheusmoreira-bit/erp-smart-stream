import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthData {
  cron: { jobname: string | null; schedule: string | null; active: boolean };
  last_run: {
    id: string;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    status: string;
    trigger: string;
    processed_count: number;
    updated_count: number;
    error_count: number;
    error_message: string | null;
    age_seconds: number;
  } | null;
  window: {
    size: number;
    total_runs: number;
    ok_runs: number;
    error_runs: number;
    running_runs: number;
    error_rate: number;
    avg_duration_ms: number;
    max_duration_ms: number;
    total_processed: number;
    total_updated: number;
    total_item_errors: number;
  };
  generated_at: string;
}

const fmtDur = (ms: number | null | undefined) => {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const fmtAge = (seconds: number | null | undefined) => {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s atrás`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min atrás`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`;
  return `${Math.floor(seconds / 86400)}d atrás`;
};

// Ideal: até ~2x o intervalo do cron (5min → 600s). Alerta acima disso.
const STALE_THRESHOLD_SECONDS = 600;

export function SapSyncHealthCard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.rpc("get_sap_sync_health", { _last_n: 20 });
      if (err) throw err;
      setData(res as unknown as HealthData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Healthcheck da Sincronia SAP
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const cronOk = data?.cron.active ?? false;
  const stale = (data?.last_run?.age_seconds ?? Infinity) > STALE_THRESHOLD_SECONDS;
  const errRate = data?.window.error_rate ?? 0;
  const highErrorRate = errRate > 20;

  const overall: "healthy" | "warning" | "critical" =
    !cronOk || (stale && (data?.window.total_runs ?? 0) > 0)
      ? "critical"
      : highErrorRate
      ? "warning"
      : "healthy";

  const overallBadge = {
    healthy: <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" />Saudável</Badge>,
    warning: <Badge className="bg-amber-500 hover:bg-amber-500"><AlertTriangle className="mr-1 h-3 w-3" />Alerta</Badge>,
    critical: <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Crítico</Badge>,
  }[overall];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Healthcheck da Sincronia SAP
            {data && overallBadge}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric
                label="Cron"
                value={cronOk ? "Ativo" : "Inativo"}
                sub={data.cron.schedule ?? "—"}
                tone={cronOk ? "ok" : "bad"}
              />
              <Metric
                label="Última execução"
                value={data.last_run ? fmtAge(data.last_run.age_seconds) : "Nunca"}
                sub={data.last_run ? `status: ${data.last_run.status}` : "—"}
                tone={!data.last_run ? "bad" : stale ? "bad" : data.last_run.status === "error" ? "warn" : "ok"}
                icon={<Clock className="h-3 w-3" />}
              />
              <Metric
                label="Duração média"
                value={fmtDur(data.window.avg_duration_ms)}
                sub={`máx ${fmtDur(data.window.max_duration_ms)}`}
              />
              <Metric
                label="Taxa de erro"
                value={`${errRate}%`}
                sub={`${data.window.error_runs}/${data.window.total_runs} exec.`}
                tone={errRate === 0 ? "ok" : highErrorRate ? "bad" : "warn"}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="Processadas (janela)" value={data.window.total_processed} />
              <Metric label="Atualizadas (janela)" value={data.window.total_updated} />
              <Metric
                label="Erros por item"
                value={data.window.total_item_errors}
                tone={data.window.total_item_errors > 0 ? "warn" : "ok"}
              />
              <Metric label="Execuções na janela" value={data.window.total_runs} sub={`últimas ${data.window.size}`} />
            </div>

            {data.last_run?.error_message && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
                <div className="font-medium mb-1">Erro na última execução</div>
                {data.last_run.error_message}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Gerado em {new Date(data.generated_at).toLocaleString("pt-BR")} · janela = últimas {data.window.size} execuções · stale acima de {STALE_THRESHOLD_SECONDS}s
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    neutral: "",
    ok: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-destructive",
  }[tone];
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={cn("text-lg font-semibold", toneClass)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
