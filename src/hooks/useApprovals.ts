import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryAll, sapQueryView } from "@/lib/sap-client";

export interface ApprovalDoc {
  approvalRequestId: number;
  docType: string;
  docTypeName: string;
  docNum: number;
  docEntry: number;
  docTotal: number;
  currency: string;
  cardCode: string;
  cardName: string;
  requester: string;
  currentApprover: string;
  currentStage: string;
  status: "pending" | "approved" | "rejected" | "generated";
  docDate: string;
  dueDate: string;
  remarks: string;
}

const DOC_TYPE_NAMES: Record<string, string> = {
  "540000006": "Pedido de Compra",
  "17": "Pedido de Compra",
  "22": "Pedido de Venda",
  "23": "Devolução",
  "18": "Nota Fiscal de Entrada",
  "13": "Nota Fiscal de Saída",
  "15": "Entrega",
  "20": "Recebimento de Mercadoria",
  "1470000113": "Requisição de Compra",
};

const STATUS_MAP: Record<string, ApprovalDoc["status"]> = {
  arsPending: "pending",
  arsApproved: "approved",
  arsNotApproved: "rejected",
  arsGenerated: "generated",
};

interface HanaApprovalViewRow {
  Code?: number;
  Aprovador?: string;
  Solicitante?: string;
  Observações?: string;
  "Tipo de solicitação"?: string;
  "Draft DocEntry"?: number;
  "Nº do documento"?: number | string;
  "Código PN/Fornecedor"?: string;
  "Fornecedor / Parceiro"?: string;
  "Código da moeda original"?: string;
  "Valor total"?: number | string;
  "Data do documento"?: string;
  "Data de criação"?: string;
  "Data de vencimento"?: string;
  "Modelo de aprovação"?: string;
}

function normalizeCurrency(currency?: string): string {
  const value = currency?.trim();
  if (!value || value === "R$") return "BRL";
  if (value === "$") return "USD";
  if (value === "€") return "EUR";
  if (value.length === 3) return value.toUpperCase();
  return "BRL";
}

function mapHanaApproval(row: HanaApprovalViewRow): ApprovalDoc {
  const docTypeName = row["Tipo de solicitação"] || "Documento";

  return {
    approvalRequestId: Number(row.Code || 0),
    docType: docTypeName,
    docTypeName,
    docNum: Number(row["Nº do documento"] || 0),
    docEntry: Number(row["Draft DocEntry"] || 0),
    docTotal: Number(row["Valor total"] || 0),
    currency: normalizeCurrency(row["Código da moeda original"]),
    cardCode: row["Código PN/Fornecedor"] || "",
    cardName: row["Fornecedor / Parceiro"] || "—",
    requester: row.Solicitante || "—",
    currentApprover: row.Aprovador || "—",
    currentStage: row["Modelo de aprovação"] || "—",
    status: "pending",
    docDate: row["Data de criação"] || row["Data do documento"] || "",
    dueDate: row["Data de vencimento"] || "",
    remarks: row.Observações || "",
  };
}

function mapSapApproval(item: any): ApprovalDoc {
  const stages = item.ApprovalRequestLines || [];
  const currentStage =
    stages.find((stage: any) => stage.Status === "ardPending") ||
    stages.find((stage: any) => stage.Status === "arsPending");
  const approverName = currentStage?.UserName || currentStage?.UserID || currentStage?.UserId || "—";

  const objectType = String(item.ObjectType || "");
  const docTypeName = DOC_TYPE_NAMES[objectType] || `Tipo ${objectType}`;

  return {
    approvalRequestId: item.Code,
    docType: objectType,
    docTypeName,
    docNum: item.ObjectCode || item.DocNum || item.DraftEntry || item.Code || 0,
    docEntry: item.ObjectEntry || item.DraftEntry || 0,
    docTotal: item.DocTotal || 0,
    currency: item.DocCurrency || "BRL",
    cardCode: item.CardCode || "",
    cardName: item.CardName || item.OriginatorName || "—",
    requester: item.OriginatorName || item.Originator || String(item.OriginatorID || "—"),
    currentApprover: approverName,
    currentStage: currentStage?.StageCode ? `Etapa ${currentStage.StageCode}` : "—",
    status: STATUS_MAP[item.Status] || "pending",
    docDate: item.CreationDate || "",
    dueDate: item.DueDate || item.UpdateDate || item.CreationDate || "",
    remarks: item.Remarks || "",
  };
}

export function useApprovals() {
  const { session } = useSap();
  const [approvals, setApprovals] = useState<ApprovalDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    setError(null);

    try {
      try {
        const detailedView = await sapQueryView<HanaApprovalViewRow>(
          session,
          `${session.companyDB}.VW_APROVACOES_DETALHADAS`,
        );

        const detailedDocs = detailedView.data
          .map(mapHanaApproval)
          .filter((doc) => doc.approvalRequestId > 0);

        if (detailedDocs.length > 0) {
          setApprovals(detailedDocs);
          return;
        }
      } catch (viewError) {
        console.warn("Falling back to ApprovalRequests after HANA view error:", viewError);
      }

      const result = await sapQueryAll(session, "ApprovalRequests", {
        $filter: "Status eq 'arsPending'",
        $orderby: "CreationDate desc",
      });

      const items = (result.data.value as any[]) || [];
      setApprovals(items.map(mapSapApproval));
    } catch (e) {
      console.error("Error fetching approvals:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar aprovações");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  return { approvals, isLoading, error, refresh: fetchApprovals };
}
