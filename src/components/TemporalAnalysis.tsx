import { useTemporalAnalysis } from "@/hooks/useTemporalAnalysis";
import { Clock, GitBranch, FileText, Receipt, Wallet, Loader2, TrendingDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface Props {
  companyDb?: string;
  from?: Date;
  to?: Date;
  consolidated?: boolean;
}

const fmtNum = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(v);

const hoursLabel = (h: number | null | undefined) => {
  if (h == null) return "—";
  if (h < 24) return `${fmtNum(h, 1)} h`;
  return `${fmtNum(h / 24, 1)} dias`;
};

export function TemporalAnalysis({ companyDb, from, to, consolidated }: Props) {
  const { metrics, loading, error } = useTemporalAnalysis({ companyDb, from, to, consolidated });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando análise temporal…
      </div>
    );
  }
  if (error) {
    return (
      <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const compareData = [
    {
      etapa: "Aprovação",
      "SAP nativo": metrics.sapNativeAvgHours || 0,
      "ERP Flow": metrics.flowApprovalAvgHours || 0,
    },
    {
      etapa: "Até integrar no ERP",
      "SAP nativo": metrics.sapNativeAvgHours || 0,
      "ERP Flow": metrics.flowAvgHours || 0,
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="glass-card p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Tempo de Aprovação — SAP nativo vs ERP Flow
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              SAP nativo: primeira decisão até aprovação final. ERP Flow: criação da solicitação até integração no ERP.
            </p>
          </div>
          {metrics.reducaoAprovacaoPercent != null && (
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1 text-primary text-sm font-semibold">
                <TrendingDown className="w-4 h-4" />
                {fmtNum(metrics.reducaoAprovacaoPercent, 1)}%
              </div>
              <p className="text-[10px] text-muted-foreground">redução no ciclo</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <MiniStat label="SAP nativo (méd.)" value={hoursLabel(metrics.sapNativeAvgHours)} samples={metrics.sapNativeSamples} />
          <MiniStat label="SAP nativo (mediana)" value={hoursLabel(metrics.sapNativeMedianHours)} samples={metrics.sapNativeSamples} />
          <MiniStat label="ERP Flow (méd.)" value={hoursLabel(metrics.flowAvgHours)} samples={metrics.flowSamples} />
          <MiniStat label="ERP Flow (mediana)" value={hoursLabel(metrics.flowMedianHours)} samples={metrics.flowSamples} />
        </div>

        <div className="h-[240px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={compareData} margin={{ left: 10, right: 10, top: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
              <XAxis dataKey="etapa" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${fmtNum(v, 0)}h`}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => hoursLabel(v)}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="SAP nativo" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ERP Flow" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass-card p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            Ciclo do Documento — Aprovação → Pedido → NF → Pagamento
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Correlação via BaseEntry (SAP) + expenses.sap_doc_entry (ERP Flow), com fallback entre as duas fontes.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <StageCard
            icon={<Clock className="w-4 h-4" />}
            label="Aprovação → PO"
            value={hoursLabel(metrics.flowAvgHours ?? metrics.sapNativeAvgHours)}
            samples={metrics.flowSamples || metrics.sapNativeSamples}
          />
          <StageCard
            icon={<FileText className="w-4 h-4" />}
            label="PO → NF entrada"
            value={metrics.poToNfAvgDays != null ? `${fmtNum(metrics.poToNfAvgDays, 1)} dias` : "—"}
            samples={metrics.poToNfSamples}
          />
          <StageCard
            icon={<Receipt className="w-4 h-4" />}
            label="NF → Pagamento"
            value={metrics.nfToPayAvgDays != null ? `${fmtNum(metrics.nfToPayAvgDays, 1)} dias` : "—"}
            samples={metrics.nfToPaySamples}
          />
          <StageCard
            icon={<Wallet className="w-4 h-4" />}
            label="Ciclo total (Flow)"
            value={metrics.totalCycleFlowAvgDays != null ? `${fmtNum(metrics.totalCycleFlowAvgDays, 1)} dias` : "—"}
            samples={Math.min(metrics.flowSamples, metrics.poToNfSamples, metrics.nfToPaySamples)}
          />
        </div>

        <div className="text-xs text-muted-foreground leading-relaxed">
          O ciclo end-to-end soma a aprovação (ERP Flow), o intervalo até a Nota Fiscal de Entrada e o prazo até o pagamento do fornecedor.
          Reduzir a etapa de aprovação impacta diretamente o momento em que o pedido chega ao ERP e habilita o recebimento da NF.
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, samples }: { label: string; value: string; samples: number }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
      <p className="text-[10px] text-muted-foreground">{samples} amostras</p>
    </div>
  );
}

function StageCard({
  icon, label, value, samples,
}: { icon: React.ReactNode; label: string; value: string; samples: number }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-1.5 text-primary text-xs">
        {icon}
        <span className="text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-semibold text-foreground mt-1 tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{samples} pares</p>
    </div>
  );
}
