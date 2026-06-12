import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, FileText, ShieldAlert } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditRun, useAuditInsights } from "@/hooks/useAuditConsole";
import { AuditDivergencesTable } from "./AuditDivergencesTable";
import { RunStatusBadge, SeverityBadge } from "./badges";

export function AuditRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading } = useAuditRun(runId);
  const { data: insights } = useAuditInsights(runId, 10);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!run) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-8 text-center">
        <p className="text-sm text-muted-foreground">Auditoria não encontrada.</p>
        <Link to="../runs" relative="path" className="mt-2 inline-block text-xs text-primary hover:underline">
          Voltar à lista
        </Link>
      </div>
    );
  }

  const duration =
    run.finished_at && run.started_at
      ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="../runs"
          relative="path"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Todas as auditorias
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="font-mono text-xl font-bold text-foreground">{run.id.slice(0, 8)}</h2>
          <RunStatusBadge status={run.status} />
          {run.scope && (
            <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {run.scope}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={<Calendar className="h-4 w-4" />} label="Início" value={new Date(run.started_at).toLocaleString("pt-BR")} />
        <Stat
          icon={<Clock className="h-4 w-4" />}
          label="Duração"
          value={duration != null ? `${duration}s` : "—"}
        />
        <Stat icon={<FileText className="h-4 w-4" />} label="Docs analisados" value={run.total_docs_analyzed} />
        <Stat
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Alertas de fraude"
          value={run.total_fraud_flags}
          tone={run.total_fraud_flags > 0 ? "destructive" : undefined}
        />
      </div>

      {run.status === "pending" && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{run.current_step ?? "Em progresso"}</span>
            <span className="font-mono">{run.progress_pct}%</span>
          </div>
          <Progress value={run.progress_pct} />
        </div>
      )}

      {run.error_message && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {run.error_message}
        </div>
      )}

      {insights && insights.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Insights desta auditoria</h3>
          <ul className="space-y-3">
            {insights.map((i) => (
              <li key={i.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
                <SeverityBadge severity={i.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{i.headline}</p>
                  {i.body && <p className="mt-1 text-xs text-muted-foreground">{i.body}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AuditDivergencesTable runId={runId} embedded />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "destructive";
}) {
  const toneClass = tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className={toneClass}>{icon}</span>
      </div>
      <div className={`mt-2 font-mono text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
