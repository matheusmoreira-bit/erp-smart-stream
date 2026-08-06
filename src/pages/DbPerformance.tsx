import { useMemo, useState } from "react";
import { Activity, Database, Gauge, RefreshCw, Timer, X } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDbPerformance } from "@/hooks/useDbPerformance";

const WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

const THRESHOLDS = [500, 1000, 3000];

const ms = (v: number | null | undefined) => {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`;
};

const durationTone = (v: number) =>
  v >= 3000 ? "text-destructive" : v >= 1000 ? "text-amber-500" : "text-foreground";

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className={cn("mt-2 font-mono text-2xl font-bold tabular-nums", tone)}>{value}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function DbPerformance() {
  const [hours, setHours] = useState(24);
  const [minMs, setMinMs] = useState(1000);
  const [screen, setScreen] = useState<string | null>(null);
  const { screens, targets, slow, pgSlow, loading, error, reload } = useDbPerformance(hours, screen, minMs);

  const totals = useMemo(() => {
    const total = screens.reduce((s, r) => s + Number(r.total), 0);
    const time = screens.reduce((s, r) => s + Number(r.total_ms), 0);
    const errors = screens.reduce((s, r) => s + Number(r.errors), 0);
    const slowCount = screens.reduce((s, r) => s + Number(r.slow_count), 0);
    const p95 = screens.length ? Math.max(...screens.map((r) => Number(r.p95_ms))) : 0;
    return {
      total,
      avg: total ? time / total : 0,
      errors,
      slowCount,
      p95,
    };
  }, [screens]);

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Desempenho do banco"
        description="Tempo médio, percentis e volume de consultas por tela"
        icon={<Database className="h-5 w-5" />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={loading} aria-label="Recarregar métricas">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Janela:</span>
          {WINDOWS.map((w) => (
            <Button key={w.hours} size="sm" variant={hours === w.hours ? "default" : "outline"} onClick={() => setHours(w.hours)}>
              {w.label}
            </Button>
          ))}
          <span className="ml-3 text-xs text-muted-foreground">Lenta acima de:</span>
          {THRESHOLDS.map((t) => (
            <Button key={t} size="sm" variant={minMs === t ? "default" : "outline"} onClick={() => setMinMs(t)}>
              {ms(t)}
            </Button>
          ))}
          {screen && (
            <Badge variant="secondary" className="ml-2 gap-1">
              Tela: {screen}
              <button onClick={() => setScreen(null)} aria-label="Limpar filtro de tela">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi icon={<Activity className="h-4 w-4" />} label="Consultas" value={totals.total.toLocaleString("pt-BR")} hint={`${totals.errors} com erro`} />
          <Kpi icon={<Timer className="h-4 w-4" />} label="Tempo médio" value={ms(totals.avg)} tone={durationTone(totals.avg)} />
          <Kpi icon={<Gauge className="h-4 w-4" />} label="Pior p95 por tela" value={ms(totals.p95)} tone={durationTone(totals.p95)} />
          <Kpi icon={<Timer className="h-4 w-4" />} label={`Acima de ${ms(minMs)}`} value={totals.slowCount.toLocaleString("pt-BR")} tone={totals.slowCount ? "text-amber-500" : undefined} />
        </div>

        <Tabs defaultValue="screens">
          <TabsList>
            <TabsTrigger value="screens">Por tela</TabsTrigger>
            <TabsTrigger value="queries">Por consulta</TabsTrigger>
            <TabsTrigger value="slow">Consultas lentas</TabsTrigger>
            <TabsTrigger value="pg">Postgres</TabsTrigger>
          </TabsList>

          <TabsContent value="screens" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consultas por tela</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : screens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sem dados na janela selecionada. As métricas são coletadas conforme os usuários navegam.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tela</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                        <TableHead className="text-right">Médio</TableHead>
                        <TableHead className="text-right">p50</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                        <TableHead className="text-right">p99</TableHead>
                        <TableHead className="text-right">Máx.</TableHead>
                        <TableHead className="text-right">Lentas</TableHead>
                        <TableHead className="text-right">Erros</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {screens.map((r) => (
                        <TableRow key={r.screen} className="cursor-pointer" onClick={() => setScreen(r.screen)}>
                          <TableCell className="font-medium">{r.screen}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.total).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", durationTone(Number(r.avg_ms)))}>{ms(Number(r.avg_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.p50_ms))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", durationTone(Number(r.p95_ms)))}>{ms(Number(r.p95_ms))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", durationTone(Number(r.p99_ms)))}>{ms(Number(r.p99_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.max_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.slow_count).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", Number(r.errors) > 0 && "text-destructive")}>{Number(r.errors)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="queries" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Consultas {screen ? `da tela “${screen}”` : "de todas as telas"}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : targets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados na janela selecionada.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Consulta</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead>Operação</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                        <TableHead className="text-right">Médio</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                        <TableHead className="text-right">p99</TableHead>
                        <TableHead className="text-right">Tempo total</TableHead>
                        <TableHead className="text-right">Erros</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {targets.map((r) => (
                        <TableRow key={`${r.source}-${r.target}-${r.operation}`}>
                          <TableCell className="max-w-[280px] truncate font-mono text-xs">{r.target}</TableCell>
                          <TableCell><Badge variant="outline">{r.source}</Badge></TableCell>
                          <TableCell className="text-xs">{r.operation}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.total).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", durationTone(Number(r.avg_ms)))}>{ms(Number(r.avg_ms))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", durationTone(Number(r.p95_ms)))}>{ms(Number(r.p95_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.p99_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.total_ms))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", Number(r.errors) > 0 && "text-destructive")}>{Number(r.errors)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="slow" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Amostras acima de {ms(minMs)}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : slow.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma consulta lenta registrada na janela.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quando</TableHead>
                        <TableHead>Tela</TableHead>
                        <TableHead>Consulta</TableHead>
                        <TableHead className="text-right">Duração</TableHead>
                        <TableHead className="text-right">Linhas</TableHead>
                        <TableHead>Empresa</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {slow.map((r, i) => (
                        <TableRow key={`${r.started_at}-${i}`}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {new Date(r.started_at).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-xs">{r.screen}</TableCell>
                          <TableCell className="max-w-[260px] truncate font-mono text-xs">{r.target}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", durationTone(Number(r.duration_ms)))}>{ms(Number(r.duration_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.row_count ?? "—"}</TableCell>
                          <TableCell className="text-xs">{r.company_db ?? "—"}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", !r.ok && "text-destructive")}>{r.status_code ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pg" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consultas mais custosas no Postgres</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : pgSlow.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Estatísticas do banco indisponíveis no momento.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SQL</TableHead>
                        <TableHead className="text-right">Chamadas</TableHead>
                        <TableHead className="text-right">Médio</TableHead>
                        <TableHead className="text-right">Máx.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pgSlow.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-[520px] truncate font-mono text-[11px]" title={r.query}>{r.query}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.calls).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", durationTone(Number(r.mean_ms)))}>{ms(Number(r.mean_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.max_ms))}</TableCell>
                          <TableCell className="text-right tabular-nums">{ms(Number(r.total_ms))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <p className="text-[11px] text-muted-foreground">
          As métricas são coletadas no navegador dos usuários (cada chamada ao backend é medida e associada à tela)
          e mantidas por 14 dias. Somente administradores podem consultá-las.
        </p>
      </main>
    </div>
  );
}
