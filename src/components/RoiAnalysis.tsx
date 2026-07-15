import { useMemo, useState } from "react";
import { useRoiAnalysis, type RoiParameters } from "@/hooks/useRoiAnalysis";
import { useSap } from "@/contexts/SapContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { PeriodFilter, DEFAULT_PERIOD, type PeriodFilterValue } from "@/components/PeriodFilter";
import { MetricCard } from "@/components/MetricCard";
import {
  Clock, DollarSign, TrendingDown, TrendingUp, AlertTriangle, RefreshCw, Loader2,
  Settings2, Building2, ArrowRight,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TemporalAnalysis } from "@/components/TemporalAnalysis";
import { DailyTimeSpentChart } from "@/components/DailyTimeSpentChart";

interface Props {
  mode: "company" | "consolidated";
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const fmtNum = (v: number, d = 1) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(v || 0);

export function RoiAnalysis({ mode }: Props) {
  const { session } = useSap();
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState<PeriodFilterValue>(DEFAULT_PERIOD);
  const [paramsOpen, setParamsOpen] = useState(false);

  const dateFilter = period.preset === "all"
    ? { from: undefined as Date | undefined, to: undefined as Date | undefined }
    : { from: period.range.from || undefined, to: period.range.to || undefined };

  const companyDb = mode === "company" ? session?.companyDB : undefined;
  const { metricsByCompany, totals, activeParams, params, loading, error, refresh } = useRoiAnalysis({
    companyDb,
    from: dateFilter.from,
    to: dateFilter.to,
    consolidated: mode === "consolidated",
  });

  const single = mode === "company" ? metricsByCompany[0] : null;

  const comparisonData = useMemo(() => {
    const data = mode === "company" && single
      ? [{
          nome: "Custo Tempo", SAP: single.custo_tempo_sap, "ERP Flow": single.custo_tempo_flow,
        }, {
          nome: "Licenças", SAP: single.custo_licencas_sap_mes, "ERP Flow": single.custo_licencas_flow_mes,
        }, {
          nome: "Prejuízo Atraso", SAP: single.prejuizo_atraso, "ERP Flow": single.prejuizo_atraso,
        }]
      : totals
        ? [{
            nome: "Custo Tempo", SAP: totals.custo_tempo_sap, "ERP Flow": totals.custo_tempo_flow,
          }, {
            nome: "Licenças", SAP: totals.custo_licencas_sap, "ERP Flow": totals.custo_licencas_flow,
          }, {
            nome: "Prejuízo Atraso", SAP: totals.prejuizo_atraso, "ERP Flow": totals.prejuizo_atraso,
          }]
        : [];
    return data;
  }, [mode, single, totals]);

  const displayEconomia = mode === "company" ? single?.economia_periodo || 0 : totals?.economia_periodo || 0;
  const displayEconomiaPct = mode === "company" ? single?.economia_percent || 0 : totals?.economia_percent || 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setParamsOpen(true)} className="text-muted-foreground">
              <Settings2 className="w-4 h-4 mr-1" /> Parâmetros
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="text-muted-foreground">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </div>

      {error && (
        <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Calculando análise…</p>
        </div>
      ) : !metricsByCompany.length ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          Nenhum dado encontrado para o período. Ajuste o filtro ou verifique se há documentos lançados.
        </div>
      ) : (
        <>
          {/* Métricas de destaque */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            <MetricCard
              title="Economia no Período"
              value={fmtBRL(displayEconomia)}
              subtitle={`${fmtNum(displayEconomiaPct, 1)}% vs SAP puro`}
              icon={TrendingDown}
              delay={0}
            />
            <MetricCard
              title="Horas Economizadas"
              value={`${fmtNum((mode === "company" ? single?.horas_sap : totals?.horas_sap) || 0)}h → ${fmtNum((mode === "company" ? single?.horas_flow : totals?.horas_flow) || 0)}h`}
              subtitle="Tempo operacional SAP vs Flow"
              icon={Clock}
              delay={0.1}
            />
            <MetricCard
              title="Prejuízo por Atraso"
              value={fmtBRL(mode === "company" ? single?.prejuizo_atraso || 0 : totals?.prejuizo_atraso || 0)}
              subtitle="Multa + juros em docs vencidos"
              icon={AlertTriangle}
              delay={0.2}
            />
            <MetricCard
              title="Docs Analisados"
              value={String(mode === "company" ? single?.n_docs || 0 : totals?.n_docs || 0)}
              subtitle={`${mode === "company" ? single?.n_approvals || 0 : totals?.n_approvals || 0} aprovações`}
              icon={DollarSign}
              delay={0.3}
            />
          </div>

          {/* Segregação: SAP direto vs ERP Flow */}
          {(() => {
            const nSap = mode === "company"
              ? (single?.n_docs_sap_only || 0)
              : metricsByCompany.reduce((s, m) => s + m.n_docs_sap_only, 0);
            const nFlow = mode === "company"
              ? (single?.n_docs_via_flow || 0)
              : metricsByCompany.reduce((s, m) => s + m.n_docs_via_flow, 0);
            const vSap = mode === "company"
              ? (single?.valor_sap_only || 0)
              : metricsByCompany.reduce((s, m) => s + m.valor_sap_only, 0);
            const vFlow = mode === "company"
              ? (single?.valor_via_flow || 0)
              : metricsByCompany.reduce((s, m) => s + m.valor_via_flow, 0);
            const aSap = mode === "company"
              ? (single?.docs_atrasados_sap_only || 0)
              : metricsByCompany.reduce((s, m) => s + m.docs_atrasados_sap_only, 0);
            const aFlow = mode === "company"
              ? (single?.docs_atrasados_via_flow || 0)
              : metricsByCompany.reduce((s, m) => s + m.docs_atrasados_via_flow, 0);
            const pSap = mode === "company"
              ? (single?.prejuizo_atraso_sap_only || 0)
              : metricsByCompany.reduce((s, m) => s + m.prejuizo_atraso_sap_only, 0);
            const pFlow = mode === "company"
              ? (single?.prejuizo_atraso_via_flow || 0)
              : metricsByCompany.reduce((s, m) => s + m.prejuizo_atraso_via_flow, 0);
            const total = nSap + nFlow;
            const pctSap = total > 0 ? (nSap / total) * 100 : 0;
            const pctFlow = total > 0 ? (nFlow / total) * 100 : 0;
            return (
              <div className="glass-card p-4 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    Origem dos Pedidos de Compra
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {total} pedidos analisados no período
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-destructive">Criados direto no SAP</span>
                      <span className="text-xs text-muted-foreground">{fmtNum(pctSap, 1)}%</span>
                    </div>
                    <div className="text-2xl font-bold font-mono text-foreground">{nSap}</div>
                    <ul className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border/40">
                      <li className="flex justify-between"><span>Valor total</span><span className="tabular-nums text-foreground">{fmtBRL(vSap)}</span></li>
                      <li className="flex justify-between"><span>Aprovados em atraso</span><span className="tabular-nums text-destructive">{aSap}</span></li>
                      <li className="flex justify-between"><span>Prejuízo (multa+juros)</span><span className="tabular-nums text-destructive">{fmtBRL(pSap)}</span></li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-primary">Via ERP Flow → integrados ao SAP</span>
                      <span className="text-xs text-muted-foreground">{fmtNum(pctFlow, 1)}%</span>
                    </div>
                    <div className="text-2xl font-bold font-mono text-foreground">{nFlow}</div>
                    <ul className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border/40">
                      <li className="flex justify-between"><span>Valor total</span><span className="tabular-nums text-foreground">{fmtBRL(vFlow)}</span></li>
                      <li className="flex justify-between"><span>Aprovados em atraso</span><span className="tabular-nums text-destructive">{aFlow}</span></li>
                      <li className="flex justify-between"><span>Prejuízo (multa+juros)</span><span className="tabular-nums text-destructive">{fmtBRL(pFlow)}</span></li>
                    </ul>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Comparativo aplicado sobre o total ({total} pedidos): a coluna <strong className="text-destructive">SAP</strong> nas análises abaixo assume que todos seriam lançados/aprovados diretamente no SAP; a coluna <strong className="text-primary">ERP Flow</strong> assume que todos passariam pelo Flow. A segregação acima mostra o cenário real observado no período.
                </p>
              </div>
            );
          })()}


          {/* Comparativo em barras */}
          <div className="glass-card p-4 sm:p-6">
            <h3 className="text-sm sm:text-base font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Composição de Custos — SAP vs ERP Flow
            </h3>
            <div className="h-[280px] sm:h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData} margin={{ left: 10, right: 10, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                  <XAxis dataKey="nome" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => fmtBRL(v).replace("R$", "").trim()}
                  />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtBRL(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="SAP" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ERP Flow" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Análise consolidada por empresa */}
          {mode === "consolidated" && (
            <div className="glass-card p-4 sm:p-6">
              <h3 className="text-sm sm:text-base font-semibold mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Detalhe por empresa
              </h3>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-xs sm:text-sm min-w-[720px]">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="text-left py-2 px-2 font-medium">Empresa</th>
                      <th className="text-right py-2 px-2 font-medium">Docs</th>
                      <th className="text-right py-2 px-2 font-medium">Atrasados</th>
                      <th className="text-right py-2 px-2 font-medium">Prejuízo</th>
                      <th className="text-right py-2 px-2 font-medium">Custo SAP</th>
                      <th className="text-right py-2 px-2 font-medium">Custo Flow</th>
                      <th className="text-right py-2 px-2 font-medium">Economia</th>
                      <th className="text-right py-2 px-2 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsByCompany
                      .slice()
                      .sort((a, b) => b.economia_periodo - a.economia_periodo)
                      .map((m) => (
                        <tr key={m.company_db} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="py-2 px-2 font-medium text-foreground truncate max-w-[180px]">{m.display_name}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{m.n_docs}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-destructive">{m.docs_atrasados}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtBRL(m.prejuizo_atraso)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-destructive/80">{fmtBRL(m.custo_total_sap)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-primary">{fmtBRL(m.custo_total_flow)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtBRL(m.economia_periodo)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{fmtNum(m.economia_percent, 1)}%</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Qualitativo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="glass-card p-4 sm:p-6 space-y-3">
              <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Análise Quantitativa
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <QuantRow
                  label="Tempo médio de antecedência (lançamento → vencimento)"
                  value={
                    (mode === "company" ? single?.antecedencia_media_dias : null) != null
                      ? `${fmtNum(single!.antecedencia_media_dias!, 1)} dias`
                      : mode === "consolidated"
                        ? `${fmtNum(avgOf(metricsByCompany, "antecedencia_media_dias"), 1)} dias (méd.)`
                        : "—"
                  }
                />
                <QuantRow
                  label="Atraso médio nos documentos vencidos"
                  value={
                    (mode === "company" ? single?.atraso_medio_dias : null) != null
                      ? `${fmtNum(single!.atraso_medio_dias!, 1)} dias`
                      : mode === "consolidated"
                        ? `${fmtNum(avgOf(metricsByCompany, "atraso_medio_dias"), 1)} dias (méd.)`
                        : "—"
                  }
                />
                <QuantRow
                  label="Custo hora/aprovador"
                  value={activeParams ? fmtBRL(activeParams.salario_aprovador / activeParams.horas_mes) + "/h" : "—"}
                />
                <QuantRow
                  label="Custo hora/solicitante"
                  value={activeParams ? fmtBRL(activeParams.salario_solicitante / activeParams.horas_mes) + "/h" : "—"}
                />
                <QuantRow
                  label="Redução de tempo operacional"
                  value={
                    (() => {
                      const s = mode === "company" ? single?.horas_sap : totals?.horas_sap;
                      const f = mode === "company" ? single?.horas_flow : totals?.horas_flow;
                      if (!s || s === 0) return "—";
                      return `${fmtNum(((s - (f || 0)) / s) * 100, 1)}%`;
                    })()
                  }
                />
              </ul>
            </div>

            <div className="glass-card p-4 sm:p-6 space-y-3">
              <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-primary" />
                Análise Qualitativa
              </h3>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>
                  O <strong className="text-foreground">ERP Flow</strong> reduz o tempo operacional por documento
                  de <strong className="text-foreground">{activeParams?.tempo_lancar_sap_min}min</strong> para{" "}
                  <strong className="text-foreground">{activeParams?.tempo_lancar_flow_min}min</strong> no lançamento e
                  de <strong className="text-foreground">{activeParams?.tempo_aprovar_sap_min}min</strong> para{" "}
                  <strong className="text-foreground">{activeParams?.tempo_aprovar_flow_min}min</strong> na aprovação —
                  ganho aplicável a todo o volume do período.
                </p>
                <p>
                  O prejuízo por atraso ({fmtBRL(mode === "company" ? single?.prejuizo_atraso || 0 : totals?.prejuizo_atraso || 0)})
                  reflete multa {activeParams?.multa_percent}% e juros {activeParams?.juros_mes_percent}%/mês sobre documentos
                  aprovados após o vencimento. Acelerar a aprovação com o ERP Flow reduz diretamente esse risco financeiro.
                </p>
                <p>
                  Em licenças, o modelo SAP cobra por perfil (aprovador {fmtBRL(activeParams?.custo_licenca_aprovador_sap || 0)}/mês,
                  solicitante {fmtBRL(activeParams?.custo_licenca_solicitante_sap || 0)}/mês). O ERP Flow substitui esses acessos
                  ao mesmo tempo que amplia governança (trilha auditável, aprovação remota, notificações).
                </p>
                <p className="text-foreground">
                  Impacto total estimado no período: <strong className="text-primary">{fmtBRL(displayEconomia)}</strong> ({fmtNum(displayEconomiaPct, 1)}% de redução).
                </p>
              </div>
            </div>
          </div>

          {/* Tempo gasto no lançamento por dia (desde 01/06/2025) */}
          <DailyTimeSpentChart
            companyDb={mode === "company" ? companyDb : undefined}
            consolidated={mode === "consolidated"}
            tempoLancarFlowMin={activeParams?.tempo_lancar_flow_min ?? 3}
            tempoLancarSapMin={activeParams?.tempo_lancar_sap_min ?? 15}
          />

          {/* Análise Temporal — SAP nativo vs ERP Flow + ciclo do documento */}
          <TemporalAnalysis
            companyDb={mode === "company" ? companyDb : undefined}
            from={dateFilter.from}
            to={dateFilter.to}
            consolidated={mode === "consolidated"}
          />
        </>
      )}

      {isAdmin && activeParams && (
        <RoiParamsDialog
          open={paramsOpen}
          onOpenChange={setParamsOpen}
          allParams={params}
          scopeCompanyDb={mode === "company" ? companyDb || null : null}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function QuantRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1 border-b border-border/30 last:border-0">
      <span className="text-xs sm:text-sm">{label}</span>
      <span className="text-xs sm:text-sm font-semibold text-foreground tabular-nums shrink-0">{value}</span>
    </li>
  );
}

function avgOf<T extends { [k: string]: any }>(arr: T[], key: string): number {
  const vals = arr.map((a) => a[key]).filter((v): v is number => typeof v === "number");
  if (!vals.length) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function RoiParamsDialog({
  open, onOpenChange, allParams, scopeCompanyDb, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allParams: RoiParameters[];
  scopeCompanyDb: string | null;
  onSaved: () => void;
}) {
  const existing = allParams.find((p) => p.company_db === scopeCompanyDb)
    || allParams.find((p) => p.company_db === null);
  const [form, setForm] = useState<Partial<RoiParameters>>(existing || {});
  const [saving, setSaving] = useState(false);

  const bind = (k: keyof RoiParameters) => ({
    value: (form[k] as any) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: Number(e.target.value) })),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        company_db: scopeCompanyDb,
        salario_aprovador: form.salario_aprovador,
        salario_solicitante: form.salario_solicitante,
        tempo_lancar_sap_min: form.tempo_lancar_sap_min,
        tempo_aprovar_sap_min: form.tempo_aprovar_sap_min,
        tempo_lancar_flow_min: form.tempo_lancar_flow_min,
        tempo_aprovar_flow_min: form.tempo_aprovar_flow_min,
        custo_licenca_aprovador_sap: form.custo_licenca_aprovador_sap,
        custo_licenca_solicitante_sap: form.custo_licenca_solicitante_sap,
        custo_licenca_flow: form.custo_licenca_flow,
        multa_percent: form.multa_percent,
        juros_mes_percent: form.juros_mes_percent,
        horas_mes: form.horas_mes,
      };
      const rowExists = allParams.find((p) => p.company_db === scopeCompanyDb);
      const { error } = rowExists
        ? await supabase.from("roi_parameters").update(payload).eq("id", rowExists.id)
        : await supabase.from("roi_parameters").insert(payload);
      if (error) throw error;
      toast.success("Parâmetros atualizados");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Falha ao salvar: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Parâmetros de ROI</DialogTitle>
          <DialogDescription>
            {scopeCompanyDb
              ? `Ajustes específicos da empresa ${scopeCompanyDb}. Se algum campo ficar em branco, o valor global é usado.`
              : "Valores padrão aplicados a todas as empresas sem override específico."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <Field label="Salário aprovador (R$/mês)" k="salario_aprovador" bind={bind} />
          <Field label="Salário solicitante (R$/mês)" k="salario_solicitante" bind={bind} />
          <Field label="Tempo lançar SAP (min)" k="tempo_lancar_sap_min" bind={bind} />
          <Field label="Tempo aprovar SAP (min)" k="tempo_aprovar_sap_min" bind={bind} />
          <Field label="Tempo lançar Flow (min)" k="tempo_lancar_flow_min" bind={bind} />
          <Field label="Tempo aprovar Flow (min)" k="tempo_aprovar_flow_min" bind={bind} />
          <Field label="Licença aprovador SAP (R$/mês)" k="custo_licenca_aprovador_sap" bind={bind} />
          <Field label="Licença solicitante SAP (R$/mês)" k="custo_licenca_solicitante_sap" bind={bind} />
          <Field label="Licença ERP Flow (R$/mês)" k="custo_licenca_flow" bind={bind} />
          <Field label="Multa (%)" k="multa_percent" bind={bind} step="0.01" />
          <Field label="Juros ao mês (%)" k="juros_mes_percent" bind={bind} step="0.01" />
          <Field label="Horas trabalhadas / mês" k="horas_mes" bind={bind} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, k, bind, step,
}: {
  label: string; k: keyof RoiParameters; bind: (k: keyof RoiParameters) => any; step?: string;
}) {
  const b = bind(k);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step || "1"} value={b.value} onChange={b.onChange} />
    </div>
  );
}
