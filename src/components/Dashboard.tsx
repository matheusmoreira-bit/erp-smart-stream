import { useState } from "react";
import { Activity, Clock, FileCheck, Package, AlertTriangle, LogOut, RefreshCw, Loader2, ArrowLeft, UserCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { FlowTimeline } from "@/components/FlowTimeline";
import { MetricCard } from "@/components/MetricCard";
import { InsightsPanel } from "@/components/InsightsPanel";
import { DataUpload } from "@/components/DataUpload";
import { ValidationTable } from "@/components/ValidationTable";
import { PeriodFilter, DEFAULT_PERIOD, type PeriodFilterValue } from "@/components/PeriodFilter";
import { useSap } from "@/contexts/SapContext";
import { useSapDashboard } from "@/hooks/useSapDashboard";
import { Button } from "@/components/ui/button";

const COMPANY_LABELS: Record<string, string> = {
  SBO_ANAGAMING: "ANA Gaming",
  SBO_CACTUS: "Cactus",
  SBO_INSTITUTO_ANA: "Instituto Cactus",
};

interface DashboardProps {
  embedded?: boolean;
}

export function Dashboard({ embedded = false }: DashboardProps) {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodFilterValue>(DEFAULT_PERIOD);

  const dateFilter = period.preset === "all"
    ? undefined
    : { from: period.range.from, to: period.range.to };

  const { stages, metrics, insights, validations, approverStats, isLoading, error, refresh } = useSapDashboard(dateFilter);
  const companyLabel = COMPANY_LABELS[session?.companyDB || ""] || session?.companyDB;

  const content = (
    <div className={embedded ? "space-y-8" : "max-w-7xl mx-auto px-6 py-8 space-y-8"}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Tempo Médio Total" value={`${metrics.avgTotalDays}d`} subtitle="Requisição → Pagamento" icon={Clock} delay={0} />
            <MetricCard title="Pedidos em Aberto" value={String(metrics.openOrders)} subtitle="Aguardando fechamento" icon={Package} delay={0.1} />
            <MetricCard title="Validações com Erro" value={String(metrics.validationErrors)} subtitle="Requerem atenção" icon={AlertTriangle} delay={0.2} />
            <MetricCard title="Taxa de Conformidade" value={`${metrics.complianceRate}%`} subtitle="Lançamentos válidos" icon={FileCheck} delay={0.3} />
          </div>

          {stages.length > 0 && <FlowTimeline stages={stages} />}

          {approverStats.length > 0 && (
            <div className="glass-card p-6">
              <div className="flex items-center gap-2 mb-6">
                <UserCheck className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Tempo Médio de Aprovação por Aprovador</h2>
                <span className="text-xs text-muted-foreground ml-auto">{approverStats.reduce((s, a) => s + a.count, 0)} aprovações</span>
              </div>
              <svg width="0" height="0"><defs><linearGradient id="approverGradH" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={1} /></linearGradient></defs></svg>
              <ResponsiveContainer width="100%" height={Math.max(300, approverStats.length * 40)}>
                <BarChart data={approverStats} layout="vertical" margin={{ left: 20, right: 30, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} unit="d" />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, _: string, entry: any) => [`${value}d (${entry.payload.count} docs)`, "Média"]}
                  />
                  <Bar dataKey="avgDays" fill="url(#approverGradH)" radius={[0, 6, 6, 0]} barSize={20}>
                    {approverStats.map((entry, i) => (
                      <Cell key={i} fillOpacity={entry.avgDays > 3 ? 1 : 0.7} />
                    ))}
                  </Bar>
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
