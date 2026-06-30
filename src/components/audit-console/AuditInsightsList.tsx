import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditInsights } from "@/hooks/useAuditConsole";
import { SeverityBadge } from "./badges";

export function AuditInsightsList() {
  const { data, isLoading } = useAuditInsights(undefined, 50);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Insights gerados pela IA
        </h2>
        <p className="text-sm text-muted-foreground">
          Resumos executivos das auditorias mais recentes desta empresa.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : !data || data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum insight ainda — execute uma auditoria para gerá-los.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.map((i) => (
              <li key={i.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
                <SeverityBadge severity={i.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{i.headline}</p>
                  {i.body && <p className="mt-1 text-xs text-muted-foreground">{i.body}</p>}
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {new Date(i.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
