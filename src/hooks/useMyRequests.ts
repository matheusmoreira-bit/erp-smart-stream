import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, type SapSession } from "@/lib/sap-client";

export interface ApprovalHistoryEntry {
  step: number;
  stageName: string;
  approverName: string;
  approverEmail: string;
  status: "pending" | "approved" | "rejected" | "without_decision";
  statusLabel: string;
  date: string;
  remarks: string;
}

export interface MyRequestDoc {
  approvalRequestId: number;
  docType: string;
  docTypeName: string;
  docNum: number;
  docEntry: number;
  docTotal: number;
  currency: string;
  cardCode: string;
  cardName: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "generated";
  statusLabel: string;
  creationDate: string;
  updateDate: string;
  remarks: string;
  approvalModel: string;
  daysOpen: number;
  history: ApprovalHistoryEntry[];
}

interface SLUser {
  InternalKey?: number;
  UserCode?: string;
  UserName?: string;
  eMail?: string;
}

interface SLDecision {
  Status?: string;
  UserID?: number;
  ApprovalRequestStep?: number;
  CreateDate?: string;
  UpdateDate?: string;
  Remarks?: string;
}

interface SLRequestLine {
  Status?: string;
  UserID?: number;
  StageCode?: number;
  ApprovalRequestStep?: number;
}

interface SLApprovalRequest {
  Code?: number;
  OriginatorID?: number;
  DraftEntry?: number;
  DocumentEntry?: number;
  ObjectType?: string;
  Status?: string;
  RemarksFromOriginator?: string;
  CreationDate?: string;
  UpdateDate?: string;
  ApprovalTemplatesID?: number;
  ApprovalRequestDecisions?: SLDecision[];
  ApprovalRequestLines?: SLRequestLine[];
}

interface SLTemplate { Code?: number; Name?: string }
interface SLStage { Code?: number; Name?: string }
interface SLDraft {
  DocEntry?: number;
  DocNum?: number;
  DocTotal?: number;
  DocTotalFc?: number;
  DocCurrency?: string;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  Comments?: string;
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

const REQUEST_STATUS_MAP: Record<string, { key: MyRequestDoc["status"]; label: string }> = {
  arsPending: { key: "pending", label: "Pendente" },
  arsApproved: { key: "approved", label: "Aprovado" },
  arsWasNotApproved: { key: "rejected", label: "Rejeitado" },
  arsCancelled: { key: "cancelled", label: "Cancelado" },
  arsGenerated: { key: "generated", label: "Gerado" },
};

const DECISION_STATUS_MAP: Record<string, { key: ApprovalHistoryEntry["status"]; label: string }> = {
  ardApproved: { key: "approved", label: "Aprovado" },
  ardNotApproved: { key: "rejected", label: "Rejeitado" },
  ardPending: { key: "pending", label: "Pendente" },
  asPending: { key: "pending", label: "Pendente" },
  asWithoutDecision: { key: "without_decision", label: "Sem decisão" },
};

function daysBetween(fromIso?: string): number {
  if (!fromIso) return 0;
  const ms = Date.now() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

async function getUserKeyByCode(session: SapSession, userCode: string): Promise<number | null> {
  try {
    const res = await sapQuery(
      session,
      `Users?$filter=UserCode eq '${userCode}'&$select=InternalKey,UserCode`,
      undefined,
      true,
    );
    const data = res.data as { value?: SLUser[] } | SLUser[];
    const list = Array.isArray(data) ? data : (data?.value || []);
    const key = list[0]?.InternalKey;
    return typeof key === "number" ? key : null;
  } catch {
    return null;
  }
}

async function fetchUsersByIds(session: SapSession, ids: number[]): Promise<Map<number, SLUser>> {
  const map = new Map<number, SLUser>();
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  await Promise.all(
    unique.map(async (id) => {
      try {
        const res = await sapQuery(
          session,
          `Users(${id})?$select=InternalKey,UserCode,UserName,eMail`,
          undefined,
          true,
        );
        const u = res.data as SLUser;
        if (u && typeof u.InternalKey === "number") map.set(u.InternalKey, u);
      } catch {
        // ignore individual failures
      }
    }),
  );
  return map;
}

async function fetchTemplate(session: SapSession, id: number): Promise<SLTemplate | null> {
  try {
    const res = await sapQuery(session, `ApprovalTemplates(${id})?$select=Code,Name`, undefined, true);
    return res.data as SLTemplate;
  } catch { return null; }
}

async function fetchStage(session: SapSession, code: number): Promise<SLStage | null> {
  try {
    const res = await sapQuery(session, `ApprovalStages(${code})?$select=Code,Name`, undefined, true);
    return res.data as SLStage;
  } catch { return null; }
}

async function fetchDraft(session: SapSession, draftEntry: number): Promise<SLDraft | null> {
  try {
    const res = await sapQuery(
      session,
      `Drafts(${draftEntry})?$select=DocEntry,DocNum,DocTotal,DocTotalFc,DocCurrency,CardCode,CardName,DocDate,Comments`,
      undefined,
      true,
    );
    return res.data as SLDraft;
  } catch { return null; }
}

function normalizeCurrency(currency?: string): string {
  const value = (currency || "").trim();
  if (!value || value === "R$") return "BRL";
  if (value === "$") return "USD";
  if (value === "€") return "EUR";
  if (value.length === 3) return value.toUpperCase();
  return "BRL";
}

export function useMyRequests() {
  const { session } = useSap();
  const [requests, setRequests] = useState<MyRequestDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!session || session.erpType !== "sap") {
      setRequests([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const userKey = await getUserKeyByCode(session as SapSession, session.userName);
      if (!userKey) {
        setRequests([]);
        return;
      }

      const res = await sapQuery(
        session as SapSession,
        `ApprovalRequests?$filter=OriginatorID eq ${userKey}&$orderby=CreationDate desc&$top=200`,
        undefined,
        false,
      );
      const data = res.data as { value?: SLApprovalRequest[] } | SLApprovalRequest[];
      const raw: SLApprovalRequest[] = Array.isArray(data) ? data : (data?.value || []);

      // Collect all needed user ids + stage codes + template ids
      const userIds = new Set<number>();
      const stageCodes = new Set<number>();
      const templateIds = new Set<number>();
      for (const r of raw) {
        if (r.ApprovalTemplatesID) templateIds.add(r.ApprovalTemplatesID);
        for (const d of r.ApprovalRequestDecisions || []) {
          if (d.UserID) userIds.add(d.UserID);
        }
        for (const l of r.ApprovalRequestLines || []) {
          if (l.UserID) userIds.add(l.UserID);
          const s = l.StageCode || l.ApprovalRequestStep;
          if (s) stageCodes.add(Number(s));
        }
      }

      const [usersMap, templateEntries, stageEntries] = await Promise.all([
        fetchUsersByIds(session as SapSession, Array.from(userIds)),
        Promise.all(Array.from(templateIds).map(async (id) => [id, await fetchTemplate(session as SapSession, id)] as const)),
        Promise.all(Array.from(stageCodes).map(async (code) => [code, await fetchStage(session as SapSession, code)] as const)),
      ]);

      const templatesMap = new Map<number, SLTemplate>();
      for (const [id, t] of templateEntries) if (t) templatesMap.set(id, t);
      const stagesMap = new Map<number, SLStage>();
      for (const [code, s] of stageEntries) if (s) stagesMap.set(code, s);

      // Fetch drafts in parallel
      const draftsMap = new Map<number, SLDraft>();
      await Promise.all(
        raw
          .filter((r) => r.DraftEntry)
          .map(async (r) => {
            const d = await fetchDraft(session as SapSession, Number(r.DraftEntry));
            if (d) draftsMap.set(Number(r.DraftEntry), d);
          }),
      );

      const result: MyRequestDoc[] = raw.map((r) => {
        const draft = r.DraftEntry ? draftsMap.get(Number(r.DraftEntry)) : undefined;
        const objCode = String(r.ObjectType || "");
        const docTypeName = OBJECT_CODE_TO_NAME[objCode] || (objCode ? `Documento (${objCode})` : "Documento");
        const currency = normalizeCurrency(draft?.DocCurrency);
        const docTotal = currency !== "BRL" && draft?.DocTotalFc
          ? Number(draft.DocTotalFc)
          : Number(draft?.DocTotal || 0);

        const templateName = r.ApprovalTemplatesID
          ? templatesMap.get(r.ApprovalTemplatesID)?.Name || ""
          : "";

        const statusInfo = REQUEST_STATUS_MAP[r.Status || ""] || { key: "pending" as const, label: r.Status || "—" };

        // Build history from decisions, enriched by lines for stage info
        const linesByStep = new Map<number, SLRequestLine>();
        for (const l of r.ApprovalRequestLines || []) {
          const step = Number(l.ApprovalRequestStep || 0);
          if (step) linesByStep.set(step, l);
        }

        const decisions = (r.ApprovalRequestDecisions || []).slice().sort((a, b) => {
          const sa = Number(a.ApprovalRequestStep || 0);
          const sb = Number(b.ApprovalRequestStep || 0);
          if (sa !== sb) return sa - sb;
          return (a.UpdateDate || "").localeCompare(b.UpdateDate || "");
        });

        const history: ApprovalHistoryEntry[] = decisions.map((d) => {
          const step = Number(d.ApprovalRequestStep || 0);
          const line = linesByStep.get(step);
          const stageCode = line?.StageCode ? Number(line.StageCode) : undefined;
          const stage = stageCode ? stagesMap.get(stageCode) : undefined;
          const user = d.UserID ? usersMap.get(d.UserID) : undefined;
          const decisionInfo = DECISION_STATUS_MAP[d.Status || ""] || { key: "pending" as const, label: d.Status || "—" };
          return {
            step,
            stageName: stage?.Name || templateName || "—",
            approverName: user?.UserName || user?.UserCode || "—",
            approverEmail: user?.eMail || "",
            status: decisionInfo.key,
            statusLabel: decisionInfo.label,
            date: d.UpdateDate || d.CreateDate || "",
            remarks: d.Remarks || "",
          };
        });

        return {
          approvalRequestId: Number(r.Code || 0),
          docType: docTypeName,
          docTypeName,
          docNum: Number(draft?.DocNum || 0),
          docEntry: Number(r.DraftEntry || draft?.DocEntry || 0),
          docTotal,
          currency,
          cardCode: draft?.CardCode || "",
          cardName: draft?.CardName || "—",
          status: statusInfo.key,
          statusLabel: statusInfo.label,
          creationDate: r.CreationDate || draft?.DocDate || "",
          updateDate: r.UpdateDate || "",
          remarks: r.RemarksFromOriginator || draft?.Comments || "",
          approvalModel: templateName,
          daysOpen: daysBetween(r.CreationDate),
          history,
        };
      });

      setRequests(result);
    } catch (e) {
      console.error("Error fetching my requests:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar pedidos");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  return { requests, isLoading, error, refresh: fetchRequests };
}
