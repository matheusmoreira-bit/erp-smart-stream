import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
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
import { Activity, Gauge, RefreshCw, Timer, Workflow } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFlowPerformance } from "@/hooks/useFlowPerformance";

const WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

const PERIODS = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

const ms = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`;

const hrs = (v: number | null | undefined) => {
  if (v == null) return "—";
  const n = Number(v);
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 48) return `${n.toFixed(1)} h`;
  return `${(n / 24).toFixed(1)} d`;
};

const tone = (v: number | null | undefined) =>
  v == null ? "" : v >= 5000 ? "text-destructive" : v >= 2000 ? "text-amber-500" : "text-foreground";

function Kpi({ icon, label, value, hint, valueTone }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; valueTone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span>{icon}</span>
      </div>
      <div className={cn("mt-2 font-mono text-2xl font-bold tabular-nums", valueTone)}>{value}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LatencyChart({ data, loading }: { data: { bucket: string; avg_ms: number | null; p95_ms: number | null }[]; loading: boolean }) {
  const points = useMemo(
    () =>
      data.map((d) => ({
        t: new Date(d.bucket).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
        Médio: d.avg_ms == null ? null : Number(d.avg_ms),
        p95: d.p95_ms == null ? null : Number(d.p95_ms),
      })),
    [data],
  );
  if (loading) return <Skeleton className="h-56 w-full" />;
  if (points.length === 0) return <p className="text-sm text-muted-foreground">Sem dados na janela selecionada.</p>;
  return (
    <ResponsiveContainer width="100%" height={224}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="t" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" minTickGap={24} />
        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="ms" />
        <Tooltip
          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          formatter={(v: number) => ms(v)}
        />
        <Line type="monotone" dataKey="Médio" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="p95" stroke="hsl(var(--destructive))" dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function FlowPerformance() {
  const [hours, setHours] = useState(24);
  const [days, setDays] = useState(30);
  const { edge, series, expenseReadSeries, expenseRead, stages, loading, error, reload } = useFlowPerformance(hours, days);

  const totals = useMemo(() => {
    const total = edge.reduce((s, r) => s + Number(r.total), 0);
    const errors = edge.reduce((s, r) => s + Number(r.errors), 0);
    const weighted = edge.reduce((s, r) => s + Number(r.avg_ms ?? 0) * Number(r.total), 0);
    const worstP95 = edge.length ? Math.max(...edge.map((r) => Number(r.p95_ms ?? 0))) : 0;
    const er = expenseRead.reduce((s, r) => s + Number(r.total), 0);
    const erTime = expenseRead.reduce((s, r) => s + Number(r.avg_ms) * Number(r.total), 0);
    return {
      total,
      errors,
      avg: total ? weighted / total : 0,
      worstP95,
      erTotal: er,
      erAvg: er ? erTime / er : 0,
    };
  }, [edge, expenseRead]);

  const volume = useMemo(
    () =>
      series.map((d) => ({
        t: new Date(d.bucket).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit" }),
        Chamadas: Number(d.total),
        Erros: Number(d.errors),
      })),
    [series],
  );

  const stageChart = useMemo(
    () => stages.map((s) => ({ etapa: s.stage.replace(/ →.*/, " →…"), Médio: Number(s.avg_hours), p95: Number(s.p95_hours), full: s.stage })),
    [stages],
  );

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Painel de performance"
        description="Latência das funções do backend, leitura de despesas e tempo por etapa do fluxo"
        icon={<Gauge className="h-5 w-5" />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={loading} aria-label="Recarregar métricas">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Janela técnica:</span>
          {WINDOWS.map((w) => (
            <Button key={w.hours} size="sm" variant={hours === w.hours ? "default" : "outline"} onClick={() => setHours(w.hours)}>
              {w.label}
            </Button>
          ))}
          <span className="ml-3 text-xs text-muted-foreground">Fluxo:</span>
          {PERIODS.map((p) => (
            <Button key={p.days} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)}>
              {p.label}
            </Button>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi icon={<Activity className="h-4 w-4" />} label="Chamadas ao backend" value={totals.total.toLocaleString("pt-BR")} hint={`${totals.errors} com erro`} />
          <Kpi icon={<Timer className="h-4 w-4" />} label="Tempo médio" value={ms(totals.avg)} valueTone={tone(totals.avg)} />
          <Kpi icon={<Gauge className="h-4 w-4" />} label="Pior p95" value={ms(totals.worstP95)} valueTone={tone(totals.worstP95)} />
          <Kpi
            icon={<Workflow className="h-4 w-4" />}
            label="expense-read (médio)"
            value={ms(totals.erAvg)}
            hint={`${totals.erTotal.toLocaleString("pt-BR")} leituras`}
            valueTone={tone(totals.erAvg)}
          />
        </div>

        <Tabs defaultValue="edge">
          <TabsList>
            <TabsTrigger value="edge">Backend (edge)</TabsTrigger>
            <TabsTrigger value="expense">Leitura de despesas</TabsTrigger>
            <TabsTrigger value="flow">Etapas do fluxo</TabsTrigger>
          </TabsList>

          <TabsContent value="edge" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Evolução da latência</CardTitle></CardHeader>
              <CardContent><LatencyChart data={series} loading={loading} /></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Volume e erros</CardTitle></CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : volume.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados na janela selecionada.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={192}>
                    <AreaChart data={volume} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="t" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" minTickGap={24} />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="Chamadas" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" />
                      <Area type="monotone" dataKey="Erros" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Funções do backend</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : edge.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados na janela selecionada.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Função</TableHead>
                        <TableHead className="text-right">Chamadas</TableHead>
                        <TableHead className="text-right">Médio</TableHead>
                        <TableHead className="text-right">p50</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                        <TableHead className="text-right">p99</TableHead>
                        <TableHead className="text-right">Erros</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {edge.map((r) => (
                        <TableRow key={r.function_name} className={cn(r.function_name === "expense-read" && "bg-muted/40")}>
                          <TableCell className="font-mono text-xs">{r.function_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.total).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", tone(Number(r.avg_ms)))}>{ms(Number(r.avg_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.p50_ms))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", tone(Number(r.p95_ms)))}>{ms(Number(r.p95_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.p99_ms))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", Number(r.errors) > 0 && "text-destructive")}>
                            {Number(r.errors)}{r.error_rate != null ? ` (${Number(r.error_rate).toFixed(1)}%)` : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="expense" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">expense-read — evolução da latência</CardTitle></CardHeader>
              <CardContent><LatencyChart data={expenseReadSeries} loading={loading} /></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Leitura de despesas por tela</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : expenseRead.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sem leituras registradas na janela. As métricas são coletadas conforme os usuários navegam.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tela</TableHead>
                        <TableHead className="text-right">Leituras</TableHead>
                        <TableHead className="text-right">Médio</TableHead>
                        <TableHead className="text-right">p50</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                        <TableHead className="text-right">Máx.</TableHead>
                        <TableHead className="text-right">Linhas (média)</TableHead>
                        <TableHead className="text-right">Erros</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenseRead.map((r) => (
                        <TableRow key={r.screen}>
                          <TableCell className="font-medium">{r.screen}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.total).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", tone(Number(r.avg_ms)))}>{ms(Number(r.avg_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.p50_ms))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", tone(Number(r.p95_ms)))}>{ms(Number(r.p95_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.max_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.avg_rows == null ? "—" : Number(r.avg_rows).toFixed(0)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", Number(r.errors) > 0 && "text-destructive")}>{Number(r.errors)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="flow" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tempo médio por etapa (últimos {days} dias)</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-56 w-full" />
                ) : stageChart.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem documentos concluídos no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={224}>
                    <BarChart data={stageChart} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="etapa" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={0} />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="h" />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: number) => hrs(v)}
                        labelFormatter={(_l, p) => (p?.[0]?.payload as { full?: string })?.full ?? ""}
                      />
                      <Bar dataKey="Médio" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="p95" fill="hsl(var(--muted-foreground) / 0.5)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Detalhe por etapa</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : stages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem documentos concluídos no período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Etapa</TableHead>
                        <TableHead className="text-right">Documentos</TableHead>
                        <TableHead className="text-right">Médio</TableHead>
                        <TableHead className="text-right">Mediana</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                        <TableHead className="text-right">Máx.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stages.map((s) => (
                        <TableRow key={s.stage}>
                          <TableCell className="font-medium">{s.stage}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(s.docs).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className="text-right tabular-nums">{hrs(s.avg_hours)}</TableCell>
                          <TableCell className="text-right tabular-nums">{hrs(s.p50_hours)}</TableCell>
                          <TableCell className="text-right tabular-nums">{hrs(s.p95_hours)}</TableCell>
                          <TableCell className="text-right tabular-nums">{hrs(s.max_hours)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
