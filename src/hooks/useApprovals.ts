import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryAll, sapQuery } from "@/lib/sap-client";

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
  artPending: "pending",
  artApproved: "approved",
  artNotApproved: "rejected",
  artGenerated: "generated",
};

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
      // Fetch approval requests - filter for pending
      const result = await sapQueryAll(session, "ApprovalRequests", {
        $filter: "Status eq 'artPending'",
        $orderby: "CreationDate desc",
      });

      const items = (result.data.value as any[]) || [];

      const docs: ApprovalDoc[] = items.map((item: any) => {
        const stages = item.ApprovalRequestLines || [];
        const currentStage = stages.find((s: any) => s.Status === "artPending");
        const approverName = currentStage?.UserName || currentStage?.UserId || "—";

        const objectType = String(item.ObjectType || "");
        const docTypeName = DOC_TYPE_NAMES[objectType] || `Tipo ${objectType}`;

        return {
          approvalRequestId: item.Code,
          docType: objectType,
          docTypeName,
          docNum: item.ObjectCode || item.DocNum || 0,
          docEntry: item.ObjectEntry || 0,
          docTotal: item.DocTotal || 0,
          currency: item.DocCurrency || "BRL",
          cardCode: item.CardCode || "",
          cardName: item.CardName || item.OriginatorName || "—",
          requester: item.OriginatorName || item.Originator || "—",
          currentApprover: approverName,
          currentStage: currentStage?.StageCode ? `Etapa ${currentStage.StageCode}` : "—",
          status: STATUS_MAP[item.Status] || "pending",
          docDate: item.CreationDate || "",
          dueDate: item.DueDate || item.UpdateDate || "",
          remarks: item.Remarks || "",
        };
      });

      setApprovals(docs);
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
