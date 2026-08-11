import { AlertTriangle, CheckCircle2, ShieldAlert, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePayDashboard } from "@/hooks/useAuditPay";
import { SEVERITY_LABELS, formatBRL } from "./badges";

function Kpi({ icon, label, value, hint, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "warning" | "destructive" | "success";
}) {
  const toneClass =
    tone === "destructive" ? "text-destructive"
      : tone === "warning" ? "text-amber-400"
      : tone === "success" ? "text-emerald-400"
      : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className={toneClass}>{icon}</span>
      </div>
      <div className={`mt-3 font-mono text-2xl font-bold ${toneClass}`}>{value}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function topChart(map: Record<string, number> | undefined, n = 6) {
  return Object.entries(map ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name: name.length > 22 ? `${name.slice(0, 22)}…` : name, count }));
}

function TopBar({ title, data }: { title: string; data: { name: string; count: number }[] }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="h-52">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem dados no período.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export function PayAuditDashboard() {
  const { data, isLoading } = usePayDashboard(30);

  const sevData = Object.entries(data?.bySeverity ?? {}).map(([sev, count]) => ({
    name: SEVERITY_LABELS[sev as keyof typeof SEVERITY_LABELS]?.label ?? sev,
    count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Auditoria de pagamentos</div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">O que foi aprovado é o que foi pago?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Comparação entre o baseline da aprovação e o pagamento efetivo no ERP — últimos 30 dias.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Documentos auditados" value={data?.total ?? 0} hint={`${data?.pctConforme ?? 0}% conformes`} />
            <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Com divergência" value={(data?.total ?? 0) - (data?.conformes ?? 0)} tone="warning" />
            <Kpi icon={<Wallet className="h-4 w-4" />} label="Valor sob divergência" value={formatBRL(data?.valorDivergente ?? 0)} tone="warning" />
            <Kpi icon={<ShieldAlert className="h-4 w-4" />} label="Sinais de fraude abertos" value={data?.openSignals ?? 0} tone="destructive" />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Evolução das divergências</h3>
        <div className="h-56">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (data?.trend?.length ?? 0) === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem dados no período.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data!.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopBar title="Divergências por fornecedor" data={topChart(data?.byVendor)} />
        <TopBar title="Divergências por solicitante" data={topChart(data?.byRequester)} />
        <TopBar title="Divergências por projeto" data={topChart(data?.byProject)} />
        <TopBar title="Divergências por centro de custo" data={topChart(data?.byCostCenter)} />
      </div>

      <TopBar title="Distribuição por severidade" data={sevData} />
    </div>
  );
}
