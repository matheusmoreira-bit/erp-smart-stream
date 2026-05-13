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

// ===== Service Layer fallback (empresas sem middleware HANA) =====

interface SLApprovalDecision {
  Status?: string;
  UserID?: number;
  ApprovalRequestStep?: number;
}

interface SLApprovalRequest {
  Code?: number;
  OriginatorID?: number;
  DraftEntry?: number;
  DocumentEntry?: number;
  ObjectCode?: string;
  Status?: string;
  RemarksFromOriginator?: string;
  CreationDate?: string;
  UpdateDate?: string;
  ApprovalTemplatesID?: number;
  ApprovalRequestDecisions?: SLApprovalDecision[];
}

interface SLUser {
  InternalKey?: number;
  UserCode?: string;
  UserName?: string;
  eMail?: string;
}

interface SLDraft {
  DocEntry?: number;
  DocNum?: number;
  DocTotal?: number;
  DocTotalFc?: number;
  DocCurrency?: string;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocDueDate?: string;
  Comments?: string;
  DocumentLines?: Array<Record<string, unknown>>;
}

interface SLTemplate {
  Code?: number;
  Name?: string;
}

const OBJECT_CODE_TO_NAME: Record<string, string> = {
  "13": "Nota Fiscal de Saída",
  "15": "Entrega",
  "17": "Pedido de Venda",
  "18": "Nota Fiscal de Entrada",
  "19": "Nota de Crédito de Entrada",
  "20": "Recebimento de Mercadorias",
  "22": "Pedido de Compra",
  "23": "Cotação de Venda",
  "112": "Solicitação de Pagamento",
  "1470000113": "Solicitação de Compra",
  "540000006": "Pagamento Efetuado",
};

function daysBetween(fromIso?: string): number {
  if (!fromIso) return 0;
  const ms = Date.now() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

async function fetchApprovalsViaServiceLayer(session: SapSession): Promise<ApprovalDoc[]> {
  const reqRes = await sapQuery(
    session,
    "ApprovalRequests?$filter=Status eq 'arsPending'&$top=200",
    undefined,
    false,
  );
  const reqData = reqRes.data as { value?: SLApprovalRequest[] } | SLApprovalRequest[];
  const requests: SLApprovalRequest[] = Array.isArray(reqData)
    ? (reqData as SLApprovalRequest[])
    : (reqData?.value || []);

  if (!requests.length) return [];

  const usersRes = await sapQuery(
    session,
    "Users?$select=InternalKey,UserCode,UserName,eMail&$top=500",
    undefined,
    true,
  );
  const usersData = usersRes.data as { value?: SLUser[] } | SLUser[];
  const users: SLUser[] = Array.isArray(usersData) ? usersData : (usersData?.value || []);
  const usersByKey = new Map<number, SLUser>();
  for (const u of users) {
    if (typeof u.InternalKey === "number") usersByKey.set(u.InternalKey, u);
  }

  const tplRes = await sapQuery(
    session,
    "ApprovalTemplates?$select=Code,Name&$top=200",
    undefined,
    true,
  ).catch(() => ({ data: { value: [] as SLTemplate[] } }));
  const tplData = (tplRes as { data: unknown }).data as { value?: SLTemplate[] } | SLTemplate[];
  const templates: SLTemplate[] = Array.isArray(tplData) ? tplData : (tplData?.value || []);
  const tplByCode = new Map<number, string>();
  for (const t of templates) {
    if (typeof t.Code === "number") tplByCode.set(t.Code, t.Name || "");
  }

  const drafts = await Promise.all(
    requests.map(async (r) => {
      if (!r.DraftEntry) return null;
      try {
        const d = await sapQuery(
          session,
          `Drafts(${r.DraftEntry})?$select=DocEntry,DocNum,DocTotal,DocTotalFc,DocCurrency,CardCode,CardName,DocDate,DocDueDate,Comments,DocumentLines`,
          undefined,
          false,
        );
        return d.data as SLDraft;
      } catch {
        return null;
      }
    }),
  );

  return requests.map((r, idx): ApprovalDoc => {
    const draft = drafts[idx] || {};
    const originator = r.OriginatorID ? usersByKey.get(r.OriginatorID) : undefined;

    const pendingDecision = (r.ApprovalRequestDecisions || []).find(
      (d) => d.Status === "asWithoutDecision" || d.Status === "asPending",
    ) || (r.ApprovalRequestDecisions || [])[0];
    const approver = pendingDecision?.UserID ? usersByKey.get(pendingDecision.UserID) : undefined;

    const objCode = String(r.ObjectCode || "");
    const docTypeName = OBJECT_CODE_TO_NAME[objCode] || `Documento (${objCode})`;
    const currency = (draft.DocCurrency || "BRL").toUpperCase();
    const docTotal =
      currency !== "BRL" && draft.DocTotalFc
        ? Number(draft.DocTotalFc)
        : Number(draft.DocTotal || 0);

    return {
      approvalRequestId: Number(r.Code || 0),
      docType: docTypeName,
      docTypeName,
      docNum: Number(draft.DocNum || 0),
      docEntry: Number(r.DraftEntry || draft.DocEntry || 0),
      docTotal,
      currency,
      cardCode: draft.CardCode || "",
      cardName: draft.CardName || "—",
      requester: originator?.UserName || originator?.UserCode || "—",
      currentApprover: approver?.UserName || approver?.UserCode || "—",
      approverEmail: approver?.eMail || "",
      currentStage: r.ApprovalTemplatesID ? (tplByCode.get(r.ApprovalTemplatesID) || "—") : "—",
      status: "pending",
      docDate: r.CreationDate || draft.DocDate || "",
      dueDate: draft.DocDueDate || "",
      remarks: r.RemarksFromOriginator || draft.Comments || "",
      approvalModel: r.ApprovalTemplatesID ? (tplByCode.get(r.ApprovalTemplatesID) || "") : "",
      daysOpen: daysBetween(r.CreationDate),
      attachmentNames: "",
      documentLines: Array.isArray(draft.DocumentLines)
        ? (draft.DocumentLines as unknown as DocumentLine[])
        : [],
    };
  }).filter((d) => d.approvalRequestId > 0);
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
