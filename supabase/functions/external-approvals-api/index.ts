// External Approvals API
// REST endpoints for an external system to list / approve / reject SAP B1 approval requests.
//
// Auth: header `X-API-Key: <EXTERNAL_APPROVALS_API_KEY>`
// Routes (POST /functions/v1/external-approvals-api):
//   { "op": "list",    "company_db": "...", "user_code": "...", "status": "pending|approved|rejected|cancelled|generated|all",
//     "doc_object_type": "22", "limit": 50, "offset": 0 }
//   { "op": "detail",  "company_db": "...", "approval_request_id": 123 }
//   { "op": "approve", "company_db": "...", "user_code": "...", "approval_request_id": 123, "step": 1, "remarks": "ok" }
//   { "op": "reject",  "company_db": "...", "user_code": "...", "approval_request_id": 123, "step": 1, "remarks": "no" }

//
// Notes:
// - `user_code` is the SAP UserCode (same identifier used in SAP B1 for both requester and approver).
// - `company_db` is the SAP CompanyDB / tenant identifier.
// - The function uses the admin credentials stored in `system_credentials` per company
//   to authenticate against SAP B1 Service Layer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { enforceRateLimit, rateLimitResponse, clientIpFrom } from "../_shared/rate-limit.ts";
import { validateApiKey } from "../_shared/api-keys.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface SapSession {
  sessionId: string;
  routeId: string;
  baseUrl: string;
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
  ObjectType?: string;
  Status?: string;
  RemarksFromOriginator?: string;
  CreationDate?: string;
  UpdateDate?: string;
  ApprovalTemplatesID?: number;
  ApprovalRequestDecisions?: SLDecision[];
  ApprovalRequestLines?: SLRequestLine[];
}
interface SLDocumentLine {
  CostingCode?: string;
  CostingCode2?: string;
  CostingCode3?: string;
  CostingCode4?: string;
  CostingCode5?: string;
  ProjectCode?: string;
}
interface SLInstallment {
  DueDate?: string;
  Total?: number;
}
interface SLDraft {
  DocEntry?: number;
  DocNum?: number;
  DocTotal?: number;
  DocCurrency?: string;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocDueDate?: string;
  TaxDate?: string;
  Cancelled?: string;
  DocumentStatus?: string;
  Project?: string;
  Comments?: string;
  DocumentLines?: SLDocumentLine[];
  DocumentInstallments?: SLInstallment[];
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

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getCompanyConfig(companyDB: string) {
  const client = sb();
  const { data, error } = await client
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDB);
  if (error) throw new Error(`Falha ao ler credenciais: ${error.message}`);
  const map = new Map<string, string>(
    (data || []).map((r) => [r.credential_key, r.credential_value]),
  );

  const username = map.get("username");
  const password = map.get("password");
  let url = map.get("service_layer_url");
  let sapCompanyDb = map.get("company_db") || companyDB;

  if (!url) {
    const { data: row } = await client
      .from("companies")
      .select("service_layer_url")
      .eq("company_db", companyDB)
      .maybeSingle();
    url = row?.service_layer_url || undefined;
  }
  if (!url) throw new Error(`Service Layer URL não configurada para empresa ${companyDB}`);
  if (!username || !password) {
    throw new Error(`Credenciais admin não configuradas para empresa ${companyDB}`);
  }

  url = url.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;

  return { baseUrl: url, username, password, sapCompanyDb };
}

async function sapLoginOnce(cfg: { baseUrl: string; username: string; password: string; sapCompanyDb: string }): Promise<SapSession> {
  const resp = await fetch(`${cfg.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: cfg.username, Password: cfg.password, CompanyDB: cfg.sapCompanyDb }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    const err = new Error(`Falha no login SAP (${resp.status}): ${t.slice(0, 300)}`);
    // deno-lint-ignore no-explicit-any
    (err as any).body = t;
    // deno-lint-ignore no-explicit-any
    (err as any).status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const setCookie = resp.headers.get("set-cookie") || "";
  const sId = setCookie.match(/B1SESSION=([^;]+)/)?.[1] || data.SessionId;
  const rId = setCookie.match(/ROUTEID=([^;]+)/)?.[1] || "";
  return { sessionId: sId, routeId: rId, baseUrl: cfg.baseUrl };
}

async function sapLogin(cfg: { baseUrl: string; username: string; password: string; sapCompanyDb: string }): Promise<SapSession> {
  try {
    return await sapLoginOnce(cfg);
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const body = String((e as any)?.body || (e instanceof Error ? e.message : ""));
    const looksSaml = /SAML Login Failed|SSO|user.*disabled|password.*expired|Invalid.*credentials/i.test(body);
    const fbUser = Deno.env.get("SAP_FALLBACK_ADMIN_USERNAME");
    const fbPass = Deno.env.get("SAP_FALLBACK_ADMIN_PASSWORD");
    if (looksSaml && fbUser && fbPass && (fbUser !== cfg.username || fbPass !== cfg.password)) {
      console.warn(`[external-approvals-api] SAP login falhou para ${cfg.username}@${cfg.sapCompanyDb} (${body.slice(0, 120)}). Tentando fallback admin.`);
      return await sapLoginOnce({ ...cfg, username: fbUser, password: fbPass });
    }
    throw e;
  }
}

async function sapLogout(s: SapSession) {
  const cookies = `B1SESSION=${s.sessionId}${s.routeId ? `; ROUTEID=${s.routeId}` : ""}`;
  await fetch(`${s.baseUrl}/Logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
  }).catch(() => {});
}

// Cache de sessão SAP por empresa (a sessão do Service Layer dura 30 min).
// Evita pagar o custo do login a cada request do painel externo.
const SESSION_TTL_MS = 20 * 60 * 1000;
const sessionCache = new Map<string, { session: SapSession; expiresAt: number }>();

async function getSession(
  companyDB: string,
  cfg: { baseUrl: string; username: string; password: string; sapCompanyDb: string },
  forceNew = false,
): Promise<SapSession> {
  const cached = sessionCache.get(companyDB);
  if (!forceNew && cached && cached.expiresAt > Date.now()) return cached.session;
  if (cached) sessionCache.delete(companyDB);
  const session = await sapLogin(cfg);
  sessionCache.set(companyDB, { session, expiresAt: Date.now() + SESSION_TTL_MS });
  return session;
}

function isSessionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\(401\)|\(403\)|Invalid session|session.*expired/i.test(msg);
}

/** Executa a operação reaproveitando a sessão em cache; refaz login se ela expirou. */
async function withSession<T>(
  companyDB: string,
  cfg: { baseUrl: string; username: string; password: string; sapCompanyDb: string },
  fn: (s: SapSession) => Promise<T>,
): Promise<T> {
  const session = await getSession(companyDB, cfg);
  try {
    return await fn(session);
  } catch (e) {
    if (!isSessionError(e)) throw e;
    sessionCache.delete(companyDB);
    const fresh = await getSession(companyDB, cfg, true);
    return await fn(fresh);
  }
}


async function sapGet(s: SapSession, endpoint: string): Promise<unknown> {
  const cookies = `B1SESSION=${s.sessionId}${s.routeId ? `; ROUTEID=${s.routeId}` : ""}`;
  const resp = await fetch(`${s.baseUrl}/${endpoint}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Cookie: cookies },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`SAP GET ${endpoint} falhou (${resp.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function sapPatch(s: SapSession, endpoint: string, body: unknown): Promise<void> {
  const cookies = `B1SESSION=${s.sessionId}${s.routeId ? `; ROUTEID=${s.routeId}` : ""}`;
  const resp = await fetch(`${s.baseUrl}/${endpoint}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify(body),
  });
  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text();
    throw new Error(`SAP PATCH ${endpoint} falhou (${resp.status}): ${text.slice(0, 300)}`);
  }
}

async function getUserKey(s: SapSession, userCode: string): Promise<number> {
  const safe = userCode.replace(/'/g, "''");
  const data = (await sapGet(
    s,
    `Users?$filter=UserCode eq '${safe}'&$select=InternalKey,UserCode,UserName,eMail`,
  )) as { value?: Array<{ InternalKey?: number }> };
  const key = data?.value?.[0]?.InternalKey;
  if (!key) throw new Error(`Usuário SAP '${userCode}' não encontrado`);
  return Number(key);
}

async function fetchDraftBrief(s: SapSession, draftEntry: number): Promise<SLDraft | null> {
  try {
    return (await sapGet(
      s,
      `Drafts(${draftEntry})?$select=DocEntry,DocNum,DocTotal,DocCurrency,CardCode,CardName,DocDate,DocDueDate,TaxDate,Cancelled,DocumentStatus,Project,Comments,DocumentLines,DocumentInstallments`,
    )) as SLDraft;
  } catch {
    return null;
  }
}

/** Resolve UserCode apenas dos IDs necessários (bem mais rápido que varrer Users). */
async function fetchUsersMap(s: SapSession, ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  await mapLimit(unique, 8, async (id) => {
    try {
      const u = (await sapGet(s, `Users(${id})?$select=InternalKey,UserCode`)) as {
        InternalKey?: number;
        UserCode?: string;
      };
      if (u?.InternalKey != null) map.set(Number(u.InternalKey), String(u.UserCode || ""));
    } catch {
      // usuário inexistente/sem acesso — mantém código vazio
    }
  });
  return map;
}

/** IDs de usuário referenciados por uma solicitação (decisões + linhas + originador). */
function userIdsFromRequest(r: SLApprovalRequest): number[] {
  const ids: number[] = [];
  if (r.OriginatorID) ids.push(Number(r.OriginatorID));
  for (const d of r.ApprovalRequestDecisions || []) if (d.UserID) ids.push(Number(d.UserID));
  for (const l of r.ApprovalRequestLines || []) if (l.UserID) ids.push(Number(l.UserID));
  return ids;
}


function pendingApproversFromRequest(
  r: SLApprovalRequest,
  usersMap: Map<number, string>,
): Array<{ user_id: number; user_code: string; step: number }> {
  const seen = new Set<string>();
  const out: Array<{ user_id: number; user_code: string; step: number }> = [];
  const push = (uid: number | undefined, step: number | undefined) => {
    if (!uid) return;
    const s = Number(step || 1);
    const key = `${uid}:${s}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ user_id: Number(uid), user_code: usersMap.get(Number(uid)) || "", step: s });
  };
  for (const d of r.ApprovalRequestDecisions || []) {
    if (d.Status === "ardPending" || d.Status === "asWithoutDecision" || !d.Status) {
      push(d.UserID, d.ApprovalRequestStep);
    }
  }
  for (const l of r.ApprovalRequestLines || []) {
    if (l.Status === "asPending" || l.Status === "ardPending" || !l.Status) {
      push(l.UserID, l.ApprovalRequestStep);
    }
  }
  return out;
}

const STATUS_FILTERS: Record<string, string | null> = {
  pending: "Status eq 'arsPending'",
  approved: "Status eq 'arsApproved'",
  rejected: "(Status eq 'arsWasNotApproved' or Status eq 'arsNotApproved')",
  cancelled: "Status eq 'arsCancelled'",
  generated: "Status eq 'arsGenerated'",
  all: null,
};

const REQUEST_STATUS_LABEL: Record<string, string> = {
  arsPending: "Pendente",
  arsApproved: "Aprovado",
  arsWasNotApproved: "Rejeitado",
  arsNotApproved: "Rejeitado",
  arsCancelled: "Cancelado",
  arsGenerated: "Gerado",
};

const DECISION_STATUS_LABEL: Record<string, string> = {
  ardApproved: "Aprovado",
  ardNotApproved: "Rejeitado",
  ardWasNotApproved: "Rejeitado",
  ardPending: "Pendente",
  asPending: "Pendente",
  asWithoutDecision: "Sem decisão",
};

/** Executa promessas com concorrência limitada (evita estourar o Service Layer). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Lista aprovações da empresa com paginação e filtros.
 *
 * - `userKey === null` → todas as solicitações da empresa (com `pending_approvers`).
 * - `userKey` informado → apenas documentos em que o usuário tem pendência
 *   (para status ≠ pending, documentos em que ele participou da decisão).
 *
 * Opções: `status` (pending|approved|rejected|cancelled|generated|all),
 * `docObjectType` (código SAP do objeto), `limit` e `offset`.
 */
async function listApprovals(
  s: SapSession,
  userKey: number | null,
  userCode: string,
  opts: { status: string; docObjectType: string; limit: number; offset: number },
) {
  const filters: string[] = [];
  const statusFilter = STATUS_FILTERS[opts.status];
  if (statusFilter) filters.push(statusFilter);
  if (opts.docObjectType) filters.push(`ObjectType eq '${opts.docObjectType.replace(/'/g, "''")}'`);
  const filterQs = filters.length ? `$filter=${encodeURIComponent(filters.join(" and "))}&` : "";

  // Sem user_code, a paginação é resolvida direto no SAP.
  // Com user_code, o filtro é pós-consulta: buscamos uma janela maior e paginamos aqui.
  const serverPaged = userKey == null;
  const fetchTop = serverPaged ? opts.limit + 1 : Math.min(opts.offset + opts.limit * 5 + 50, 400);
  const skipQs = serverPaged && opts.offset > 0 ? `$skip=${opts.offset}&` : "";

  const data = (await sapGet(
    s,
    `ApprovalRequests?${filterQs}${skipQs}$orderby=CreationDate desc&$top=${fetchTop}`,
  )) as { value?: SLApprovalRequest[] };
  let raw = data?.value || [];

  const hasMoreServer = serverPaged && raw.length > opts.limit;
  if (serverPaged) raw = raw.slice(0, opts.limit);

  

  // Pré-filtra por usuário antes de buscar drafts (o custo está nos drafts).
  const stepByCode = new Map<number, number>();
  if (userKey != null) {
    raw = raw.filter((r) => {
      const myLine = (r.ApprovalRequestLines || []).find((l) => Number(l.UserID) === userKey);
      const myDecision = (r.ApprovalRequestDecisions || []).find((d) => Number(d.UserID) === userKey);
      if (opts.status === "pending") {
        const pendingLine = myLine && (myLine.Status === "asPending" || myLine.Status === "ardPending" || !myLine.Status);
        const pendingDecision = myDecision && (myDecision.Status === "ardPending" || myDecision.Status === "asWithoutDecision" || !myDecision.Status);
        if (!pendingLine && !pendingDecision) return false;
      } else if (!myLine && !myDecision) {
        return false;
      }
      stepByCode.set(Number(r.Code || 0), Number((myDecision?.ApprovalRequestStep ?? myLine?.ApprovalRequestStep) || 1));
      return true;
    });
    raw = raw.slice(opts.offset, opts.offset + opts.limit + 1);
  }
  const hasMoreLocal = userKey != null && raw.length > opts.limit;
  if (userKey != null) raw = raw.slice(0, opts.limit);

  const usersMap = userKey == null
    ? await fetchUsersMap(s, raw.flatMap(userIdsFromRequest))
    : new Map<number, string>();

  const drafts = await mapLimit(raw, 6, async (r) => {
    const draftEntry = Number(r.DraftEntry || 0);
    return draftEntry ? await fetchDraftBrief(s, draftEntry) : null;
  });


  const result: Array<Record<string, unknown>> = [];
  raw.forEach((r, idx) => {
    const draftEntry = Number(r.DraftEntry || 0);
    const draft = drafts[idx];
    // Documento cancelado/encerrado no SAP não é mais pendência de aprovação.
    if (opts.status === "pending" && draft && (draft.Cancelled === "tYES" || draft.DocumentStatus === "bost_Close")) return;
    const objCode = String(r.ObjectType || "");
    const pendingApprovers = userKey == null ? pendingApproversFromRequest(r, usersMap) : undefined;

    const uniq = (arr: Array<string | undefined | null>) =>
      Array.from(new Set(arr.map((v) => (v ?? "").toString().trim()).filter((v) => v.length > 0)));
    const lines = draft?.DocumentLines || [];
    const costCenters = uniq(lines.map((l) => l.CostingCode));
    const departments = uniq(lines.map((l) => l.CostingCode2));
    const projects = uniq([draft?.Project, ...lines.map((l) => l.ProjectCode)]);
    const installments = draft?.DocumentInstallments || [];
    const paymentDate = installments[0]?.DueDate || draft?.DocDueDate || "";

    result.push({
      approval_request_id: Number(r.Code || 0),
      step: stepByCode.get(Number(r.Code || 0)) ?? (pendingApprovers?.[0]?.step ?? 1),
      status: r.Status || "",
      status_label: REQUEST_STATUS_LABEL[r.Status || ""] || r.Status || "",
      doc_object_type: objCode,
      doc_type_name: OBJECT_CODE_TO_NAME[objCode] || `Documento (${objCode})`,
      doc_entry: draftEntry || Number(draft?.DocEntry || 0),
      doc_num: Number(draft?.DocNum || 0),
      doc_total: Number(draft?.DocTotal || 0),
      currency: draft?.DocCurrency || "BRL",
      card_code: draft?.CardCode || "",
      card_name: draft?.CardName || "",
      remarks: r.RemarksFromOriginator || draft?.Comments || "",
      creation_date: r.CreationDate || "",
      update_date: r.UpdateDate || "",
      due_date: draft?.DocDueDate || "",
      payment_date: paymentDate,
      doc_date: draft?.DocDate || "",
      tax_date: draft?.TaxDate || "",
      cost_center: costCenters[0] || "",
      cost_centers: costCenters,
      department: departments[0] || "",
      departments: departments,
      project: projects[0] || "",
      projects: projects,
      originator_id: r.OriginatorID || null,
      approver_user_code: userKey != null ? userCode : "",
      ...(pendingApprovers ? { pending_approvers: pendingApprovers } : {}),
    });
  });
  return { documents: result, hasMore: hasMoreServer || hasMoreLocal };
}

/**
 * Detalhe de uma solicitação: dados do documento + trilha completa de
 * aprovação (quem, etapa, status, data e observação) — o "parado com quem".
 */
async function getApprovalDetail(s: SapSession, approvalRequestId: number) {
  const r = (await sapGet(s, `ApprovalRequests(${approvalRequestId})`)) as SLApprovalRequest;
  if (!r || !r.Code) throw new Error(`Solicitação ${approvalRequestId} não encontrada`);

  const usersMap = await fetchUsersMap(s, userIdsFromRequest(r));
  const draftEntry = Number(r.DraftEntry || 0);
  const draft = draftEntry ? await fetchDraftBrief(s, draftEntry) : null;
  const objCode = String(r.ObjectType || "");

  const decisions = (r.ApprovalRequestDecisions || []).slice().sort(
    (a, b) => Number(a.ApprovalRequestStep || 0) - Number(b.ApprovalRequestStep || 0),
  );
  const trail = decisions.map((d) => ({
    step: Number(d.ApprovalRequestStep || 0),
    user_id: Number(d.UserID || 0),
    user_code: usersMap.get(Number(d.UserID || 0)) || "",
    status: d.Status || "",
    status_label: DECISION_STATUS_LABEL[d.Status || ""] || d.Status || "",
    decided_at: d.UpdateDate || "",
    created_at: d.CreateDate || "",
    remarks: d.Remarks || "",
  }));
  const stages = (r.ApprovalRequestLines || []).map((l) => ({
    step: Number(l.ApprovalRequestStep || 0),
    stage_code: l.StageCode ?? null,
    user_id: Number(l.UserID || 0),
    user_code: usersMap.get(Number(l.UserID || 0)) || "",
    status: l.Status || "",
    status_label: DECISION_STATUS_LABEL[l.Status || ""] || l.Status || "",
  }));
  const pendingApprovers = pendingApproversFromRequest(r, usersMap);

  return {
    approval_request_id: Number(r.Code || 0),
    status: r.Status || "",
    status_label: REQUEST_STATUS_LABEL[r.Status || ""] || r.Status || "",
    doc_object_type: objCode,
    doc_type_name: OBJECT_CODE_TO_NAME[objCode] || `Documento (${objCode})`,
    doc_entry: draftEntry || Number(draft?.DocEntry || 0),
    doc_num: Number(draft?.DocNum || 0),
    doc_total: Number(draft?.DocTotal || 0),
    currency: draft?.DocCurrency || "BRL",
    card_code: draft?.CardCode || "",
    card_name: draft?.CardName || "",
    remarks: r.RemarksFromOriginator || draft?.Comments || "",
    creation_date: r.CreationDate || "",
    update_date: r.UpdateDate || "",
    due_date: draft?.DocDueDate || "",
    doc_date: draft?.DocDate || "",
    originator_id: r.OriginatorID || null,
    originator_user_code: usersMap.get(Number(r.OriginatorID || 0)) || "",
    current_step: pendingApprovers[0]?.step ?? null,
    pending_approvers: pendingApprovers,
    approval_trail: trail,
    stages,
  };
}




async function decideApproval(
  s: SapSession,
  approvalRequestId: number,
  userKey: number,
  step: number,
  decision: "approve" | "reject",
  remarks: string,
) {
  const status = decision === "approve" ? "ardApproved" : "ardNotApproved";
  const req = (await sapGet(
    s,
    `ApprovalRequests(${approvalRequestId})?$select=Code,Status,ApprovalRequestDecisions`,
  )) as SLApprovalRequest;

  const decisions = req?.ApprovalRequestDecisions || [];
  const target = decisions.find(
    (d) =>
      Number(d.UserID) === userKey &&
      (!step || Number(d.ApprovalRequestStep) === Number(step)) &&
      (d.Status === "ardPending" || d.Status === "asWithoutDecision" || !d.Status),
  );
  if (!target) {
    throw new Error(
      `Nenhuma decisão pendente encontrada para usuário (UserID=${userKey}) no step ${step} da solicitação ${approvalRequestId}`,
    );
  }

  const updatedDecisions = decisions.map((d) =>
    d === target
      ? {
          ...d,
          Status: status,
          Remarks: remarks || d.Remarks || "",
        }
      : d,
  );

  await sapPatch(s, `ApprovalRequests(${approvalRequestId})`, {
    ApprovalRequestDecisions: updatedDecisions,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const keyCheck = await validateApiKey(sb(), req, "external-approvals-api", "EXTERNAL_APPROVALS_API_KEY");
    if (!keyCheck.valid) {
      return json(401, { error: keyCheck.reason || "API key inválida ou ausente" });
    }


    if (req.method !== "POST") return json(405, { error: "Use POST" });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json(400, { error: "JSON inválido" }); }

    const op = String(body.op || "").toLowerCase();
    const rawCompanyDB = String(body.company_db || "").trim();
    // Alias: nomes de schema SAP → slug interno do ERP Flow.
    // Mantém compatibilidade com sistemas externos que enviam o CompanyDB do SAP B1.
    const COMPANY_DB_ALIASES: Record<string, string> = {
      SBO_OPENGAMING: "open_gaming_sa",
      SBO_TST_OPENGAMING: "tst_open_gaming",
      TST_OPENGAMING: "tst_open_gaming",
      SBO_HOLDING_PRD: "cactus_providers",
      SBO_TST_HOLDING_PRD: "tst_cactus_providers",
      TST_HOLDING_PRD: "tst_cactus_providers",
      // ANA Gaming, Cactus Tecnologia e Instituto Cactus já usam o próprio
      // nome do schema SAP como slug interno (SBO_ANAGAMING, SBO_CACTUS,
      // SBO_INSTITUTO_ANA) — não precisam de alias.
    };
    const companyDB = COMPANY_DB_ALIASES[rawCompanyDB.toUpperCase()] || rawCompanyDB;
    const userCode = String(body.user_code || "").trim();

    if (!op || !["list", "detail", "approve", "reject"].includes(op)) {
      return json(400, { error: "op deve ser 'list', 'detail', 'approve' ou 'reject'" });
    }
    if (!companyDB) return json(400, { error: "company_db é obrigatório" });
    // user_code é opcional para op=list/detail (a API key já autoriza no nível da empresa).
    // approve/reject continuam exigindo user_code (a decisão é registrada em nome dele).
    if (!["list", "detail"].includes(op) && !userCode) {
      return json(400, { error: "user_code é obrigatório para approve/reject" });
    }

    // Paginação e filtros do op=list
    const statusParam = String(body.status || "pending").toLowerCase();
    if (!Object.keys(STATUS_FILTERS).includes(statusParam)) {
      return json(400, { error: `status inválido. Use: ${Object.keys(STATUS_FILTERS).join(", ")}` });
    }
    const docObjectType = String(body.doc_object_type ?? "").trim();
    if (docObjectType && !/^\d+$/.test(docObjectType)) {
      return json(400, { error: "doc_object_type deve ser numérico (ex.: '22')" });
    }
    const rawLimit = Number(body.limit ?? 50);
    const rawOffset = Number(body.offset ?? 0);
    if (!Number.isFinite(rawLimit) || rawLimit <= 0) return json(400, { error: "limit inválido" });
    if (!Number.isFinite(rawOffset) || rawOffset < 0) return json(400, { error: "offset inválido" });
    const limit = Math.min(Math.floor(rawLimit), 200);
    const offset = Math.floor(rawOffset);


    const admin = sb();

    // Rate limit: 30 chamadas/min por (company_db × user_code|* × IP).
    const rl = await enforceRateLimit(admin, {
      scope: `external-approvals-api:${op}`,
      identifier: `${companyDB}:${userCode || "*"}:${clientIpFrom(req)}`,
      max: 30,
      windowSeconds: 60,
    });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    // Allowlist: só faz sentido quando há user_code. Para list-all, a própria
    // API key já autoriza (chave é compartilhada só com sistemas de confiança).
    if (userCode) {
      const { data: accessRows, error: accessErr } = await admin.rpc("check_external_api_access", {
        _company_db: companyDB,
        _user_code: userCode,
      });
      if (accessErr) {
        console.error("check_external_api_access error:", accessErr);
        return json(500, { error: "Falha ao validar allowlist" });
      }
      const access = Array.isArray(accessRows) ? accessRows[0] : accessRows;
      if (!access?.allowed) {
        return json(403, { error: access?.reason || "Acesso negado" });
      }
    }

    const cfg = await getCompanyConfig(companyDB);

    return await withSession(companyDB, cfg, async (session) => {
      const userKey = userCode ? await getUserKey(session, userCode) : null;


      if (op === "list") {
        const { documents, hasMore } = await listApprovals(session, userKey, userCode, {
          status: statusParam,
          docObjectType,
          limit,
          offset,
        });
        if (userCode) {
          await admin.rpc("register_external_api_success", { _company_db: companyDB, _user_code: userCode });
        }
        return json(200, {
          company_db: companyDB,
          user_code: userCode || null,
          scope: userCode ? "user" : "company",
          status: statusParam,
          doc_object_type: docObjectType || null,
          limit,
          offset,
          has_more: hasMore,
          next_offset: hasMore ? offset + limit : null,
          count: documents.length,
          documents,
        });
      }

      const approvalRequestId = Number(body.approval_request_id);
      const step = Number(body.step || 0);
      const remarks = String(body.remarks || "");
      if (!Number.isFinite(approvalRequestId) || approvalRequestId <= 0) {
        return json(400, { error: "approval_request_id é obrigatório (número)" });
      }

      if (op === "detail") {
        const detail = await getApprovalDetail(session, approvalRequestId);
        if (userCode) {
          await admin.rpc("register_external_api_success", { _company_db: companyDB, _user_code: userCode });
        }
        return json(200, { company_db: companyDB, ...detail });
      }


      try {
        await decideApproval(session, approvalRequestId, userKey, step, op as "approve" | "reject", remarks);
      } catch (decideErr) {
        await admin.rpc("register_external_api_failure", {
          _company_db: companyDB,
          _user_code: userCode,
          _reason: decideErr instanceof Error ? decideErr.message : String(decideErr),
        });
        throw decideErr;
      }

      await admin.rpc("register_external_api_success", { _company_db: companyDB, _user_code: userCode });
      return json(200, {
        success: true,
        company_db: companyDB,
        user_code: userCode,
        approval_request_id: approvalRequestId,
        step,
        decision: op,
      });
    });

  } catch (e) {
    console.error("external-approvals-api error:", e);
    return json(500, { error: e instanceof Error ? e.message : "Erro interno" });
  }
});
