import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, sapQueryView, type SapSession } from "@/lib/sap-client";

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
  approverEmail: string;
  currentStage: string;
  status: "pending" | "approved" | "rejected" | "generated";
  docDate: string;
  dueDate: string;
  remarks: string;
  approvalModel: string;
  daysOpen: number;
  attachmentNames: string;
  documentLines: DocumentLine[];
}

export interface DocumentLine {
  ItemCode: string;
  Description: string;
  Quantity: number;
  UnitPrice: number;
  LineTotal: number;
  CostingCode: string;
  Project: string;
}

interface HanaApprovalViewRow {
  Code?: number;
  Aprovador?: string;
  "Email do aprovador"?: string;
  Solicitante?: string;
  Observações?: string;
  "Tipo de solicitação"?: string;
  "Draft DocEntry"?: number;
  "Nº do documento"?: number | string;
  "Código PN/Fornecedor"?: string;
  "Fornecedor / Parceiro"?: string;
  "Código da moeda original"?: string;
  "Valor do documento na moeda original"?: number | string;
  "Valor total"?: number | string;
  "Data do documento"?: string;
  "Data de criação"?: string;
  "Data de vencimento"?: string;
  "Modelo de aprovação"?: string;
  "Id do anexo"?: number;
  "Nome do(s) anexo(s)"?: string;
  "Dias em aberto"?: number;
  DocumentLines?: string;
}

function normalizeCurrency(currency?: string): string {
  const value = currency?.trim();
  if (!value || value === "R$") return "BRL";
  if (value === "$") return "USD";
  if (value === "€") return "EUR";
  if (value.length === 3) return value.toUpperCase();
  return "BRL";
}

function parseDocumentLines(raw?: string): DocumentLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
    approverEmail: row["Email do aprovador"] || "",
    currentStage: row["Modelo de aprovação"] || "—",
    status: "pending",
    docDate: row["Data de criação"] || row["Data do documento"] || "",
    dueDate: row["Data de vencimento"] || "",
    remarks: row.Observações || "",
    approvalModel: row["Modelo de aprovação"] || "",
    daysOpen: Number(row["Dias em aberto"] || 0),
    attachmentNames: row["Nome do(s) anexo(s)"] || "",
    documentLines: parseDocumentLines(row.DocumentLines),
  };
}

export function useApprovals() {
  const { session } = useSap();
  const [approvals, setApprovals] = useState<ApprovalDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    if (!session || session.erpType !== "sap") return;
    setIsLoading(true);
    setError(null);

    try {
      const detailedView = await sapQueryView<HanaApprovalViewRow>(
        session,
        `${session.companyDB}.VW_APROVACOES_DETALHADAS`,
      );

      if (detailedView.hanaDisabled) {
        // Empresa sem middleware HANA — buscar tudo via Service Layer
        const docs = await fetchApprovalsViaServiceLayer(session as SapSession);
        setApprovals(docs);
      } else {
        const docs = detailedView.data
          .map(mapHanaApproval)
          .filter((doc) => doc.approvalRequestId > 0);
        setApprovals(docs);
      }
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
