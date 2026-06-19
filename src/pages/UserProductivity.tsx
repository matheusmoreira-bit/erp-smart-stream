import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Download,
  TrendingUp,
  Users,
  DollarSign,
  AlertTriangle,
  Trophy,
  Building2,
  FileText,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
import { PageTitle } from "@/components/PageTitle";
  useUserProductivity,
  aggregateByDepartment,
  aggregateByUser,
  aggregateByDocType,
  docTypeLabel,
  formatBRL,
  useProductivityFilters,
} from "@/hooks/useUserProductivity";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--warning, 38 92% 50%))",
  "hsl(var(--destructive))",
  "hsl(var(--success, 142 71% 45%))",
  "hsl(var(--muted-foreground))",
];

function downloadCSV(filename: string, rows: Record<string, string | number>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(";"),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h] ?? "";
          const s = String(v).replace(/"/g, '""');
          return /[;"\n]/.test(s) ? `"${s}"` : s;
        })
        .join(";"),
    ),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UserProductivityPage() {
  const navigate = useNavigate();
  const { rows, isLoading, error, hanaDisabled, refresh } = useUserProductivity();
  const { departments, docTypes, periodos } = useProductivityFilters(rows);

  const [periodoFilter, setPeriodoFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [docTypeFilter, setDocTypeFilter] = useState<string>("all");
  const [expandedDept, setExpandedDept] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return rows.filter(
      (r) =>
        (periodoFilter === "all" || r.periodo === periodoFilter) &&
        (deptFilter === "all" || r.department === deptFilter) &&
        (docTypeFilter === "all" || r.docType === docTypeFilter),
    );
  }, [rows, periodoFilter, deptFilter, docTypeFilter]);

  const byDept = useMemo(() => aggregateByDepartment(filtered), [filtered]);
  const byUser = useMemo(() => aggregateByUser(filtered), [filtered]);
  const byDoc = useMemo(() => aggregateByDocType(filtered), [filtered]);

  const kpis = useMemo(() => {
    const totalDocs = filtered.reduce((s, r) => s + r.docsCriados, 0);
    const totalValor = filtered.reduce((s, r) => s + r.valorTotalBRL, 0);
    const totalEdicoes = filtered.reduce((s, r) => s + r.edicoesFeitas, 0);
    const totalCanc = filtered.reduce((s, r) => s + r.docsCancelados, 0);
    const retrabalho = totalDocs > 0 ? ((totalEdicoes + totalCanc) / totalDocs) * 100 : 0;
    const topDept = byDept[0]?.department || "—";
    const topUser = byUser[0]?.userName || "—";
    return { totalDocs, totalValor, retrabalho, topDept, topUser };
  }, [filtered, byDept, byUser]);

  // Stacked bar — docs por departamento por tipo
  const stackedDeptData = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    for (const r of filtered) {
      const row = map.get(r.department) ?? { department: r.department };
      const label = docTypeLabel(r.docType);
      row[label] = ((row[label] as number) || 0) + r.docsCriados;
      map.set(r.department, row);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        Object.entries(b)
          .filter(([k]) => k !== "department")
          .reduce((s, [, v]) => s + (v as number), 0) -
        Object.entries(a)
          .filter(([k]) => k !== "department")
          .reduce((s, [, v]) => s + (v as number), 0),
    );
  }, [filtered]);

  const stackedKeys = useMemo(
    () => Array.from(new Set(filtered.map((r) => docTypeLabel(r.docType)))),
    [filtered],
  );

  const toggleDept = (d: string) => {
    setExpandedDept((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const usersByDept = useMemo(() => {
    const map = new Map<string, ReturnType<typeof aggregateByUser>>();
    for (const d of byDept) {
      map.set(
        d.department,
        aggregateByUser(filtered.filter((r) => r.department === d.department)),
      );
    }
    return map;
  }, [byDept, filtered]);

  const handleExport = () => {
    downloadCSV(
      `produtividade_${new Date().toISOString().slice(0, 10)}.csv`,
      byUser.map((u) => ({
        Departamento: u.department,
        Usuario: u.userName,
        Codigo: u.userCode,
        DocsCriados: u.docsCriados,
        ValorBRL: u.valorTotalBRL.toFixed(2),
        Edicoes: u.edicoesFeitas,
        Cancelados: u.docsCancelados,
        RetrabalhoPct: u.retrabalhoPct.toFixed(1),
        Score: u.score,
      })),
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Produtividade de Usuários" />
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/usuarios/lista")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Produtividade de Usuários</h1>
              <p className="text-sm text-muted-foreground">
                Entregas por departamento SAP — documentos, valor movimentado e retrabalho
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length}>
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={periodoFilter} onValueChange={setPeriodoFilter}>
            <SelectTrigger className="w-[180px] bg-card">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os períodos</SelectItem>
              {periodos.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-[220px] bg-card">
              <SelectValue placeholder="Departamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os departamentos</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
            <SelectTrigger className="w-[200px] bg-card">
              <SelectValue placeholder="Tipo de documento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {docTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {docTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Carregando produtividade…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">
              Aguardando dados de produtividade
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {hanaDisabled
                ? "As views de produtividade não estão disponíveis nesta empresa."
                : "Nenhum documento encontrado nos últimos 180 dias para os filtros atuais."}
            </p>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricCard
                title="Total de documentos"
                value={kpis.totalDocs.toLocaleString("pt-BR")}
                icon={FileText}
                delay={0}
              />
              <MetricCard
                title="Valor movimentado"
                value={formatBRL(kpis.totalValor)}
                icon={DollarSign}
                delay={0.05}
              />
              <MetricCard
                title="Taxa de retrabalho"
                value={`${kpis.retrabalho.toFixed(1)}%`}
                icon={AlertTriangle}
                delay={0.1}
                trend={
                  kpis.retrabalho > 10
                    ? { value: "alta", positive: false }
                    : { value: "ok", positive: true }
                }
              />
              <MetricCard
                title="Top departamento"
                value={kpis.topDept}
                icon={Building2}
                delay={0.15}
              />
              <MetricCard
                title="Usuário destaque"
                value={kpis.topUser}
                icon={Trophy}
                delay={0.2}
              />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Documentos por departamento (empilhado por tipo)
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stackedDeptData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {stackedKeys.map((k, i) => (
                      <Bar
                        key={k}
                        dataKey={k}
                        stackId="docs"
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" /> Valor R$ movimentado por departamento
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={byDept}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                    <Bar dataKey="valorTotalBRL" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="department" className="w-full">
              <TabsList>
                <TabsTrigger value="department">
                  <Building2 className="w-4 h-4 mr-2" /> Por Departamento
                </TabsTrigger>
                <TabsTrigger value="user">
                  <Users className="w-4 h-4 mr-2" /> Por Usuário
                </TabsTrigger>
                <TabsTrigger value="doctype">
                  <FileText className="w-4 h-4 mr-2" /> Por Tipo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="department" className="mt-4">
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="grid grid-cols-[1fr_repeat(5,minmax(0,1fr))] gap-2 px-4 py-3 border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    <span>Departamento</span>
                    <span className="text-right">Usuários</span>
                    <span className="text-right">Docs criados</span>
                    <span className="text-right">Valor R$</span>
                    <span className="text-right">Retrabalho</span>
                    <span className="text-right">Score</span>
                  </div>
                  {byDept.map((d) => {
                    const open = expandedDept.has(d.department);
                    const users = usersByDept.get(d.department) || [];
                    return (
                      <div key={d.department} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          onClick={() => toggleDept(d.department)}
                          className="w-full grid grid-cols-[1fr_repeat(5,minmax(0,1fr))] gap-2 px-4 py-3 items-center hover:bg-muted/20 transition-colors text-sm"
                        >
                          <span className="flex items-center gap-2 font-semibold text-foreground text-left">
                            {open ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                            {d.department}
                          </span>
                          <span className="text-right text-muted-foreground">{d.usersCount}</span>
                          <span className="text-right font-mono text-foreground">
                            {d.docsCriados.toLocaleString("pt-BR")}
                          </span>
                          <span className="text-right font-mono text-foreground">
                            {formatBRL(d.valorTotalBRL)}
                          </span>
                          <span className="text-right">
                            <Badge
                              variant="secondary"
                              className={
                                d.retrabalhoPct > 15
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-primary/15 text-primary"
                              }
                            >
                              {d.retrabalhoPct.toFixed(1)}%
                            </Badge>
                          </span>
                          <span className="text-right font-mono text-primary font-semibold">
                            {d.score.toLocaleString("pt-BR")}
                          </span>
                        </button>
                        {open && (
                          <div className="bg-muted/10 border-t border-border">
                            {users.map((u) => (
                              <div
                                key={u.userCode}
                                className="grid grid-cols-[1fr_repeat(5,minmax(0,1fr))] gap-2 px-4 py-2 items-center text-xs border-b border-border/50 last:border-b-0"
                              >
                                <span className="pl-6 text-muted-foreground truncate">
                                  {u.userName}{" "}
                                  <span className="text-muted-foreground/60">({u.userCode})</span>
                                </span>
                                <span className="text-right" />
                                <span className="text-right font-mono">
                                  {u.docsCriados.toLocaleString("pt-BR")}
                                </span>
                                <span className="text-right font-mono">
                                  {formatBRL(u.valorTotalBRL)}
                                </span>
                                <span className="text-right text-muted-foreground">
                                  {u.retrabalhoPct.toFixed(1)}%
                                </span>
                                <span className="text-right font-mono text-primary">
                                  {u.score.toLocaleString("pt-BR")}
                                </span>
                              </div>
                            ))}
                            {users.length === 0 && (
                              <div className="px-4 py-3 text-xs text-muted-foreground text-center">
                                Sem usuários no período
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="user" className="mt-4">
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left w-10">#</th>
                        <th className="px-4 py-3 text-left">Usuário</th>
                        <th className="px-4 py-3 text-left">Departamento</th>
                        <th className="px-4 py-3 text-right">Docs</th>
                        <th className="px-4 py-3 text-right">Valor R$</th>
                        <th className="px-4 py-3 text-right">Ticket médio</th>
                        <th className="px-4 py-3 text-right">Edições</th>
                        <th className="px-4 py-3 text-right">Cancel.</th>
                        <th className="px-4 py-3 text-right">Retrab.</th>
                        <th className="px-4 py-3 text-right">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUser.map((u, i) => (
                        <tr
                          key={u.userCode}
                          className="border-t border-border hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-2 font-medium text-foreground">
                            {u.userName}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({u.userCode})
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{u.department}</td>
                          <td className="px-4 py-2 text-right font-mono">
                            {u.docsCriados.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatBRL(u.valorTotalBRL)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                            {formatBRL(u.ticketMedio)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                            {u.edicoesFeitas}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                            {u.docsCancelados}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Badge
                              variant="secondary"
                              className={
                                u.retrabalhoPct > 15
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-primary/15 text-primary"
                              }
                            >
                              {u.retrabalhoPct.toFixed(1)}%
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-primary">
                            {u.score.toLocaleString("pt-BR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="doctype" className="mt-4">
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left">Tipo</th>
                        <th className="px-4 py-3 text-right">Docs criados</th>
                        <th className="px-4 py-3 text-right">Valor R$</th>
                        <th className="px-4 py-3 text-right">Edições</th>
                        <th className="px-4 py-3 text-right">Cancelados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byDoc.map((d) => (
                        <tr
                          key={d.docType}
                          className="border-t border-border hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-2 font-medium text-foreground">
                            {docTypeLabel(d.docType)}{" "}
                            <span className="text-xs text-muted-foreground">({d.docType})</span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {d.docsCriados.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatBRL(d.valorTotalBRL)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                            {d.edicoesFeitas}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                            {d.docsCancelados}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
