import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, LineChart, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildSlaTrend, type SlaStep, type SlaTrendDelta } from "@/lib/sla-metrics";

interface Props {
  steps: SlaStep[];
  slaHours: number;
  /** Janela de dados carregada; limita as opções disponíveis. */
  loadedDays: number;
}

const fmtH = (v: number) => `${v.toFixed(1)}h`;

function DeltaBadge({ d }: { d: SlaTrendDelta }) {
  const neutral = !d.worse && Math.abs(d.diffPct) < 5;
  const Icon = neutral ? ArrowRight : d.diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Badge variant={d.worse ? "destructive" : neutral ? "outline" : "secondary"} className="font-mono gap-1">
      <Icon className="w-3 h-3" />
      {d.diffPct > 0 ? "+" : ""}
      {d.diffPct}%
    </Badge>
  );
}

export function SlaTrendPanel({ steps, slaHours, loadedDays }: Props) {
  const [windowDays, setWindowDays] = useState<30 | 90>(loadedDays >= 90 ? 90 : 30);
  const trend = useMemo(
    () => buildSlaTrend(steps, slaHours, Math.min(windowDays, loadedDays)),
    [steps, slaHours, windowDays, loadedDays],
  );

  const maxAvg = Math.max(1, ...trend.points.map((p) => p.avgHours));

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base flex items-center gap-2">
          <LineChart className="w-4 h-4" />
          Tendência semanal
          {trend.worsening && (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <TriangleAlert className="w-3 h-3" /> Piora detectada
            </Badge>
          )}
        </CardTitle>
        <Tabs value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v) as 30 | 90)}>
          <TabsList>
            <TabsTrigger value="30">30 dias</TabsTrigger>
            <TabsTrigger value="90" disabled={loadedDays < 90}>90 dias</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-4">
        {trend.points.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem decisões de aprovação na janela selecionada.</p>
        ) : (
          <>
            {trend.deltas.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                {trend.deltas.map((d) => (
                  <div key={d.metric} className="rounded-md border border-border/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">{d.label}</span>
                      <DeltaBadge d={d} />
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono">
                      {d.metric === "within" ? `${d.current}%` : fmtH(d.current)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      média anterior: {d.metric === "within" ? `${d.baseline}%` : fmtH(d.baseline)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">Semana</th>
                    <th className="text-right py-2 px-2">Decisões</th>
                    <th className="text-left py-2 px-2 w-[180px]">Tempo médio</th>
                    <th className="text-right py-2 px-2">P90</th>
                    <th className="text-right py-2 pl-2">Dentro do SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.points.map((p, i) => {
                    const last = i === trend.points.length - 1;
                    return (
                      <tr
                        key={p.weekStart}
                        className={`border-b border-border/40 ${last ? "bg-muted/40" : ""}`}
                      >
                        <td className="py-2 pr-3 font-medium">{p.label}</td>
                        <td className="py-2 px-2 text-right font-mono">{p.count}</td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded bg-muted overflow-hidden">
                              <div
                                className={`h-full ${p.avgHours > slaHours ? "bg-destructive" : "bg-primary"}`}
                                style={{ width: `${Math.round((p.avgHours / maxAvg) * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono w-14 text-right">{fmtH(p.avgHours)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{fmtH(p.p90Hours)}</td>
                        <td className="py-2 pl-2 text-right">
                          <Badge variant={p.withinPct < 75 ? "destructive" : "outline"} className="font-mono">
                            {p.withinPct}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A piora compara a última semana com a média das semanas anteriores da janela (+15% em tempo
              médio/P90 ou -10% na taxa dentro do SLA).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
