import { useState } from "react";
import { Activity, Clock, FileCheck, Package, AlertTriangle, LogOut, RefreshCw, Loader2, ArrowLeft, UserCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { FlowTimeline } from "@/components/FlowTimeline";
import { MetricCard } from "@/components/MetricCard";
import { InsightsPanel } from "@/components/InsightsPanel";
import { DataUpload } from "@/components/DataUpload";
import { ValidationTable } from "@/components/ValidationTable";
import { PeriodFilter, DEFAULT_PERIOD, type PeriodFilterValue } from "@/components/PeriodFilter";
import { useSap } from "@/contexts/SapContext";
import { useSapDashboard } from "@/hooks/useSapDashboard";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCompanies, DEFAULT_TARGETS } from "@/hooks/useCompanies";

interface DashboardProps {
  embedded?: boolean;
}

export function Dashboard({ embedded = false }: DashboardProps) {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const { companies, getLabel } = useCompanies(true);
  const [period, setPeriod] = useState<PeriodFilterValue>(DEFAULT_PERIOD);

  const dateFilter = period.preset === "all"
    ? undefined
    : { from: period.range.from, to: period.range.to };

  const companyTargets = companies.find((c) => c.company_db === session?.companyDB)?.targets || DEFAULT_TARGETS;
  const { stages, metrics, insights, validations, approverStats, isLoading, error, refresh } = useSapDashboard(dateFilter, companyTargets);
  const companyLabel = getLabel(session?.companyDB || "");

  const content = (
    <div className={embedded ? "space-y-4 sm:space-y-8" : "max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-8"}>
      <div className="flex items-center justify-between">
        <PeriodFilter value={period} onChange={setPeriod} />
        <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {error && (
        <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Carregando dados do SAP B1...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            <MetricCard title="Tempo Médio Total" value={`${metrics.avgTotalDays}d`} subtitle="Requisição → Pagamento" icon={Clock} delay={0} />
            <MetricCard title="Pedidos em Aberto" value={String(metrics.openOrders)} subtitle="Aguardando fechamento" icon={Package} delay={0.1} />
            <MetricCard title="Validações com Erro" value={String(metrics.validationErrors)} subtitle="Requerem atenção" icon={AlertTriangle} delay={0.2} />
            <MetricCard title="Taxa de Conformidade" value={`${metrics.complianceRate}%`} subtitle="Lançamentos válidos" icon={FileCheck} delay={0.3} />
          </div>

          {stages.length > 0 && <FlowTimeline stages={stages} />}

          {approverStats.length > 0 && (
            <div className="glass-card p-3 sm:p-6">
              <div className="flex items-center gap-2 mb-6">
                <UserCheck className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Tempo Médio de Aprovação por Aprovador</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {approverStats.reduce((s, a) => s + a.countApproved + a.countRejected, 0)} aprovações
                </span>
              </div>
              <div className="flex items-center gap-3 sm:gap-4 mb-4 text-[10px] sm:text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--primary))" }} /> Aprovados</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--destructive))" }} /> Rejeitados</span>
                <span className="flex items-center gap-1"><span className="w-6 border-t-2 border-dashed" style={{ borderColor: "hsl(var(--warning))" }} /> Meta ({companyTargets.aprovador}d)</span>
              </div>
              <svg width="0" height="0">
                <defs>
                  <linearGradient id="approvedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="rejectedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={1} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
              </svg>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={approverStats} margin={{ left: 10, right: 10, top: 10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} height={60} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} unit="d" />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, name: string) => [`${value}d`, name === "avgDaysApproved" ? "Aprovados" : "Rejeitados"]}
                    labelFormatter={(label) => {
                      const item = approverStats.find((a) => a.name === label);
                      return item ? `${label} (${item.countApproved + item.countRejected} docs)` : label;
                    }}
                  />
                  <ReferenceLine y={companyTargets.aprovador} stroke="hsl(var(--warning))" strokeDasharray="6 4" strokeWidth={2} label={{ value: `Meta ${companyTargets.aprovador}d`, position: "right", fill: "hsl(var(--warning))", fontSize: 11 }} />
                  <Bar dataKey="avgDaysApproved" stackId="a" fill="url(#approvedGrad)" radius={[0, 0, 0, 0]} barSize={28} />
                  <Bar dataKey="avgDaysRejected" stackId="a" fill="url(#rejectedGrad)" radius={[4, 4, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              {insights.length > 0 && <InsightsPanel insights={insights} />}
            </div>
            <div>
              <DataUpload />
            </div>
          </div>

          {validations.length > 0 && <ValidationTable items={validations} />}
        </>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">SAP B1 <span className="text-gradient">Analytics</span></h1>
              <p className="text-xs text-muted-foreground">Validação e análise de fluxo de compras</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{companyLabel}</p>
              <p className="text-xs text-muted-foreground">{session?.userName}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Menu
          </Button>
        </div>
        {content}
      </main>
    </div>
  );
}
