import { ScrollText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLogs } from "@/hooks/useAuditConsole";

const LEVEL_CLASS: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-400",
  warning: "text-amber-400",
  error: "text-destructive",
};

export function AuditLogsViewer({ runId }: { runId?: string }) {
  const { data, isLoading } = useAuditLogs(runId, 500);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> Logs operacionais
        </h2>
        <p className="text-sm text-muted-foreground">
          {runId ? "Logs desta auditoria." : "Logs das auditorias mais recentes."}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum log ainda.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {data.map((l) => (
              <li key={l.id} className="grid grid-cols-[140px_60px_1fr] gap-3 border-b border-border/40 py-1.5 last:border-0">
                <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</span>
                <span className={`uppercase tracking-wider ${LEVEL_CLASS[l.level] ?? ""}`}>{l.level}</span>
                <span className="text-foreground">{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
