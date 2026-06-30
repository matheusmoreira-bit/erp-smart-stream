import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Plus, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditRuns } from "@/hooks/useAuditConsole";
import { NewAuditRunDialog } from "./NewAuditRunDialog";
import { RunStatusBadge } from "./badges";

export function AuditRunsList() {
  const { data, isLoading } = useAuditRuns();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Auditorias</h2>
          <p className="text-sm text-muted-foreground">
            Histórico de execuções do motor de auditoria (mais recentes primeiro).
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova auditoria
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card/60">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <Radar className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Nenhuma auditoria executada ainda</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Clique em "Nova auditoria" para que o motor analise PO, GRPO, Faturas e Pagamentos do SAP.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((run) => (
              <li key={run.id}>
                <Link
                  to={`../runs/${run.id}`}
                  relative="path"
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{run.id.slice(0, 8)}</span>
                      <RunStatusBadge status={run.status} />
                      {run.scope && (
                        <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {run.scope}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{new Date(run.started_at).toLocaleString("pt-BR")}</span>
                      <span>{run.total_docs_analyzed} docs</span>
                      <span className="text-amber-400">{run.total_divergences} divergências</span>
                      {run.total_fraud_flags > 0 && (
                        <span className="text-destructive">{run.total_fraud_flags} alertas</span>
                      )}
                      {run.current_step && (run.status === "pending" || run.status === "running") && (
                        <span className="text-primary">{run.current_step}</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden w-40 md:block">
                    <Progress value={Number(run.progress_pct)} className="h-1.5" />
                    <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
                      {Number(run.progress_pct)}%
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewAuditRunDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => navigate(`../runs/${id}`, { relative: "path" })}
      />
    </div>
  );
}
