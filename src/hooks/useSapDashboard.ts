import { useState, useEffect, useCallback, useMemo } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView } from "@/lib/sap-client";
import { omieListarContasPagar, type OmieContaPagar } from "@/lib/omie-client";
import type { FlowStage } from "@/components/FlowTimeline";
import type { Insight } from "@/components/InsightsPanel";
import type { ValidationItem } from "@/components/ValidationTable";
import { type CompanyTargets, DEFAULT_TARGETS } from "@/hooks/useCompanies";

export interface ApproverStats {
  name: string;
  avgDaysApproved: number;
  avgDaysRejected: number;
  countApproved: number;
  countRejected: number;
}

export interface SapDashboardData {
  stages: FlowStage[];
  metrics: {
    avgTotalDays: number;
    openOrders: number;
    validationErrors: number;
    complianceRate: number;
  };
  insights: Insight[];
  validations: ValidationItem[];
  approverStats: ApproverStats[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/* ── View row type ── */
interface ViewRow {
  Status_Pagamento: string;
  Numero_Pagamento_SAP: number;
  Data_do_Pagamento: string | null;
  Data_Lancamento_Pedido: string | null;
  Data_Emissao_NF: string | null;
  Data_Lancamento_NF: string | null;
  Data_Vencimento_Pagamento: string | null;
  Dias_Pedido_Ate_Pagamento: number | null;
  Dias_Emissao_NF_Ate_Pagamento: number | null;
  Dias_NF_Ate_Pagamento: number | null;
  Dias_Vencimento_Ate_Pagamento: number | null;
  Moeda: string;
  Valor_Total_Pago: number;
  Cod_PN: string;
  Nome_PN: string;
  Numero_Documento_Origem: number;
  Num_NF_Referencia: string | null;
  Valor_Aplicado_Neste_Doc: number;
  Status_Documento_Origem: string;
  Numero_Pedido_Compra: number | null;
  Nome_Solicitante: string;
  Filial: string;
}

/* ── Approval view row type (VW_TODAS_APROVACOES) ── */
interface ApprovalViewRow {
  Code?: number;
  Aprovador?: string;
  Email_Aprovador?: string;
  Tipo_Solicitacao?: string;
  Status_Aprovacao?: string;
  Status_Documento?: string;
  Num_Documento?: number;
  Solicitante?: string;
  Cod_PN?: string;
  Nome_PN?: string;
  Moeda?: string;
  Valor_Total_LC?: number;
  Data_Documento?: string | null;
  Data_Lancamento?: string | null;
  Data_Vencimento?: string | null;
  Dias_Desde_Criacao?: number;
  Modelo_Aprovacao?: string;
}

/* ── Helpers ── */
const MAX_DAYS_PER_STEP = 5;

function daysBetween(d1: string | null, d2: string | null): number | null {
  if (!d1 || !d2) return null;
  const a = new Date(d1).getTime();
  const b = new Date(d2).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round(Math.abs(b - a) / (1000 * 60 * 60 * 24));
}

/** Remove outliers using IQR method and return filtered array */
function removeOutliers(nums: number[]): number[] {
  if (nums.length < 4) return nums;
  const sorted = [...nums].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return nums.filter((n) => n >= lower && n <= upper);
}

function avg(nums: number[]): number {
  const clean = removeOutliers(nums);
  if (!clean.length) return 0;
  return Math.round((clean.reduce((s, n) => s + n, 0) / clean.length) * 10) / 10;
}

function stageStatus(avgDays: number): "ok" | "warning" | "critical" {
  if (avgDays <= MAX_DAYS_PER_STEP) return "ok";
  if (avgDays <= MAX_DAYS_PER_STEP * 2) return "warning";
  return "critical";
}

/* ── Build stages from view data ── */
function buildStages(rows: ViewRow[], approvalDays: number[], targets: CompanyTargets): FlowStage[] {
  const pedidoToNfEmissao: number[] = [];
  const nfEmissaoToNfLanc: number[] = [];
  const nfLancToPagamento: number[] = [];

  for (const r of rows) {
    const d1 = daysBetween(r.Data_Lancamento_Pedido, r.Data_Emissao_NF);
    if (d1 !== null) pedidoToNfEmissao.push(d1);

    const d2 = daysBetween(r.Data_Emissao_NF, r.Data_Lancamento_NF);
    if (d2 !== null) nfEmissaoToNfLanc.push(d2);

    const d3 = daysBetween(r.Data_Lancamento_NF, r.Data_do_Pagamento);
    if (d3 !== null) nfLancToPagamento.push(d3);
  }

  const avgPedidoNf = avg(pedidoToNfEmissao);
  const avgNfEmissaoLanc = avg(nfEmissaoToNfLanc);
  const avgNfPag = avg(nfLancToPagamento);
  const avgApproval = avg(approvalDays);

  const stageStatusCustom = (avgDays: number, target: number): "ok" | "warning" | "critical" => {
    if (avgDays <= target) return "ok";
    if (avgDays <= target * 1.5) return "warning";
    return "critical";
  };

  return [
    { id: "requisicao", name: "REQUISIÇÃO", avgDays: 1, targetDays: targets.requisicao, status: "ok", count: 0 },
    { id: "cotacao", name: "COTAÇÃO", avgDays: 1, targetDays: targets.cotacao, status: "ok", count: 0 },
    { id: "aprovacao", name: "APROVAÇÃO", avgDays: avgApproval || 1, targetDays: targets.aprovacao, status: stageStatusCustom(avgApproval || 1, targets.aprovacao), count: approvalDays.length },
    { id: "pedido_compra", name: "PEDIDO COMPRA", avgDays: avgPedidoNf || 1, targetDays: targets.pedido_compra, status: stageStatusCustom(avgPedidoNf || 1, targets.pedido_compra), count: pedidoToNfEmissao.length },
    { id: "nf_entrada", name: "NF ENTRADA", avgDays: avgNfEmissaoLanc || 1, targetDays: targets.nf_entrada, status: stageStatusCustom(avgNfEmissaoLanc || 1, targets.nf_entrada), count: nfEmissaoToNfLanc.length },
    { id: "pagamento", name: "PAGAMENTO", avgDays: avgNfPag || 1, targetDays: targets.pagamento, status: stageStatusCustom(avgNfPag || 1, targets.pagamento), count: nfLancToPagamento.length },
  ];
}



/* ── Build validations ── */
function buildValidations(rows: ViewRow[]): ValidationItem[] {
  const items: ValidationItem[] = [];
  let id = 1;

  for (const r of rows) {
    const docLabel = r.Numero_Pedido_Compra
      ? `PC-${r.Numero_Pedido_Compra}`
      : `PAG-${r.Numero_Pagamento_SAP}`;

    // Rule 1: Late payment (paid after due date)
    if (
      r.Dias_Vencimento_Ate_Pagamento !== null &&
      r.Dias_Vencimento_Ate_Pagamento > 0
    ) {
      items.push({
        id: String(id++),
        document: docLabel,
        supplier: r.Nome_PN,
        stage: "Pagamento",
        status: "error",
        message: `Pagamento em atraso: ${r.Dias_Vencimento_Ate_Pagamento} dias após vencimento`,
        date: r.Data_do_Pagamento || "",
      });
      continue;
    }

    // Rule 2: Canceled payment but NF still active = flow error
    if (
      r.Status_Pagamento === "Cancelado" &&
      r.Status_Documento_Origem?.includes("Ativa")
    ) {
      items.push({
        id: String(id++),
        document: docLabel,
        supplier: r.Nome_PN,
        stage: "Pagamento",
        status: "error",
        message: `Pagamento cancelado com NF ainda ativa (Doc ${r.Numero_Documento_Origem})`,
        date: r.Data_do_Pagamento || "",
      });
      continue;
    }

    // Rule 2b: Canceled payment after NF launched
    if (
      r.Status_Pagamento === "Cancelado" &&
      r.Data_Lancamento_NF
    ) {
      items.push({
        id: String(id++),
        document: docLabel,
        supplier: r.Nome_PN,
        stage: "Pagamento",
        status: "error",
        message: `Pagamento cancelado após lançamento da NF — erro de fluxo`,
        date: r.Data_do_Pagamento || "",
      });
      continue;
    }

    // Rule 3: Any step > 5 days
    const stepChecks: { stage: string; days: number | null; label: string }[] = [
      { stage: "Pedido → NF", days: daysBetween(r.Data_Lancamento_Pedido, r.Data_Emissao_NF), label: "Pedido até emissão NF" },
      { stage: "Emissão → Lançamento NF", days: daysBetween(r.Data_Emissao_NF, r.Data_Lancamento_NF), label: "Emissão até lançamento NF" },
      { stage: "Lançamento NF → Pagamento", days: daysBetween(r.Data_Lancamento_NF, r.Data_do_Pagamento), label: "Lançamento NF até pagamento" },
    ];

    const slowStep = stepChecks.find((s) => s.days !== null && s.days > MAX_DAYS_PER_STEP);
    if (slowStep) {
      items.push({
        id: String(id++),
        document: docLabel,
        supplier: r.Nome_PN,
        stage: slowStep.stage,
        status: "error",
        message: `${slowStep.label}: ${slowStep.days} dias (máx ${MAX_DAYS_PER_STEP})`,
        date: r.Data_do_Pagamento || r.Data_Lancamento_NF || "",
      });
      continue;
    }

    // Valid document
    items.push({
      id: String(id++),
      document: docLabel,
      supplier: r.Nome_PN,
      stage: "Completo",
      status: "valid",
      message: "Fluxo dentro dos parâmetros",
      date: r.Data_do_Pagamento || "",
    });
  }

  return items;
}

/* ── Generate insights ── */
function generateInsights(stages: FlowStage[], validations: ValidationItem[]): Insight[] {
  const insights: Insight[] = [];
  let id = 1;

  // Bottleneck stages
  for (const s of stages.filter((s) => s.status === "critical")) {
    insights.push({
      id: String(id++),
      type: "bottleneck",
      title: `${s.name} é um gargalo crítico`,
      description: `Média de ${s.avgDays} dias (meta: ${s.targetDays}d). Revise o processo para reduzir atrasos.`,
      impact: "alto",
    });
  }

  // Late payments count
  const latePayments = validations.filter((v) => v.message.includes("atraso"));
  if (latePayments.length > 0) {
    insights.push({
      id: String(id++),
      type: "alert",
      title: `${latePayments.length} pagamentos em atraso`,
      description: "Pagamentos realizados após a data de vencimento indicam falha no controle de prazos.",
      impact: "alto",
    });
  }

  // Canceled flow errors
  const canceledErrors = validations.filter((v) => v.message.includes("cancelado") || v.message.includes("Cancelado"));
  if (canceledErrors.length > 0) {
    insights.push({
      id: String(id++),
      type: "alert",
      title: `${canceledErrors.length} erros de fluxo (cancelamentos)`,
      description: "Documentos cancelados após lançamento de NF ou pagamento indicam retrabalho e possíveis problemas operacionais.",
      impact: "alto",
    });
  }

  // Slow steps
  const slowSteps = validations.filter((v) => v.message.includes("máx"));
  if (slowSteps.length > 0) {
    insights.push({
      id: String(id++),
      type: "improvement",
      title: `${slowSteps.length} documentos com etapas lentas`,
      description: `Documentos com pelo menos uma etapa acima de ${MAX_DAYS_PER_STEP} dias. Revise SLAs internos.`,
      impact: "médio",
    });
  }

  // Warning stages
  for (const s of stages.filter((s) => s.status === "warning")) {
    insights.push({
      id: String(id++),
      type: "improvement",
      title: `${s.name} acima da meta`,
      description: `Média de ${s.avgDays} dias (meta: ${s.targetDays}d). Avalie otimizações.`,
      impact: "médio",
    });
  }

  // Positive stages
  const oks = stages.filter((s) => s.status === "ok");
  if (oks.length > 0) {
    insights.push({
      id: String(id++),
      type: "positive",
      title: "Etapas dentro da meta",
      description: `${oks.map((s) => s.name).join(", ")} operam dentro do prazo.`,
      impact: "baixo",
    });
  }

  if (insights.length === 0) {
    insights.push({ id: "0", type: "positive", title: "Fluxo saudável", description: "Todas as etapas dentro das metas.", impact: "baixo" });
  }

  return insights;
}

/* ── Map OMIE contas a pagar → ViewRow ── */
function mapOmieToViewRows(contas: OmieContaPagar[]): ViewRow[] {
  return contas.map((c) => {
    const dataEmissao = c.data_emissao || null;
    const dataVencimento = c.data_vencimento || null;
    const dataPagamento = c.status_titulo === "LIQUIDADO" ? (c.data_previsao || c.data_vencimento || null) : null;

    const diasVencAtePag = dataPagamento && dataVencimento
      ? Math.round((new Date(dataPagamento.split("/").reverse().join("-")).getTime() -
          new Date(dataVencimento.split("/").reverse().join("-")).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // Convert dd/mm/yyyy to yyyy-mm-dd for consistency
    const toIso = (d: string | null) => {
      if (!d) return null;
      const parts = d.split("/");
      return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d;
    };

    const statusMap: Record<string, string> = {
      LIQUIDADO: "Pago",
      ABERTO: "Em Aberto",
      CANCELADO: "Cancelado",
      VENCIDO: "Vencido",
    };

    return {
      Status_Pagamento: statusMap[c.status_titulo || ""] || (c.status_titulo || "Desconhecido"),
      Numero_Pagamento_SAP: c.codigo_lancamento_omie,
      Data_do_Pagamento: toIso(dataPagamento),
      Data_Lancamento_Pedido: toIso(dataEmissao),
      Data_Emissao_NF: toIso(dataEmissao),
      Data_Lancamento_NF: toIso(dataEmissao),
      Data_Vencimento_Pagamento: toIso(dataVencimento),
      Dias_Pedido_Ate_Pagamento: null,
      Dias_Emissao_NF_Ate_Pagamento: null,
      Dias_NF_Ate_Pagamento: null,
      Dias_Vencimento_Ate_Pagamento: diasVencAtePag,
      Moeda: "BRL",
      Valor_Total_Pago: c.valor_documento || 0,
      Cod_PN: String(c.codigo_cliente_fornecedor || ""),
      Nome_PN: c.nome_cliente_fornecedor || `Fornecedor ${c.codigo_cliente_fornecedor}`,
      Numero_Documento_Origem: Number(c.numero_documento || 0),
      Num_NF_Referencia: c.numero_documento_fiscal || null,
      Valor_Aplicado_Neste_Doc: c.valor_pago || c.valor_documento || 0,
      Status_Documento_Origem: c.status_titulo || "",
      Numero_Pedido_Compra: c.numero_pedido ? Number(c.numero_pedido) : null,
      Nome_Solicitante: c.observacao || "OMIE",
      Filial: "",
    };
  });
}

/* ── Hook ── */
export interface DateFilter {
  from: Date | null;
  to: Date | null;
}

function filterRowsByDate(rows: ViewRow[], filter?: DateFilter): ViewRow[] {
  if (!filter?.from) return rows;
  const fromTime = filter.from.getTime();
  const toTime = filter.to ? filter.to.getTime() + 24 * 60 * 60 * 1000 : Date.now();
  return rows.filter((r) => {
    const d = r.Data_do_Pagamento || r.Data_Lancamento_Pedido;
    if (!d) return false;
    const t = new Date(d).getTime();
    return !isNaN(t) && t >= fromTime && t <= toTime;
  });
}

export function useSapDashboard(dateFilter?: DateFilter, targets?: CompanyTargets): SapDashboardData {
  const effectiveTargets = targets || DEFAULT_TARGETS;
  const { session } = useSap();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<ViewRow[]>([]);
  const [approvalDaysRaw, setApprovalDaysRaw] = useState<number[]>([]);
  const [approvalRowsRaw, setApprovalRowsRaw] = useState<ApprovalViewRow[]>([]);

  const fetchData = useCallback(async () => {
    if (!session) return;
    setError(null);
    const companyDb = session.companyDB;
    const paymentsKey = `sap-dashboard:payments:${session.erpType}`;
    const approvalsKey = `sap-dashboard:approvals:${session.erpType}`;

    // 1. Paint cached data instantly
    let hadCache = false;
    if (companyDb) {
      try {
        const { readCache } = await import("@/lib/external-cache");
        const [pCache, aCache] = await Promise.all([
          readCache<ViewRow[]>(paymentsKey, companyDb),
          readCache<ApprovalViewRow[]>(approvalsKey, companyDb),
        ]);
        if (pCache?.data?.length) {
          setRawRows(pCache.data);
          hadCache = true;
        }
        if (aCache?.data) {
          const approvalRows = aCache.data;
          const days: number[] = [];
          for (const a of approvalRows) {
            if (a.Status_Aprovacao === "Aprovado" || a.Status_Aprovacao === "Rejeitado") {
              const d = daysBetween(a.Data_Documento || null, a.Data_Lancamento || null);
              if (d !== null) days.push(Math.max(d, 1));
            } else {
              const d = Number(a.Dias_Desde_Criacao || 0);
              if (d > 0) days.push(d);
            }
          }
          setApprovalDaysRaw(days);
          setApprovalRowsRaw(approvalRows);
        }
      } catch {/* ignore */}
    }
    if (!hadCache) setIsLoading(true);

    try {
      if (session.erpType === "sap") {
        const [paymentResult, approvalResult] = await Promise.all([
          sapQueryView<ViewRow>(session, "VW_ANALISE_PAGAMENTOS_DETALHADO"),
          sapQueryView<ApprovalViewRow>(session, "VW_TODAS_APROVACOES").catch(() => ({ data: [] as ApprovalViewRow[] })),
        ]);

        const payRows = paymentResult.data || [];
        setRawRows(payRows);

        const approvalRows = approvalResult.data || [];
        const days: number[] = [];
        for (const a of approvalRows) {
          if (a.Status_Aprovacao === "Aprovado" || a.Status_Aprovacao === "Rejeitado") {
            const d = daysBetween(a.Data_Documento || null, a.Data_Lancamento || null);
            if (d !== null) {
              days.push(Math.max(d, 1));
            }
          } else {
            const d = Number(a.Dias_Desde_Criacao || 0);
            if (d > 0) days.push(d);
          }
        }
        setApprovalDaysRaw(days);
        setApprovalRowsRaw(approvalRows);

        if (companyDb) {
          try {
            const { writeCache } = await import("@/lib/external-cache");
            await Promise.all([
              payRows.length ? writeCache(paymentsKey, companyDb, payRows) : Promise.resolve(),
              writeCache(approvalsKey, companyDb, approvalRows),
            ]);
          } catch (e) {
            console.warn("SAP dashboard cache write failed:", e);
          }
        }
      } else if (session.erpType === "omie") {
        const contas = await omieListarContasPagar(session.companyDB, 10);
        const mapped = mapOmieToViewRows(contas);
        setRawRows(mapped);
        setApprovalDaysRaw([]);
        setApprovalRowsRaw([]);
        if (companyDb && mapped.length) {
          try {
            const { writeCache } = await import("@/lib/external-cache");
            await writeCache(paymentsKey, companyDb, mapped);
          } catch (e) {
            console.warn("SAP dashboard cache write failed:", e);
          }
        }
      } else {
        setRawRows([]);
        setApprovalDaysRaw([]);
        setApprovalRowsRaw([]);
      }
    } catch (e) {
      console.error("Error fetching view data:", e);
      if (!hadCache) setError(e instanceof Error ? e.message : "Erro ao buscar dados da view");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const { stages, metrics, insights, validations, approverStats } = useMemo(() => {
    const rows = filterRowsByDate(rawRows, dateFilter);
    const computedStages = buildStages(rows, approvalDaysRaw, effectiveTargets);
    const vals = buildValidations(rows);
    const errorCount = vals.filter((v) => v.status === "error").length;
    const compliance = vals.length > 0 ? Math.round(((vals.length - errorCount) / vals.length) * 100) : 100;
    const totalAvg = computedStages.reduce((sum, s) => sum + s.avgDays, 0);

    // Approver stats — with outlier removal
    const approverMap = new Map<string, { approved: number[]; rejected: number[] }>();
    for (const a of approvalRowsRaw) {
      const name = a.Aprovador;
      if (!name) continue;
      if (a.Status_Aprovacao !== "Aprovado" && a.Status_Aprovacao !== "Rejeitado") continue;
      const d = daysBetween(a.Data_Documento || null, a.Data_Lancamento || null);
      if (d === null) continue;
      const days = Math.max(d, 1);
      if (!approverMap.has(name)) approverMap.set(name, { approved: [], rejected: [] });
      const bucket = approverMap.get(name)!;
      if (a.Status_Aprovacao === "Aprovado") bucket.approved.push(days);
      else bucket.rejected.push(days);
    }
    const computedApproverStats: ApproverStats[] = Array.from(approverMap.entries())
      .map(([name, { approved, rejected }]) => ({
        name,
        avgDaysApproved: avg(approved),
        avgDaysRejected: avg(rejected),
        countApproved: approved.length,
        countRejected: rejected.length,
      }))
      .sort((a, b) => (b.avgDaysApproved + b.avgDaysRejected) - (a.avgDaysApproved + a.avgDaysRejected));

    return {
      stages: computedStages,
      metrics: {
        avgTotalDays: Math.round(totalAvg * 10) / 10,
        openOrders: rows.filter((r) => r.Status_Pagamento !== "Cancelado" && !r.Data_do_Pagamento).length,
        validationErrors: errorCount,
        complianceRate: compliance,
      },
      insights: generateInsights(computedStages, vals),
      validations: vals,
      approverStats: computedApproverStats,
    };
  }, [rawRows, approvalDaysRaw, approvalRowsRaw, dateFilter, effectiveTargets]);

  return { stages, metrics, insights, validations, approverStats, isLoading, error, refresh: fetchData };
}
