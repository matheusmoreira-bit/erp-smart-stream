import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, sapQueryAll } from "@/lib/sap-client";
import type { FlowStage } from "@/components/FlowTimeline";
import type { Insight } from "@/components/InsightsPanel";
import type { ValidationItem } from "@/components/ValidationTable";

export interface SapDashboardData {
  stages: FlowStage[];
  metrics: {
    avgTotalDays: number;
    openOrders: number;
    validationErrors: number;
    complianceRate: number;
    prevAvgTotalDays?: number;
    prevValidationErrors?: number;
    prevComplianceRate?: number;
  };
  insights: Insight[];
  validations: ValidationItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

function daysBetween(d1: string, d2: string): number {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function avgDaysForDocs(docs: any[], dateField1: string, dateField2?: string): number {
  if (!docs.length) return 0;
  if (!dateField2) {
    // Days from doc date to today
    const now = new Date().toISOString().split("T")[0];
    const total = docs.reduce((sum, d) => sum + daysBetween(d[dateField1] || now, now), 0);
    return Math.round((total / docs.length) * 10) / 10;
  }
  const valid = docs.filter((d) => d[dateField1] && d[dateField2]);
  if (!valid.length) return 0;
  const total = valid.reduce((sum, d) => sum + daysBetween(d[dateField1], d[dateField2]), 0);
  return Math.round((total / valid.length) * 10) / 10;
}

function determineStatus(avg: number, target: number): "ok" | "warning" | "critical" {
  const ratio = avg / target;
  if (ratio <= 1) return "ok";
  if (ratio <= 1.5) return "warning";
  return "critical";
}

function generateInsights(stages: FlowStage[]): Insight[] {
  const insights: Insight[] = [];
  let id = 1;

  // Find bottlenecks (critical stages)
  const criticals = stages.filter((s) => s.status === "critical");
  for (const s of criticals) {
    const pctOver = Math.round(((s.avgDays - s.targetDays) / s.targetDays) * 100);
    insights.push({
      id: String(id++),
      type: "bottleneck",
      title: `${s.name} é um gargalo crítico`,
      description: `A etapa de ${s.name.toLowerCase()} leva em média ${s.avgDays} dias, ${pctOver}% acima da meta de ${s.targetDays} dias. Recomenda-se revisar o processo e identificar causas de atraso.`,
      impact: "alto",
    });
  }

  // Warnings
  const warnings = stages.filter((s) => s.status === "warning");
  for (const s of warnings) {
    insights.push({
      id: String(id++),
      type: "improvement",
      title: `${s.name} acima da meta`,
      description: `O processo de ${s.name.toLowerCase()} está levando ${s.avgDays} dias em média (meta: ${s.targetDays} dias). Avalie possíveis otimizações.`,
      impact: "médio",
    });
  }

  // Positive
  const oks = stages.filter((s) => s.status === "ok");
  if (oks.length > 0) {
    const names = oks.map((s) => s.name).join(", ");
    insights.push({
      id: String(id++),
      type: "positive",
      title: "Etapas dentro da meta",
      description: `As etapas ${names} estão operando dentro do prazo esperado.`,
      impact: "baixo",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "0",
      type: "positive",
      title: "Fluxo saudável",
      description: "Todas as etapas estão dentro das metas estabelecidas.",
      impact: "baixo",
    });
  }

  return insights;
}

function buildValidations(
  purchaseOrders: any[],
  purchaseInvoices: any[],
  purchaseQuotations: any[],
): ValidationItem[] {
  const items: ValidationItem[] = [];
  let id = 1;

  // Check POs without quotation reference
  for (const po of purchaseOrders.slice(0, 20)) {
    const docTotal = po.DocTotal || 0;
    const docNum = po.DocNum || "N/A";
    const cardName = po.CardName || "N/A";
    const docDate = po.DocDate || "";

    if (docTotal > 10000 && !po.DocumentReferences?.length) {
      items.push({
        id: String(id++),
        document: `PO-${docNum}`,
        supplier: cardName,
        stage: "Pedido de Compra",
        status: "warning",
        message: `Pedido de R$${docTotal.toLocaleString("pt-BR")} sem referência a cotação`,
        date: docDate,
      });
    } else if (po.DocumentStatus === "bost_Open") {
      const daysOpen = daysBetween(docDate, new Date().toISOString().split("T")[0]);
      if (daysOpen > 30) {
        items.push({
          id: String(id++),
          document: `PO-${docNum}`,
          supplier: cardName,
          stage: "Pedido de Compra",
          status: "error",
          message: `Pedido aberto há ${Math.round(daysOpen)} dias`,
          date: docDate,
        });
      } else {
        items.push({
          id: String(id++),
          document: `PO-${docNum}`,
          supplier: cardName,
          stage: "Pedido de Compra",
          status: "valid",
          message: "Pedido dentro do prazo esperado",
          date: docDate,
        });
      }
    }
  }

  // Check invoices with price divergence
  for (const inv of purchaseInvoices.slice(0, 10)) {
    const docNum = inv.DocNum || "N/A";
    const cardName = inv.CardName || "N/A";
    const docDate = inv.DocDate || "";

    if (inv.DocumentStatus === "bost_Open") {
      items.push({
        id: String(id++),
        document: `NF-${docNum}`,
        supplier: cardName,
        stage: "NF Entrada",
        status: "warning",
        message: "Nota fiscal ainda não conciliada",
        date: docDate,
      });
    } else {
      items.push({
        id: String(id++),
        document: `NF-${docNum}`,
        supplier: cardName,
        stage: "NF Entrada",
        status: "valid",
        message: "NF processada com sucesso",
        date: docDate,
      });
    }
  }

  return items.slice(0, 15);
}

export function useSapDashboard(): SapDashboardData {
  const { session } = useSap();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<FlowStage[]>([]);
  const [metrics, setMetrics] = useState<SapDashboardData["metrics"]>({
    avgTotalDays: 0,
    openOrders: 0,
    validationErrors: 0,
    complianceRate: 0,
  });
  const [insights, setInsights] = useState<Insight[]>([]);
  const [validations, setValidations] = useState<ValidationItem[]>([]);

  const fetchData = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    setError(null);

    try {
      // Fetch all endpoints in parallel
      const [
        prResult,
        pqResult,
        poResult,
        pdnResult,
        piResult,
        opResult,
      ] = await Promise.allSettled([
        sapQueryAll(session, "PurchaseRequests", {
          $select: "DocNum,DocDate,RequriedDate,DocumentStatus,DocTotal,CardName",
          $orderby: "DocDate desc",
        }),
        sapQueryAll(session, "PurchaseQuotations", {
          $select: "DocNum,DocDate,DocDueDate,DocumentStatus,DocTotal,CardName",
          $orderby: "DocDate desc",
        }),
        sapQueryAll(session, "PurchaseOrders", {
          $select: "DocNum,DocDate,DocDueDate,DocumentStatus,DocTotal,CardName,CreationDate",
          $orderby: "DocDate desc",
        }),
        sapQueryAll(session, "PurchaseDeliveryNotes", {
          $select: "DocNum,DocDate,DocumentStatus,DocTotal,CardName",
          $orderby: "DocDate desc",
        }),
        sapQueryAll(session, "PurchaseInvoices", {
          $select: "DocNum,DocDate,DocDueDate,DocumentStatus,DocTotal,CardName",
          $orderby: "DocDate desc",
        }),
        sapQueryAll(session, "OutgoingPayments", {
          $select: "DocNum,DocDate,DocTotal,CardName",
          $orderby: "DocDate desc",
        }),
      ]);

      const purchaseRequests = prResult.status === "fulfilled" ? prResult.value.data.value : [];
      const purchaseQuotations = pqResult.status === "fulfilled" ? pqResult.value.data.value : [];
      const purchaseOrders = poResult.status === "fulfilled" ? poResult.value.data.value : [];
      const deliveryNotes = pdnResult.status === "fulfilled" ? pdnResult.value.data.value : [];
      const purchaseInvoices = piResult.status === "fulfilled" ? piResult.value.data.value : [];
      const outgoingPayments = opResult.status === "fulfilled" ? opResult.value.data.value : [];

      // Calculate avg days per stage
      const prAvg = avgDaysForDocs(purchaseRequests as any[], "DocDate", "RequriedDate");
      const pqAvg = avgDaysForDocs(purchaseQuotations as any[], "DocDate", "DocDueDate");
      // Approval: time between PQ due date and PO creation
      const poAvg = avgDaysForDocs(purchaseOrders as any[], "DocDate", "DocDueDate");
      const pdnAvg = avgDaysForDocs(deliveryNotes as any[], "DocDate");
      const piAvg = avgDaysForDocs(purchaseInvoices as any[], "DocDate", "DocDueDate");
      const opAvg = avgDaysForDocs(outgoingPayments as any[], "DocDate");

      const computedStages: FlowStage[] = [
        { id: "req", name: "Requisição", avgDays: prAvg || 1, targetDays: 2, status: determineStatus(prAvg || 1, 2), count: (purchaseRequests as any[]).length },
        { id: "quot", name: "Cotação", avgDays: pqAvg || 1, targetDays: 3, status: determineStatus(pqAvg || 1, 3), count: (purchaseQuotations as any[]).length },
        { id: "po", name: "Pedido Compra", avgDays: poAvg || 1, targetDays: 3, status: determineStatus(poAvg || 1, 3), count: (purchaseOrders as any[]).length },
        { id: "receipt", name: "Recebimento", avgDays: pdnAvg || 1, targetDays: 5, status: determineStatus(pdnAvg || 1, 5), count: (deliveryNotes as any[]).length },
        { id: "invoice", name: "NF Entrada", avgDays: piAvg || 1, targetDays: 2, status: determineStatus(piAvg || 1, 2), count: (purchaseInvoices as any[]).length },
        { id: "payment", name: "Pagamento", avgDays: opAvg || 1, targetDays: 5, status: determineStatus(opAvg || 1, 5), count: (outgoingPayments as any[]).length },
      ];

      const totalAvg = computedStages.reduce((sum, s) => sum + s.avgDays, 0);
      const openPOs = (purchaseOrders as any[]).filter((po: any) => po.DocumentStatus === "bost_Open").length;

      const vals = buildValidations(purchaseOrders as any[], purchaseInvoices as any[], purchaseQuotations as any[]);
      const errorCount = vals.filter((v) => v.status === "error").length;
      const compliance = vals.length > 0 ? Math.round(((vals.length - errorCount) / vals.length) * 100) : 100;

      setStages(computedStages);
      setMetrics({
        avgTotalDays: Math.round(totalAvg * 10) / 10,
        openOrders: openPOs,
        validationErrors: errorCount,
        complianceRate: compliance,
      });
      setInsights(generateInsights(computedStages));
      setValidations(vals);
    } catch (e) {
      console.error("Error fetching SAP data:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar dados do SAP");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { stages, metrics, insights, validations, isLoading, error, refresh: fetchData };
}
