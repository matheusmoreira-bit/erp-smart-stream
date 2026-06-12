import { Activity, AlertTriangle, Radar, ShieldAlert, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuditDashboard, useAuditInsights } from "@/hooks/useAuditConsole";
import { SeverityBadge, DIVERGENCE_TYPE_LABELS } from "./badges";

function Kpi({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "warning" | "destructive" | "success";
  hint?: string;
}) {
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-400"
        : tone === "success"
          ? "text-emerald-400"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className={toneClass}>{icon}</span>
      </div>
      <div className={`mt-3 font-mono text-3xl font-bold ${toneClass}`}>{value}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AuditDashboard() {
  const { data, isLoading } = useAuditDashboard();
  const { data: insights } = useAuditInsights(undefined, 5);

  const trend = data?.trend ?? [];
  const byType = Object.entries(data?.byType ?? {})
    .map(([type, count]) => ({ type: DIVERGENCE_TYPE_LABELS[type] ?? type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Painel Executivo
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Visão da diretoria</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Indicadores consolidados das últimas auditorias e divergências detectadas.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <Kpi
              icon={<Radar className="h-4 w-4" />}
              label="Auditorias (30d)"
              value={data?.runsLast30d ?? 0}
              hint={`${data?.runningCount ?? 0} em execução`}
            />
            <Kpi
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Divergências abertas"
              value={data?.openDivergences ?? 0}
              tone="warning"
              hint={`${data?.totalDivergences ?? 0} no período`}
            />
            <Kpi
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Alertas de fraude"
              value={data?.fraudFlags ?? 0}
              tone="destructive"
            />
            <Kpi
              icon={<Activity className="h-4 w-4" />}
              label="Críticas"
              value={data?.criticalCount ?? 0}
              tone="destructive"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card/60 p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Divergências por dia</h3>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              últimos 30 dias
            </span>
          </div>
          <div className="h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="divGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--primary))"
                    fill="url(#divGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/60 p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Top categorias</h3>
          <div className="h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : byType.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Sem dados ainda.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byType} layout="vertical" margin={{ left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="type"
                    width={130}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Insights recentes da IA</h3>
        </div>
        {insights && insights.length > 0 ? (
          <ul className="space-y-3">
            {insights.map((i) => (
              <li
                key={i.id}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
              >
                <SeverityBadge severity={i.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{i.headline}</p>
                  {i.body && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.body}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {new Date(i.created_at).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nenhum insight gerado ainda. Após a primeira auditoria, a IA irá destacar as anomalias mais relevantes aqui.
          </p>
        )}
      </div>
    </div>
  );
}
