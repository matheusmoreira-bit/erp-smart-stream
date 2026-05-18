import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, sapQueryView, sapReadApprovalsCache, sapWriteApprovalsCache, type SapSession } from "@/lib/sap-client";
import { supabase } from "@/integrations/supabase/client";


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

interface SLApprovalRequestLine {
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
  ApprovalRequestDecisions?: SLApprovalDecision[];
  ApprovalRequestLines?: SLApprovalRequestLine[];
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
  ApprovalTemplatesStages?: Array<{ ApprovalStageID?: number }>;
}

interface SLStage {
  Code?: number;
  Name?: string;
  NumberOfApproversRequired?: number;
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

function isPendingDecisionStatus(status?: string): boolean {
  return status === "asWithoutDecision" || status === "asPending";
}

function isPendingLineStatus(status?: string): boolean {
  return status === "ardPending" || status === "asWithoutDecision" || status === "asPending";
}

function getPendingApproval(r: SLApprovalRequest, decisions: SLApprovalDecision[]) {
  const decision = decisions.find((d) => isPendingDecisionStatus(d.Status));
  if (decision) {
    return {
      userId: decision.UserID,
      stageCode: decision.ApprovalRequestStep,
    };
  }

  const line = (r.ApprovalRequestLines || []).find((l) => isPendingLineStatus(l.Status));
  return {
    userId: line?.UserID,
    stageCode: line?.StageCode || line?.ApprovalRequestStep,
  };
}

// ===== Caches: DB (sap_cache, TTL 1 dia gerenciado pelo backend) + memória de sessão =====
const slUsersMem = new Map<string, Map<number, SLUser>>();
const slTemplatesMem = new Map<string, Map<number, SLTemplate>>();
const slStagesMem = new Map<string, Map<number, SLStage>>();
const slStageApproversMem = new Map<string, Map<number, number[]>>();

async function readDbCache<T>(companyDB: string, cacheKey: string): Promise<T | null> {
  const { data, error } = await supabase
    .from("sap_cache")
    .select("data, expires_at")
    .eq("company_db", companyDB)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.data as T;
}

async function getUsers(session: SapSession): Promise<Map<number, SLUser>> {
  const memo = slUsersMem.get(session.companyDB);
  if (memo) return memo;

  const cached = await readDbCache<SLUser[]>(session.companyDB, "sl_users");
  let list: SLUser[] = cached || [];
  if (!cached) {
    try {
      const res = await sapQuery(
        session,
        "Users?$select=InternalKey,UserCode,UserName,eMail&$top=500",
        undefined,
        true,
      );
      const data = res.data as { value?: SLUser[] } | SLUser[];
      list = Array.isArray(data) ? data : (data?.value || []);
    } catch (e) { console.warn("Users SL falhou:", e); }
  }
  const map = new Map<number, SLUser>();
  for (const u of list) if (typeof u.InternalKey === "number") map.set(u.InternalKey, u);
  slUsersMem.set(session.companyDB, map);
  return map;
}

async function fetchUsersByIds(session: SapSession, ids: number[]): Promise<void> {
  const map = slUsersMem.get(session.companyDB) || new Map<number, SLUser>();
  const missing = ids.filter((id) => Number.isFinite(id) && id > 0 && !map.has(id));
  if (!missing.length) {
    slUsersMem.set(session.companyDB, map);
    return;
  }
  // Batch via $filter to avoid one-request-per-id (which causes SAP 504s).
  const CHUNK = 20;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const filter = chunk.map((id) => `InternalKey eq ${id}`).join(" or ");
    const path = `Users?$select=InternalKey,UserCode,UserName,eMail&$filter=${encodeURIComponent(filter)}&$top=${chunk.length}`;
    try {
      const res = await sapQuery(session, path, undefined, true);
      const data = res.data as { value?: SLUser[] } | SLUser[];
      const list = Array.isArray(data) ? data : (data?.value || []);
      for (const u of list) {
        if (u && typeof u.InternalKey === "number") map.set(u.InternalKey, u);
      }
    } catch (e) {
      console.warn(`Users batch [${chunk.join(",")}] falhou:`, e);
    }
  }
  slUsersMem.set(session.companyDB, map);
}

async function getTemplates(session: SapSession): Promise<Map<number, SLTemplate>> {
  const memo = slTemplatesMem.get(session.companyDB);
  if (memo) return memo;

  const cached = await readDbCache<SLTemplate[]>(session.companyDB, "sl_templates");
  let list: SLTemplate[] = cached || [];
  if (!cached) {
    try {
      const res = await sapQuery(session, "ApprovalTemplates?$select=Code,Name&$top=200", undefined, true);
      const data = res.data as { value?: SLTemplate[] } | SLTemplate[];
      list = Array.isArray(data) ? data : (data?.value || []);
    } catch (e) { console.warn("Templates SL falhou:", e); }
  }
  const map = new Map<number, SLTemplate>();
  for (const t of list) if (typeof t.Code === "number") map.set(t.Code, t);
  slTemplatesMem.set(session.companyDB, map);
  return map;
}

async function getStages(session: SapSession): Promise<Map<number, SLStage>> {
  const memo = slStagesMem.get(session.companyDB);
  if (memo) return memo;

  const cached = await readDbCache<SLStage[]>(session.companyDB, "sl_stages");
  let list: SLStage[] = cached || [];
  if (!cached) {
    try {
      const res = await sapQuery(session, "ApprovalStages?$select=Code,Name&$top=200", undefined, true);
      const data = res.data as { value?: SLStage[] } | SLStage[];
      list = Array.isArray(data) ? data : (data?.value || []);
    } catch (e) { console.warn("Stages SL falhou:", e); }
  }
  const map = new Map<number, SLStage>();
  for (const s of list) if (typeof s.Code === "number") map.set(s.Code, s);
  slStagesMem.set(session.companyDB, map);
  return map;
}

async function getStageApprovers(session: SapSession, stageCode: number): Promise<number[]> {
  let bucket = slStageApproversMem.get(session.companyDB);
  if (bucket?.has(stageCode)) return bucket.get(stageCode) || [];

  if (!bucket) {
    const cached = await readDbCache<Record<string, number[]>>(session.companyDB, "sl_stage_approvers");
    bucket = new Map<number, number[]>();
    if (cached) {
      for (const [k, v] of Object.entries(cached)) bucket.set(Number(k), v);
    }
    slStageApproversMem.set(session.companyDB, bucket);
    if (bucket.has(stageCode)) return bucket.get(stageCode) || [];
  }

  try {
    const res = await sapQuery(
      session,
      `ApprovalStages(${stageCode})?$select=Code,StageApprovers`,
      undefined,
      true,
    );
    const raw = res.data as { StageApprovers?: Array<{ UserCode?: number }> };
    const ids = (raw?.StageApprovers || [])
      .map((a) => Number(a.UserCode))
      .filter((n) => Number.isFinite(n) && n > 0);
    bucket.set(stageCode, ids);
    return ids;
  } catch {
    return [];
  }
}

async function fetchApprovalsViaServiceLayer(session: SapSession): Promise<ApprovalDoc[]> {
  const reqRes = await sapQuery(
    session,
    "ApprovalRequests?$filter=Status eq 'arsPending'&$select=Code,OriginatorID,DraftEntry,DocumentEntry,ObjectType,Status,RemarksFromOriginator,CreationDate,UpdateDate,ApprovalTemplatesID,ApprovalRequestDecisions,ApprovalRequestLines&$top=200",
    undefined,
    true,
  );
  const reqData = reqRes.data as { value?: SLApprovalRequest[] } | SLApprovalRequest[];
  const requests: SLApprovalRequest[] = Array.isArray(reqData)
    ? (reqData as SLApprovalRequest[])
    : (reqData?.value || []);

  if (!requests.length) return [];

  // Cargas paralelas com cache
  const [usersByKey, templatesByCode, stagesByCode] = await Promise.all([
    getUsers(session),
    getTemplates(session),
    getStages(session),
  ]);

  const runLimited = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += limit) {
      const chunk = items.slice(i, i + limit);
      results.push(...await Promise.all(chunk.map(worker)));
    }
    return results;
  };

  // Evita tempestade de chamadas ao Service Layer: decisões vêm no request;
  // apenas drafts são carregados em pequenos lotes e com cache do proxy.
  const enriched = await runLimited(requests, 6, async (r) => {
    const draft = r.DraftEntry
      ? await sapQuery(
          session,
          `Drafts(${r.DraftEntry})?$select=DocEntry,DocNum,DocTotal,DocTotalFc,DocCurrency,CardCode,CardName,DocDate,DocDueDate,Comments,DocumentLines`,
          undefined,
          true,
        ).then((d) => d.data as SLDraft).catch(() => null)
      : null;
    return { r, decisions: r.ApprovalRequestDecisions || [], draft: draft || ({} as SLDraft) };
  });

  // Buscar approvers das etapas pendentes (com cache por etapa)
  const pendingStageCodes = new Set<number>();
  for (const { r, decisions } of enriched) {
    const pending = getPendingApproval(r, decisions);
    if (!pending.userId && pending.stageCode) pendingStageCodes.add(Number(pending.stageCode));
  }
  await Promise.all(
    Array.from(pendingStageCodes).map((code) => getStageApprovers(session, code)),
  );

  // Coletar todos os user IDs necessários (originators + decisores + 1º aprovador da etapa)
  const userIdsNeeded = new Set<number>();
  for (const { r, decisions } of enriched) {
    if (r.OriginatorID) userIdsNeeded.add(Number(r.OriginatorID));
    const pending = getPendingApproval(r, decisions);
    if (pending.userId) userIdsNeeded.add(Number(pending.userId));
    for (const d of decisions) {
      if (d.UserID) userIdsNeeded.add(Number(d.UserID));
    }
  }
  for (const stageCode of pendingStageCodes) {
    const ids = slStageApproversMem.get(session.companyDB)?.get(stageCode) || [];
    for (const id of ids) userIdsNeeded.add(id);
  }
  await fetchUsersByIds(session, Array.from(userIdsNeeded));
  const usersFinal = slUsersMem.get(session.companyDB) || usersByKey;

  return enriched.map(({ r, decisions, draft }): ApprovalDoc => {
    const originator = r.OriginatorID ? usersFinal.get(r.OriginatorID) : undefined;

    const pending = getPendingApproval(r, decisions);

    let approver: SLUser | undefined;
    if (pending.userId) {
      approver = usersFinal.get(pending.userId);
    } else if (pending.stageCode) {
      // fallback: pega primeiro approver configurado da etapa
      const stageCode = Number(pending.stageCode);
      const approverIds =
        slStageApproversMem.get(session.companyDB)?.get(stageCode) || [];
      const firstId = approverIds[0];
      if (firstId) approver = usersFinal.get(firstId);
    }

    const stageName =
      pending.stageCode
        ? stagesByCode.get(Number(pending.stageCode))?.Name || "—"
        : "—";
    const templateName = r.ApprovalTemplatesID
      ? templatesByCode.get(r.ApprovalTemplatesID)?.Name || "—"
      : "—";

    const objCode = String(r.ObjectType || "");
    const docTypeName = OBJECT_CODE_TO_NAME[objCode] || (objCode ? `Documento (${objCode})` : "Documento");
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
      currentStage: stageName !== "—" ? stageName : templateName,
      status: "pending",
      docDate: r.CreationDate || draft.DocDate || "",
      dueDate: draft.DocDueDate || "",
      remarks: r.RemarksFromOriginator || draft.Comments || "",
      approvalModel: templateName !== "—" ? templateName : "",
      daysOpen: daysBetween(r.CreationDate),
      attachmentNames: "",
      documentLines: Array.isArray(draft.DocumentLines)
        ? (draft.DocumentLines as unknown as DocumentLine[])
        : [],
    };
  }).filter((d) => d.approvalRequestId > 0);
}

const APPROVALS_CACHE_KEY = "approvals:detailed";
const APPROVALS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function readApprovalsCache(session: SapSession): Promise<{ docs: ApprovalDoc[]; updatedAt: string } | null> {
  const data = await sapReadApprovalsCache<ApprovalDoc[]>(session);
  if (!data.data || !data.updatedAt) return null;
  return { docs: data.data, updatedAt: data.updatedAt };
}

async function writeApprovalsCache(session: SapSession, docs: ApprovalDoc[]): Promise<void> {
  await sapWriteApprovalsCache(session, docs, APPROVALS_CACHE_TTL_MS);
}

export function useApprovals() {
  const { session } = useSap();
  const [approvals, setApprovals] = useState<ApprovalDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const fetchFromSap = useCallback(async (): Promise<ApprovalDoc[]> => {
    if (!session || session.erpType !== "sap") return [];
    const detailedView = await sapQueryView<HanaApprovalViewRow>(
      session,
      `${session.companyDB}.VW_APROVACOES_DETALHADAS`,
      undefined,
      false,
    );

    if (detailedView.hanaDisabled) {
      return await fetchApprovalsViaServiceLayer(session as SapSession);
    }
    const hanaDocs = detailedView.data
      .map(mapHanaApproval)
      .filter((doc) => doc.approvalRequestId > 0);
    const serviceLayerDocs = await fetchApprovalsViaServiceLayer(session as SapSession).catch(() => []);
    const hanaIds = new Set(hanaDocs.map((doc) => doc.approvalRequestId));
    const missingFromView = serviceLayerDocs.filter((doc) => !hanaIds.has(doc.approvalRequestId));
    return [...hanaDocs, ...missingFromView];
  }, [session]);

  const fetchApprovals = useCallback(async (opts?: { force?: boolean }) => {
    if (!session || session.erpType !== "sap") return;
    const force = !!opts?.force;
    setError(null);

    // 1) Try cache first (unless forced)
    if (!force) {
      try {
        const cached = await readApprovalsCache(session as SapSession);
        if (cached) {
          setApprovals(cached.docs);
          setLastUpdatedAt(cached.updatedAt);
          setIsLoading(false);
          const age = Date.now() - new Date(cached.updatedAt).getTime();
          if (age < APPROVALS_CACHE_TTL_MS) return; // fresh, skip SAP
          // stale: fall through to refresh in background
        }
      } catch (e) {
        console.warn("approvals cache read failed:", e);
      }
    }

    const hasData = approvals.length > 0;
    if (force || !hasData) setIsLoading(true);
    setIsRefreshing(true);
    try {
      const docs = await fetchFromSap();
      setApprovals(docs);
      const now = new Date().toISOString();
      setLastUpdatedAt(now);
      writeApprovalsCache(session as SapSession, docs).catch((e) => console.warn("approvals cache write failed:", e));
    } catch (e) {
      console.error("Error fetching approvals:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar aprovações");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [session, fetchFromSap, approvals.length]);

  useEffect(() => {
    fetchApprovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyDB, session?.erpType]);

  // Auto-refresh every 5 minutes while the page is open
  useEffect(() => {
    if (!session || session.erpType !== "sap") return;
    const id = setInterval(() => {
      fetchApprovals({ force: true });
    }, APPROVALS_CACHE_TTL_MS);
    return () => clearInterval(id);
  }, [session, fetchApprovals]);

  return {
    approvals,
    isLoading,
    isRefreshing,
    error,
    lastUpdatedAt,
    refresh: () => fetchApprovals({ force: false }),
    refreshCache: () => fetchApprovals({ force: true }),
  };
}
