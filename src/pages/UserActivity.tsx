import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Loader2, Search, Users, LogIn, ShieldAlert, Activity, Clock, Monitor, Timer, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { useUserActivity, getActionLabel, isFailedLogin, formatDuration } from "@/hooks/useUserActivity";
import { useFlowActivity } from "@/hooks/useFlowActivity";
import { mergeActivity, formatEventDateTime, type ActivitySystem } from "@/lib/activity-events";
import MonthlyLoginChart from "@/components/MonthlyLoginChart";
import UserActivityRankings from "@/components/UserActivityRankings";
import { PageTitle } from "@/components/PageTitle";


const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(var(--success, 142 71% 45%))",
  "hsl(var(--warning, 38 92% 50%))",
  "hsl(var(--accent))",
  "hsl(var(--muted-foreground))",
];

function formatTime(t: number): string {
  if (t === undefined || t === null) return "";
  // SAP USR5 Time comes as HHMMss integer (e.g. 121542 = 12:15:42, 93005 = 09:30:05)
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

function parseIsoDate(d: string): Date | null {
  if (!d) return null;
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  return null;
}

function formatDate(d: string): string {
  if (!d) return "";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

export default function UserActivityPage() {
  const navigate = useNavigate();
  const { records, isLoading, error, refresh } = useUserActivity();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("7");
  const [userTypeFilter, setUserTypeFilter] = useState("no_api");
  const [systemFilter, setSystemFilter] = useState<"all" | ActivitySystem>("all");

  const {
    records: flowRecords,
    isLoading: flowLoading,
    error: flowError,
    refresh: refreshFlow,
  } = useFlowActivity(parseInt(daysFilter) || 0);

  const refreshAll = () => {
    refresh();
    refreshFlow();
  };



  const filtered = useMemo(() => {
    let list = records;

    // User type filter (API/Workflow)
    const isApiOrWorkflow = (code: string) => {
      const lc = code?.toLowerCase() || "";
      return lc.includes("api") || lc.includes("workflow");
    };
    if (userTypeFilter === "no_api") {
      list = list.filter((r) => !isApiOrWorkflow(r.UserCode));
    } else if (userTypeFilter === "only_api") {
      list = list.filter((r) => isApiOrWorkflow(r.UserCode));
    }

    // Date filter
    const days = parseInt(daysFilter);
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      list = list.filter((r) => {
        const d = parseIsoDate(r.Date);
        return d && d >= cutoff;
      });
    }

    if (actionFilter !== "all") {
      list = list.filter((r) => r.Action === actionFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.UserCode?.toLowerCase().includes(q) ||
          r.ActionBy?.toLowerCase().includes(q) ||
          r.ClientIP?.toLowerCase().includes(q) ||
          r.ClientName?.toLowerCase().includes(q)
      );
    }
    // Sort most recent first
    list = [...list].sort((a, b) => {
      if (a.Date !== b.Date) return b.Date.localeCompare(a.Date);
      return (b.Time || 0) - (a.Time || 0);
    });
    return list;
  }, [records, search, actionFilter, daysFilter, userTypeFilter]);

  // Metrics
  const metrics = useMemo(() => {
    const uniqueUsers = new Set(filtered.map((r) => r.UserCode)).size;
    const logins = filtered.filter((r) => r.Action === "I" || r.Action === "W").length;
    const failures = filtered.filter((r) => isFailedLogin(r)).length;
    const uniqueIPs = new Set(filtered.filter((r) => r.ClientIP).map((r) => r.ClientIP)).size;
    const avgDuration = (() => {
      const sessions = filtered.filter((r) => r.AliveDurtn > 0);
      if (sessions.length === 0) return 0;
      return Math.round(sessions.reduce((s, r) => s + r.AliveDurtn, 0) / sessions.length);
    })();
    return { uniqueUsers, logins, failures, uniqueIPs, avgDuration };
  }, [filtered]);

  // Pie chart: actions breakdown
  const actionsPie = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => {
      const label = isFailedLogin(r) ? "Falha de Login" : getActionLabel(r.Action);
      map.set(label, (map.get(label) || 0) + 1);
    });
    return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ERP Flow: filtro por busca/ação e período (o período já vem aplicado no servidor)
  const flowFiltered = useMemo(() => {
    let list = flowRecords;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.actor_email?.toLowerCase().includes(q) ||
          r.actor_name?.toLowerCase().includes(q) ||
          r.action?.toLowerCase().includes(q) ||
          r.detail?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [flowRecords, search]);

  // Log unificado (SAP + ERP Flow)
  const unified = useMemo(() => {
    const sap = systemFilter === "flow" ? [] : filtered;
    const flow = systemFilter === "sap" ? [] : flowFiltered;
    return mergeActivity(sap, flow);
  }, [filtered, flowFiltered, systemFilter]);

  const flowMetrics = useMemo(() => {
    const users = new Set(flowFiltered.map((r) => r.actor_email).filter(Boolean)).size;
    return { events: flowFiltered.length, users };
  }, [flowFiltered]);


  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Atividade de Usuários" />
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/usuarios/lista")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Atividade de Usuários</h1>
              <p className="text-sm text-muted-foreground">Logins e ações — SAP (USR5) + ERP Flow</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoading || flowLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading || flowLoading ? "animate-spin" : ""}`} />
              Atualizar

            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">{error}</div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar usuário, IP, máquina..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-card border-border"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[160px] bg-card">
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ações</SelectItem>
              <SelectItem value="I">Login</SelectItem>
              <SelectItem value="W">Login Web</SelectItem>
              <SelectItem value="O">Logout</SelectItem>
              <SelectItem value="C">Mudança Senha</SelectItem>
              <SelectItem value="K">Bloqueio</SelectItem>
              <SelectItem value="U">Desbloqueio</SelectItem>
            </SelectContent>
          </Select>
          <Select value={userTypeFilter} onValueChange={setUserTypeFilter}>
            <SelectTrigger className="w-[180px] bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no_api">Sem API/Workflow</SelectItem>
              <SelectItem value="only_api">Apenas API/Workflow</SelectItem>
              <SelectItem value="all">Todos usuários</SelectItem>
            </SelectContent>
          </Select>
          <Select value={daysFilter} onValueChange={setDaysFilter}>
            <SelectTrigger className="w-[140px] bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="15">Últimos 15 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="0">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Select value={systemFilter} onValueChange={(v) => setSystemFilter(v as "all" | ActivitySystem)}>
            <SelectTrigger className="w-[150px] bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">SAP + ERP Flow</SelectItem>
              <SelectItem value="sap">Somente SAP</SelectItem>
              <SelectItem value="flow">Somente ERP Flow</SelectItem>
            </SelectContent>
          </Select>
        </div>


        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Carregando atividade…</span>
          </div>
        ) : (
          <>
            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <MetricCard title="Usuários Únicos" value={String(metrics.uniqueUsers)} icon={Users} delay={0} />
              <MetricCard title="Logins" value={String(metrics.logins)} icon={LogIn} delay={0.05} />
              <MetricCard
                title="Falhas de Login"
                value={String(metrics.failures)}
                icon={ShieldAlert}
                delay={0.1}
                trend={metrics.failures > 0 ? { value: String(metrics.failures), positive: false } : undefined}
              />
              <MetricCard title="IPs Únicos" value={String(metrics.uniqueIPs)} icon={Activity} delay={0.15} />
              <MetricCard title="Duração Média" value={formatDuration(metrics.avgDuration)} icon={Timer} delay={0.2} />
              <MetricCard
                title="Ações no ERP Flow"
                value={String(flowMetrics.events)}
                icon={Workflow}
                delay={0.25}
                trend={{ value: `${flowMetrics.users} usuários`, positive: true }}
              />
            </div>


            {/* Monthly Login Chart + Pie */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <MonthlyLoginChart records={records} filtered={filtered} />
              </div>
              {/* Pie chart */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Tipos de Ação</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={actionsPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false}>
                      {actionsPie.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Rankings */}
            <UserActivityRankings records={filtered} />

            {/* Recent Activity Log */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-6 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold text-foreground">Log de Atividade Recente</h3>
                <p className="text-xs text-muted-foreground">
                  {unified.length} registros · {filtered.length} SAP · {flowFiltered.length} ERP Flow
                </p>

              </div>
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">Data/Hora</th>
                      <th className="px-4 py-3 text-left">Sistema</th>
                      <th className="px-4 py-3 text-left">Usuário</th>
                      <th className="px-4 py-3 text-left">Ação</th>
                      <th className="px-4 py-3 text-left">Origem</th>
                      <th className="px-4 py-3 text-left">IP</th>
                      <th className="px-4 py-3 text-left">Máquina / Detalhe</th>
                      <th className="px-4 py-3 text-left">Duração</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unified.slice(0, 300).map((e) => (
                      <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatEventDateTime(e)}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant="outline"
                            className={e.system === "flow" ? "border-primary/40 text-primary" : "text-muted-foreground"}
                          >
                            {e.system === "flow" ? "ERP Flow" : "SAP"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-medium text-foreground">{e.user}</td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={e.negative ? "destructive" : "secondary"}
                            className={!e.negative && e.system === "flow" ? "bg-primary/15 text-primary" : ""}
                          >
                            {e.actionLabel}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">
                          <span className="flex items-center gap-1">
                            {e.system === "flow" ? <Workflow className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                            {e.sourceLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{e.ip || "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs truncate max-w-[220px]">
                          {e.machine || e.detail || "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{formatDuration(e.durationMinutes)}</td>
                      </tr>
                    ))}
                    {unified.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center text-muted-foreground py-8">Nenhum registro encontrado</td>
                      </tr>
                    )}

                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
