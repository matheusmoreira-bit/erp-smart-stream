import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, Shuffle, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  buildRebalanceSuggestions,
  rebalanceToCsv,
  type RebalanceSuggestion,
} from "@/lib/sla-rebalance";
import type { SlaPending, SlaStep } from "@/lib/sla-metrics";

interface Props {
  steps: SlaStep[];
  pending: SlaPending[];
  slaHours: number;
}

const fmtH = (v: number) => `${v.toFixed(1)}h`;

const severityVariant = (s: RebalanceSuggestion["severity"]) =>
  s === "alta" ? "destructive" : s === "média" ? "secondary" : "outline";

export function SlaRebalancePanel({ steps, pending, slaHours }: Props) {
  const [onlyHigh, setOnlyHigh] = useState(false);

  const { profiles, suggestions } = useMemo(
    () => buildRebalanceSuggestions(steps, pending, { slaHours }),
    [steps, pending, slaHours],
  );

  const rows = useMemo(
    () => (onlyHigh ? suggestions.filter((s) => s.severity === "alta") : suggestions),
    [suggestions, onlyHigh],
  );

  const bottlenecks = profiles.filter((p) => p.recurringBottleneck);

  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([rebalanceToCsv(rows)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `sla-redistribuicao-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shuffle className="w-4 h-4" />
          Recomendações de redistribuição
          {bottlenecks.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {bottlenecks.length} gargalo(s) recorrente(s)
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="reb-high" checked={onlyHigh} onCheckedChange={setOnlyHigh} />
            <Label htmlFor="reb-high" className="text-xs">Só severidade alta</Label>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum gargalo recorrente identificado na janela — a distribuição atual de alçadas está
            dentro do SLA ou não há histórico suficiente (mínimo de 4 decisões e 2 semanas ruins por
            aprovador).
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma recomendação de severidade alta.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((s) => (
              <li key={s.id} className="rounded-md border border-border/60 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant={severityVariant(s.severity)} className="capitalize">{s.severity}</Badge>
                  <span className="font-mono font-medium">{s.costCenter}</span>
                  {s.project !== "—" && (
                    <Badge variant="secondary" className="text-[10px]">{s.project}</Badge>
                  )}
                  <span className="text-muted-foreground">atual:</span>
                  <span className="font-medium">{s.currentApprover}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    {s.decisions} decisões · média {fmtH(s.avgHours)} · {s.breachPct}% fora
                    {s.pendingOverdue > 0 && (
                      <span className="text-destructive"> · {s.pendingOverdue} atrasado(s)</span>
                    )}
                  </span>
                </div>

                <p className="text-[11px] text-muted-foreground">{s.reason}</p>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" /> Sugestões:
                  </span>
                  {s.candidates.map((c, i) => (
                    <Badge
                      key={c.approver}
                      variant={i === 0 ? "default" : "outline"}
                      className="gap-1 font-normal"
                    >
                      {c.approver}
                      <span className="font-mono opacity-80">
                        {fmtH(c.avgHours)} · {c.breachPct}% fora
                      </span>
                      {c.sameScope && <span className="text-[9px] uppercase">mesmo escopo</span>}
                    </Badge>
                  ))}
                  {s.expectedGainHours > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      ganho estimado ~{s.expectedGainHours.toFixed(1)}h úteis/decisão
                    </span>
                  )}
                  <Button asChild variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs">
                    <Link to="/aprovacoes/regras">
                      Ajustar regra <ArrowRight className="w-3 h-3" />
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground">
          Candidatos precisam ser ao menos 25% mais rápidos que o aprovador atual, estar dentro do SLA
          e ter fila compatível; quem já decide o mesmo CC/projeto é priorizado.
        </p>
      </CardContent>
    </Card>
  );
}
