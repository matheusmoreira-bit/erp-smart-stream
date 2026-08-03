import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, Download, Loader2, RefreshCw, Timer, TrendingUp, Users } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import {
  buildPending,
  buildSteps,
  slaStatsToCsv,
  statsByApprover,
  statsByCostCenter,
  statsByProject,
  average,
  percentile,
  type SlaExpenseRow,
  type SlaGroupStat,
  type SlaLogRow,
} from "@/lib/sla-metrics";

const fmtH = (v: number) => `${v.toFixed(1)}h`;
const fmtDate = (v: string) => new Date(v).toLocaleString("pt-BR");
const fmtMoney = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

type Dimension = "approver" | "cost_center" | "project";

export default function SlaDashboard() {
  const { session } = useSap();
  const companyDb = session?.companyDB || "";
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);
  const [slaHours, setSlaHours] = useState(48);
  const [expenses, setExpenses] = useState<SlaExpenseRow[]>([]);
  const [logs, setLogs] = useState<SlaLogRow[]>([]);
  const [dimension, setDimension] = useState<Dimension>("approver");

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    try {
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const [{ data: exp }, { data: cfg }] = await Promise.all([
        supabase
          .from("expenses")
          .select("id, cost_center, project, doc_type, total_amount, status, current_approver, created_at")
          .eq("company_db", companyDb)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(3000),
        supabase
          .from("sla_escalation_settings")
          .select("company_db, sla_business_hours")
          .or(`company_db.eq.${companyDb},company_db.is.null`),
      ]);

      const rows = (exp || []) as SlaExpenseRow[];
      setExpenses(rows);

      const cfgRow =
        (cfg || []).find((c: any) => c.company_db === companyDb) || (cfg || [])[0];
      if (cfgRow?.sla_business_hours) setSlaHours(Number(cfgRow.sla_business_hours));

      const ids = rows.map((r) => r.id);
      const chunks: SlaLogRow[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const { data: lg } = await supabase
          .from("expense_approval_log")
          .select("expense_id, approver_name, approver_email, decision, decided_at, level_order")
          .in("expense_id", ids.slice(i, i + 300))
          .limit(5000);
        chunks.push(...((lg || []) as SlaLogRow[]));
      }
      setLogs(chunks);
    } finally {
      setLoading(false);
    }
  }, [companyDb, days]);

  useEffect(() => { void load(); }, [load]);

  const steps = useMemo(() => buildSteps(expenses, logs), [expenses, logs]);
  const pending = useMemo(() => buildPending(expenses, logs, slaHours), [expenses, logs, slaHours]);

  const rows: SlaGroupStat[] = useMemo(() => {
    if (dimension === "cost_center") return statsByCostCenter(steps, pending, slaHours);
    if (dimension === "project") return statsByProject(steps, pending, slaHours);
    return statsByApprover(steps, pending, slaHours);
  }, [dimension, steps, pending, slaHours]);

  const kpis = useMemo(() => {
    const hours = steps.map((s) => s.hours);
    const breached = hours.filter((h) => h > slaHours).length;
    return {
      decisions: steps.length,
      avg: average(hours),
      p90: percentile(hours, 90),
      withinPct: hours.length ? Math.round(((hours.length - breached) / hours.length) * 100) : 0,
      pending: pending.length,
      overdue: pending.filter((p) => p.overdue).length,
    };
  }, [steps, pending, slaHours]);

  const dimLabel =
    dimension === "cost_center" ? "Centro de custo" : dimension === "project" ? "Projeto" : "Aprovador";

  const exportCsv = useCallback(() => {
    const csv = slaStatsToCsv(rows, dimLabel);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sla-aprovacao-${dimension}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, dimLabel, dimension]);

  const maxAvg = Math.max(1, ...rows.map((r) => r.avgHours));

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Dashboard de SLA de aprovação"
        description="Tempo médio por aprovador, gargalos por centro de custo/projeto e ranking de atrasos."
        icon={<Timer className="w-5 h-5" />}
      />

      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sla-days" className="text-xs">Janela (dias)</Label>
            <Input
              id="sla-days"
              type="number"
              min={7}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(7, Math.min(365, Number(e.target.value) || 90)))}
              className="h-9 w-28"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sla-h" className="text-xs">SLA (horas úteis)</Label>
            <Input
              id="sla-h"
              type="number"
              min={1}
              value={slaHours}
              onChange={(e) => setSlaHours(Math.max(1, Number(e.target.value) || 48))}
              className="h-9 w-28"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: "Decisões no período", value: String(kpis.decisions), icon: Users },
            { label: "Tempo médio", value: fmtH(kpis.avg), icon: Timer },
            { label: "P90", value: fmtH(kpis.p90), icon: TrendingUp },
            { label: "Dentro do SLA", value: `${kpis.withinPct}%`, icon: TrendingUp },
            { label: "Pendentes", value: String(kpis.pending), icon: AlarmClock },
            { label: "Pendentes atrasados", value: String(kpis.overdue), icon: AlarmClock },
          ].map((k) => {
            const Icon = k.icon;
            return (
              <Card key={k.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
                    <Icon className="w-3.5 h-3.5" /> {k.label}
                  </div>
                  <div className="text-xl font-bold font-mono mt-1">{k.value}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Gargalos por {dimLabel.toLowerCase()}</CardTitle>
            <Tabs value={dimension} onValueChange={(v) => setDimension(v as Dimension)}>
              <TabsList>
                <TabsTrigger value="approver">Aprovador</TabsTrigger>
                <TabsTrigger value="cost_center">Centro de custo</TabsTrigger>
                <TabsTrigger value="project">Projeto</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculando métricas…
              </p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem decisões de aprovação no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="text-left py-2 pr-3">{dimLabel}</th>
                      <th className="text-right py-2 px-2">Decisões</th>
                      <th className="text-left py-2 px-2 w-[180px]">Tempo médio</th>
                      <th className="text-right py-2 px-2">P90</th>
                      <th className="text-right py-2 px-2">Máx</th>
                      <th className="text-right py-2 px-2">Fora do SLA</th>
                      <th className="text-right py-2 pl-2">Pendentes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b border-border/40">
                        <td className="py-2 pr-3 font-medium">{r.key}</td>
                        <td className="py-2 px-2 text-right font-mono">{r.count}</td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded bg-muted overflow-hidden">
                              <div
                                className={`h-full ${r.avgHours > slaHours ? "bg-destructive" : "bg-primary"}`}
                                style={{ width: `${Math.round((r.avgHours / maxAvg) * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono w-14 text-right">{fmtH(r.avgHours)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{fmtH(r.p90Hours)}</td>
                        <td className="py-2 px-2 text-right font-mono">{fmtH(r.maxHours)}</td>
                        <td className="py-2 px-2 text-right">
                          <Badge variant={r.breachPct > 25 ? "destructive" : "outline"} className="font-mono">
                            {r.breached} ({r.breachPct}%)
                          </Badge>
                        </td>
                        <td className="py-2 pl-2 text-right font-mono">
                          {r.pending}
                          {r.pendingOverdue > 0 && (
                            <span className="text-destructive"> ({r.pendingOverdue} atrasados)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlarmClock className="w-4 h-4 text-destructive" />
              Ranking de atrasos (pendentes agora)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum documento pendente de aprovação.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {pending.slice(0, 25).map((p) => (
                  <li key={p.expenseId} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                    <Badge variant={p.overdue ? "destructive" : "outline"} className="font-mono">
                      {fmtH(p.hours)}
                    </Badge>
                    <span className="font-medium">{p.approver}</span>
                    <span className="font-mono text-muted-foreground">{p.costCenter}</span>
                    {p.project !== "—" && (
                      <Badge variant="secondary" className="text-[10px]">{p.project}</Badge>
                    )}
                    <span className="text-muted-foreground">desde {fmtDate(p.since)}</span>
                    <span className="ml-auto font-mono">{fmtMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
