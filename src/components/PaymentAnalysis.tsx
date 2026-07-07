import { useMemo, useState } from "react";
import { Loader2, RefreshCw, DollarSign, AlertTriangle, TrendingUp, Users, Clock, Calendar } from "lucide-react";
import { usePaymentAnalysis, type PaymentAnalysisRow } from "@/hooks/usePaymentAnalysis";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { PeriodFilter, filterByPeriod, DEFAULT_PERIOD, type PeriodFilterValue } from "@/components/PeriodFilter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area, ComposedChart,
} from "recharts";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 160 60% 45%))",
  "hsl(var(--chart-3, 30 80% 55%))",
  "hsl(var(--chart-4, 280 65% 60%))",
  "hsl(var(--chart-5, 340 75% 55%))",
  "hsl(200, 70%, 50%)",
  "hsl(120, 50%, 50%)",
  "hsl(45, 90%, 50%)",
];

function fmt(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseDate(d: string | null): Date | null {
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateShort(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ── Analytics computations ── */
function usePaymentAnalytics(rows: PaymentAnalysisRow[]) {
  return useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── KPIs ──
    const totalPago = rows.reduce((s, r) => s + (r.Valor_Total_Pago || 0), 0);
    const activeRows = rows.filter((r) => r.Status_Pagamento !== "Cancelado");
    const avgPayment = activeRows.length > 0 ? totalPago / activeRows.length : 0;
    const latePayments = rows.filter((r) => (r.Dias_Vencimento_Ate_Pagamento ?? 0) > 0);
    const totalLate = latePayments.reduce((s, r) => s + (r.Valor_Total_Pago || 0), 0);
    const avgDaysLate = latePayments.length > 0
      ? Math.round(latePayments.reduce((s, r) => s + (r.Dias_Vencimento_Ate_Pagamento || 0), 0) / latePayments.length)
      : 0;

    // Estimated penalties (2% per month pro-rata)
    const estimatedPenalties = latePayments.reduce((s, r) => {
      const days = r.Dias_Vencimento_Ate_Pagamento || 0;
      return s + (r.Valor_Total_Pago || 0) * 0.02 * (days / 30);
    }, 0);

    // ── Volume por dia (últimos 30 dias) ──
    const dailyMap = new Map<string, { count: number; total: number }>();
    // Build a map of historical averages by day-of-month (excluding current month)
    const dayOfMonthTotals = new Map<number, number[]>();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    for (const r of rows) {
      const d = parseDate(r.Data_do_Pagamento);
      if (!d) continue;

      // Only include past months in historical average
      const isCurrentMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      if (!isCurrentMonth) {
        const dom = d.getDate();
        if (!dayOfMonthTotals.has(dom)) dayOfMonthTotals.set(dom, []);
        dayOfMonthTotals.get(dom)!.push(r.Valor_Total_Pago || 0);
      }

      if (d >= thirtyDaysAgo) {
        const key = formatDateShort(d);
        const prev = dailyMap.get(key) || { count: 0, total: 0 };
        dailyMap.set(key, { count: prev.count + 1, total: prev.total + (r.Valor_Total_Pago || 0) });
      }
    }

    // Build last 30 days array
    const dailyVolume: { date: string; count: number; total: number; media: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = formatDateShort(d);
      const entry = dailyMap.get(key) || { count: 0, total: 0 };
      const dom = d.getDate();
      const historicalValues = dayOfMonthTotals.get(dom) || [];
      const media = historicalValues.length > 0
        ? historicalValues.reduce((s, v) => s + v, 0) / historicalValues.length
        : 0;
      dailyVolume.push({ date: key, count: entry.count, total: entry.total, media });
    }

    // ── Top fornecedores recorrentes ──
    const supplierMap = new Map<string, { count: number; total: number; name: string }>();
    for (const r of activeRows) {
      const key = r.Cod_PN;
      const prev = supplierMap.get(key) || { count: 0, total: 0, name: r.Nome_PN };
      supplierMap.set(key, { count: prev.count + 1, total: prev.total + (r.Valor_Total_Pago || 0), name: r.Nome_PN });
    }
    const topSuppliers = Array.from(supplierMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map((s) => ({
        name: s.name.length > 25 ? s.name.substring(0, 22) + "..." : s.name,
        fullName: s.name,
        count: s.count,
        total: s.total,
      }));

    // ── Status distribution ──
    const statusMap = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      const key = r.Status_Pagamento || "Desconhecido";
      const prev = statusMap.get(key) || { count: 0, total: 0 };
      statusMap.set(key, { count: prev.count + 1, total: prev.total + (r.Valor_Total_Pago || 0) });
    }
    const statusDistribution = Array.from(statusMap.entries()).map(([name, v]) => ({
      name,
      count: v.count,
      total: v.total,
    }));

    // ── Pagamentos por solicitante ──
    const requesterMap = new Map<string, { count: number; total: number }>();
    for (const r of activeRows) {
      const key = r.Nome_Solicitante || "Desconhecido";
      const prev = requesterMap.get(key) || { count: 0, total: 0 };
      requesterMap.set(key, { count: prev.count + 1, total: prev.total + (r.Valor_Total_Pago || 0) });
    }
    const topRequesters = Array.from(requesterMap.entries())
      .map(([name, v]) => ({ name, count: v.count, total: v.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // ── Distribuição de dias de atraso ──
    const lateDistribution = [
      { range: "No prazo", count: activeRows.filter((r) => (r.Dias_Vencimento_Ate_Pagamento ?? 0) <= 0).length },
      { range: "1-5 dias", count: latePayments.filter((r) => (r.Dias_Vencimento_Ate_Pagamento ?? 0) > 0 && (r.Dias_Vencimento_Ate_Pagamento ?? 0) <= 5).length },
      { range: "6-15 dias", count: latePayments.filter((r) => (r.Dias_Vencimento_Ate_Pagamento ?? 0) > 5 && (r.Dias_Vencimento_Ate_Pagamento ?? 0) <= 15).length },
      { range: "16-30 dias", count: latePayments.filter((r) => (r.Dias_Vencimento_Ate_Pagamento ?? 0) > 15 && (r.Dias_Vencimento_Ate_Pagamento ?? 0) <= 30).length },
      { range: "> 30 dias", count: latePayments.filter((r) => (r.Dias_Vencimento_Ate_Pagamento ?? 0) > 30).length },
    ];

    // ── Pagamentos por filial ──
    const branchMap = new Map<string, { count: number; total: number }>();
    for (const r of activeRows) {
      const key = r.Filial || "Desconhecida";
      const prev = branchMap.get(key) || { count: 0, total: 0 };
      branchMap.set(key, { count: prev.count + 1, total: prev.total + (r.Valor_Total_Pago || 0) });
    }
    const branchDistribution = Array.from(branchMap.entries())
      .map(([name, v]) => ({ name: name.length > 20 ? name.substring(0, 17) + "..." : name, count: v.count, total: v.total }))
      .sort((a, b) => b.total - a.total);

    return {
      totalPago,
      avgPayment,
      totalLate,
      lateCount: latePayments.length,
      avgDaysLate,
      estimatedPenalties,
      activeCount: activeRows.length,
      dailyVolume,
      topSuppliers,
      statusDistribution,
      topRequesters,
      lateDistribution,
      branchDistribution,
    };
  }, [rows]);
}

/* ── Custom tooltip ── */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
          {p.name}: {typeof p.value === "number" && p.value > 100 ? fmtCurrency(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{d.name}</p>
      <p className="text-muted-foreground">{d.value} documentos</p>
      {d.payload?.total != null && <p className="text-muted-foreground">{fmtCurrency(d.payload.total)}</p>}
    </div>
  );
}

/* ── Section card ── */
function ChartCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass-card p-3 sm:p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-foreground mb-3 sm:mb-4">{title}</h3>
      {children}
    </div>
  );
}

/* ── Main component ── */
export function PaymentAnalysis() {
  const { rows: allRows, isLoading, error, refresh } = usePaymentAnalysis();
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PeriodFilterValue>(DEFAULT_PERIOD);

  const rows = useMemo(
    () => filterByPeriod(allRows, period, (r) => r.Data_do_Pagamento),
    [allRows, period]
  );
  const analytics = usePaymentAnalytics(rows);

  if (error) {
    return (
      <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">
        {error}
        <Button variant="ghost" size="sm" onClick={refresh} className="ml-2">
          <RefreshCw className="w-4 h-4 mr-1" /> Tentar novamente
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Carregando análise de pagamentos...</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-muted-foreground">
        Nenhum dado encontrado na view VW_ANALISE_PAGAMENTOS_DETALHADO.
      </div>
    );
  }

  const filtered = search
    ? rows.filter((r) => {
        const q = search.toLowerCase();
        return (
          String(r.Numero_Pagamento_SAP || "").includes(q) ||
          (r.Nome_PN || "").toLowerCase().includes(q) ||
          (r.Cod_PN || "").toLowerCase().includes(q) ||
          (r.Nome_Solicitante || "").toLowerCase().includes(q)
        );
      })
    : rows;

  const columns = Object.keys(rows[0]);

  return (
    <Tabs defaultValue="dashboard" className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="tabela">Tabela</TabsTrigger>
          </TabsList>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rows.length} registros</span>
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <TabsContent value="dashboard" className="space-y-6 mt-0">
        {/* Shared SVG gradient defs */}
        <svg width={0} height={0} className="absolute">
          <defs>
            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            </linearGradient>
            <linearGradient id="barGradientH" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
            </linearGradient>
            <linearGradient id="lineGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.15} />
              <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
            </linearGradient>
          </defs>
        </svg>
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <MetricCard
            title="Total Pago"
            value={fmtCurrency(analytics.totalPago)}
            subtitle={`${analytics.activeCount} pagamentos ativos`}
            icon={DollarSign}
            delay={0}
          />
          <MetricCard
            title="Valor Médio"
            value={fmtCurrency(analytics.avgPayment)}
            subtitle="por pagamento"
            icon={TrendingUp}
            delay={0.1}
          />
          <MetricCard
            title="Em Atraso"
            value={fmtCurrency(analytics.totalLate)}
            subtitle={`${analytics.lateCount} pagamentos · média ${analytics.avgDaysLate}d`}
            icon={AlertTriangle}
            delay={0.2}
          />
          <MetricCard
            title="Multas Estimadas"
            value={fmtCurrency(analytics.estimatedPenalties)}
            subtitle="2% a.m. pro-rata sobre atrasos"
            icon={Clock}
            delay={0.3}
          />
        </div>

        {/* Volume diário + média comparativa */}
        <ChartCard title="Volume de Pagamentos — Últimos 30 Dias vs. Média Histórica">
          <div className="h-[240px] sm:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analytics.dailyVolume} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  </linearGradient>
                  <linearGradient id="barGradientH" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                  </linearGradient>
                  <linearGradient id="lineGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={2} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmt} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total" name="Valor pago" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                <Area dataKey="media" name="Média histórica (área)" type="monotone" fill="url(#lineGlow)" stroke="none" />
                <Line dataKey="media" name="Média histórica" type="monotone" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--destructive))" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Top fornecedores */}
          <ChartCard title="Top Fornecedores por Valor">
            <div className="h-[240px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.topSuppliers} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmt} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={130} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Total pago" fill="url(#barGradientH)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Distribuição de atraso */}
          <ChartCard title="Distribuição de Atrasos">
            <div className="h-[240px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.lateDistribution}
                    dataKey="count"
                    nameKey="range"
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={4}
                    cornerRadius={6}
                    label={({ range, count }) => `${range}: ${count}`}
                    labelLine={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  >
                    {analytics.lateDistribution.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Pagamentos por solicitante */}
          <ChartCard title="Volume por Solicitante">
            <div className="h-[240px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.topRequesters} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmt} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={120} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Total pago" radius={[0, 6, 6, 0]}>
                    {analytics.topRequesters.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Status dos pagamentos */}
          <ChartCard title="Status dos Pagamentos">
            <div className="h-[240px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusDistribution}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={4}
                    cornerRadius={6}
                    label={({ name, count }) => `${name}: ${count}`}
                    labelLine={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  >
                    {analytics.statusDistribution.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* Filiais */}
        {analytics.branchDistribution.length > 1 && (
          <ChartCard title="Volume por Filial">
            <div className="h-[220px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.branchDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmt} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Total pago" fill="url(#barGradient)" radius={[6, 6, 0, 0]}>
                    {analytics.branchDistribution.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        {/* Fornecedores recorrentes table */}
        <ChartCard title="Fornecedores Recorrentes (mais de 3 pagamentos)">
          <div className="overflow-auto max-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Fornecedor</TableHead>
                  <TableHead className="text-xs text-right">Pagamentos</TableHead>
                  <TableHead className="text-xs text-right">Total Pago</TableHead>
                  <TableHead className="text-xs text-right">Ticket Médio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.topSuppliers
                  .filter((s) => s.count > 3)
                  .map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{s.fullName}</TableCell>
                      <TableCell className="text-xs text-right">{s.count}</TableCell>
                      <TableCell className="text-xs text-right">{fmtCurrency(s.total)}</TableCell>
                      <TableCell className="text-xs text-right">{fmtCurrency(s.total / s.count)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </ChartCard>
      </TabsContent>

      <TabsContent value="tabela" className="space-y-4 mt-0">
        <Input
          placeholder="Buscar por nº pagamento, fornecedor, solicitante..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="glass-card overflow-auto max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col} className="whitespace-nowrap text-xs">{col}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map((row, idx) => (
                <TableRow key={idx}>
                  {columns.map((col) => (
                    <TableCell key={col} className="whitespace-nowrap text-xs">
                      {formatCell(row[col])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString("pt-BR");
    return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Date(value).toLocaleDateString("pt-BR");
  }
  return String(value);
}
