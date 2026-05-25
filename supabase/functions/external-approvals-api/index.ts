// External Approvals API
// REST endpoints for an external system to list / approve / reject SAP B1 approval requests.
//
// Auth: header `X-API-Key: <EXTERNAL_APPROVALS_API_KEY>`
// Routes (POST /functions/v1/external-approvals-api):
//   { "op": "list",    "company_db": "...", "user_code": "..." }
//   { "op": "approve", "company_db": "...", "user_code": "...", "approval_request_id": 123, "step": 1, "remarks": "ok" }
//   { "op": "reject",  "company_db": "...", "user_code": "...", "approval_request_id": 123, "step": 1, "remarks": "no" }
//
// Notes:
// - `user_code` is the SAP UserCode (same identifier used in SAP B1 for both requester and approver).
// - `company_db` is the SAP CompanyDB / tenant identifier.
// - The function uses the admin credentials stored in `system_credentials` per company
//   to authenticate against SAP B1 Service Layer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
interface SLDraft {
  DocEntry?: number;
  DocNum?: number;
  DocTotal?: number;
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

async function sapLogin(cfg: { baseUrl: string; username: string; password: string; sapCompanyDb: string }): Promise<SapSession> {
  const resp = await fetch(`${cfg.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: cfg.username, Password: cfg.password, CompanyDB: cfg.sapCompanyDb }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Falha no login SAP (${resp.status}): ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const setCookie = resp.headers.get("set-cookie") || "";
  const sId = setCookie.match(/B1SESSION=([^;]+)/)?.[1] || data.SessionId;
  const rId = setCookie.match(/ROUTEID=([^;]+)/)?.[1] || "";
  return { sessionId: sId, routeId: rId, baseUrl: cfg.baseUrl };
}

async function sapLogout(s: SapSession) {
  const cookies = `B1SESSION=${s.sessionId}${s.routeId ? `; ROUTEID=${s.routeId}` : ""}`;
  await fetch(`${s.baseUrl}/Logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
  }).catch(() => {});
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
      `Drafts(${draftEntry})?$select=DocEntry,DocNum,DocTotal,DocCurrency,CardCode,CardName,DocDate,Comments`,
    )) as SLDraft;
  } catch {
    return null;
  }
}

async function listPendingForUser(s: SapSession, userKey: number, userCode: string) {
  const data = (await sapGet(
    s,
    `ApprovalRequests?$filter=Status eq 'arsPending'&$orderby=CreationDate desc&$top=200`,
  )) as { value?: SLApprovalRequest[] };
  const raw = data?.value || [];

  const result: Array<Record<string, unknown>> = [];
  for (const r of raw) {
    const myLine = (r.ApprovalRequestLines || []).find(
      (l) => Number(l.UserID) === userKey && (l.Status === "asPending" || l.Status === "ardPending" || !l.Status),
    );
    const myPendingDecision = (r.ApprovalRequestDecisions || []).find(
      (d) => Number(d.UserID) === userKey && (d.Status === "ardPending" || d.Status === "asWithoutDecision" || !d.Status),
    );
    if (!myLine && !myPendingDecision) continue;

    const draft = r.DraftEntry ? await fetchDraftBrief(s, Number(r.DraftEntry)) : null;
    const objCode = String(r.ObjectType || "");
    result.push({
      approval_request_id: Number(r.Code || 0),
      step: Number((myPendingDecision?.ApprovalRequestStep ?? myLine?.ApprovalRequestStep) || 1),
      doc_object_type: objCode,
      doc_type_name: OBJECT_CODE_TO_NAME[objCode] || `Documento (${objCode})`,
      doc_entry: Number(r.DraftEntry || draft?.DocEntry || 0),
      doc_num: Number(draft?.DocNum || 0),
      doc_total: Number(draft?.DocTotal || 0),
      currency: draft?.DocCurrency || "BRL",
      card_code: draft?.CardCode || "",
      card_name: draft?.CardName || "",
      remarks: r.RemarksFromOriginator || draft?.Comments || "",
      creation_date: r.CreationDate || "",
      update_date: r.UpdateDate || "",
      originator_id: r.OriginatorID || null,
      approver_user_code: userCode,
    });
  }
  return result;
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
    const expected = Deno.env.get("EXTERNAL_APPROVALS_API_KEY");
    if (!expected) return json(500, { error: "EXTERNAL_APPROVALS_API_KEY não configurada no servidor" });
    const provided =
      req.headers.get("x-api-key") ||
      (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!provided || provided !== expected) {
      return json(401, { error: "API key inválida ou ausente" });
    }

    if (req.method !== "POST") return json(405, { error: "Use POST" });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json(400, { error: "JSON inválido" }); }

    const op = String(body.op || "").toLowerCase();
    const companyDB = String(body.company_db || "").trim();
    const userCode = String(body.user_code || "").trim();

    if (!op || !["list", "approve", "reject"].includes(op)) {
      return json(400, { error: "op deve ser 'list', 'approve' ou 'reject'" });
    }
    if (!companyDB) return json(400, { error: "company_db é obrigatório" });
    if (!userCode) return json(400, { error: "user_code é obrigatório" });

    const cfg = await getCompanyConfig(companyDB);
    const session = await sapLogin(cfg);

    try {
      const userKey = await getUserKey(session, userCode);

      if (op === "list") {
        const docs = await listPendingForUser(session, userKey, userCode);
        return json(200, { company_db: companyDB, user_code: userCode, count: docs.length, documents: docs });
      }

      const approvalRequestId = Number(body.approval_request_id);
      const step = Number(body.step || 0);
      const remarks = String(body.remarks || "");
      if (!Number.isFinite(approvalRequestId) || approvalRequestId <= 0) {
        return json(400, { error: "approval_request_id é obrigatório (número)" });
      }

      await decideApproval(session, approvalRequestId, userKey, step, op as "approve" | "reject", remarks);
      return json(200, {
        success: true,
        company_db: companyDB,
        user_code: userCode,
        approval_request_id: approvalRequestId,
        step,
        decision: op,
      });
    } finally {
      await sapLogout(session);
    }
  } catch (e) {
    console.error("external-approvals-api error:", e);
    return json(500, { error: e instanceof Error ? e.message : "Erro interno" });
  }
});
