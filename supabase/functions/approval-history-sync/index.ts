import { backfillDocuments, reconcileDocumentMatches, readCompanyHistory, readDirectory, writeHistory } from "./document-backfill.ts";
import { enrichAudit, positiveInt, rawOf, reconcileDecisions, splitHanaPeople, uniqueHanaMatch, type HistoryRecord } from "./document-reconciliation.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAdminOrSapAdmin, requireAdminOrSapSession, requireUserOrSapSession, authErrorResponse } from "../_shared/auth.ts";
import { tryWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { fetchHanaView as fetchHanaViewV2, resolveHanaSchema } from "../_shared/hana-views.ts";
import { normalizeCompact } from "../_shared/text-normalize.ts";
import { readOptionalWebhook, finalSyncStatus } from "./webhook.ts";
import { auditCutoff, dedupeAuditDecisions, pendingAuditUpdates, writeAuditBatches, withRemoteTimeout, unchangedHanaRow, SAP_HANA_TIMEOUT_MS, type AuditDecision } from "./audit-batch.ts";
import { resolveIdentity, parseRange, listMyDecisions } from "./my-decisions.ts";
import { isSchedulerSecretRequest, isServiceRoleRequest, requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";

// HanaAPI V1 (middleware n8n) foi descontinuada — HANA queries usam V2 via fetchHanaViewV2.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
};

/**
 * approval-history-sync
 * --------------------------------------------------------------
 * Importa o histórico/fila de aprovações a partir de um webhook n8n
 * (Ana Gaming) para a tabela local public.approval_history.
 *
 * O webhook retorna um array com um único objeto { data: [...] }
 * em que cada item representa uma combinação aprovação × aprovador.
 *
 * Atualmente o payload traz apenas pedidos em aberto (sem decisão),
 * portanto decision é gravado como "P" (pending) por padrão.
 */

const WEBHOOK_URL =
  Deno.env.get("APPROVAL_HISTORY_WEBHOOK_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/496a9d2a-2ff0-4e7c-9d2e-755900bb040a";


const DOC_TYPE_TO_OBJECT: Record<string, string> = {
  "Pedido de Compra": "22",
  "Solicitação de Compra": "1470000113",
  "Nota Fiscal de Entrada": "18",
  "Pagamento Efetuado": "540000006",
  "Solicitação de Pagamento": "112",
  "Pedido de Venda": "17",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeCurrency(v: unknown): string | null {
  const s = (v == null ? "" : String(v)).trim();
  if (!s) return null;
  if (s === "R$" || /reais?/i.test(s)) return "BRL";
  if (s === "US$" || /^USD?$/i.test(s) || /d[oó]lar/i.test(s)) return "USD";
  if (s === "€" || /^EUR$/i.test(s) || /euro/i.test(s)) return "EUR";
  return s.toUpperCase().slice(0, 8);
}

interface WebhookRow {
  Empresa?: string;
  Code?: number;
  Aprovador?: string;
  "Email do aprovador"?: string;
  "Código da resposta do aprovador"?: string;
  "Resposta do aprovador"?: string;
  "Comentário do aprovador"?: string | null;
  "Data da resposta do aprovador"?: string | null;
  "Hora da resposta do aprovador"?: string | null;
  "Tipo de solicitação"?: string;
  "Draft DocEntry"?: number;
  "Nº do documento"?: number;
  Solicitante?: string;
  "Código PN/Fornecedor"?: string;
  "Fornecedor / Parceiro"?: string;
  "Código da moeda original"?: string;
  "Valor do documento na moeda original"?: number;
  "Valor total"?: number;
  "Data do documento"?: string;
  "Data de criação"?: string;
  "Data de vencimento"?: string;
  Observações?: string;
  "Modelo de aprovação"?: string;
}

// W = Waiting/Pending, Y = Approved, N = Rejected
function mapDecision(code: unknown): string {
  const s = (code == null ? "" : String(code)).trim().toUpperCase();
  if (s === "Y" || s === "A") return "Y";
  if (s === "N" || s === "R") return "N";
  return "P";
}

function combineDateTime(date?: string | null, time?: string | null): string | null {
  if (!date) return null;
  const baseIso = toIsoDate(date);
  if (!baseIso) return null;
  if (!time) return baseIso;
  let hh = 0, mm = 0, ss = 0;
  const t = String(time).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
    const parts = t.split(":").map((p) => parseInt(p, 10));
    hh = parts[0] || 0; mm = parts[1] || 0; ss = parts[2] || 0;
  } else if (/^\d{3,4}$/.test(t)) {
    const n = parseInt(t, 10);
    hh = Math.floor(n / 100); mm = n % 100;
  }
  const d = new Date(baseIso);
  d.setUTCHours(hh, mm, ss, 0);
  return d.toISOString();
}

function normalizeName(s: string): string {
  return normalizeCompact(s);
}

function resolveCompanyDb(
  empresa: string | undefined,
  lookup: Map<string, string>,
  fallback: string,
): string {
  if (!empresa) return fallback;
  const key = normalizeName(empresa);
  return lookup.get(key) || fallback;
}

function mapRow(r: WebhookRow, companyDb: string) {
  const code = r.Code != null ? String(r.Code) : "";
  const email = (r["Email do aprovador"] || "").toLowerCase().trim();
  const docType = r["Tipo de solicitação"] || null;
  const objectType = docType ? DOC_TYPE_TO_OBJECT[docType] || null : null;
  const total =
    toNumber(r["Valor total"]) ??
    toNumber(r["Valor do documento na moeda original"]);
  const decision = mapDecision(r["Código da resposta do aprovador"]);
  const decisionDate =
    decision === "P"
      ? null
      : combineDateTime(
          r["Data da resposta do aprovador"],
          r["Hora da resposta do aprovador"],
        );
  const comment = (r["Comentário do aprovador"] || "").trim() || null;
  const obs = (r.Observações || "").trim() || null;
  const remarks = [comment, obs].filter(Boolean).join("\n\n") || null;

  return {
    external_id: `${code}::${email || "unknown"}`,
    company_db: companyDb,
    decision,
    decision_date: decisionDate,
    approver_code: null,
    approver_name: r.Aprovador || null,
    approver_email: r["Email do aprovador"] || null,
    requester_code: null,
    requester_name: r.Solicitante || null,
    doc_object_type: objectType,
    doc_type_name: docType,
    doc_entry: toInt(r["Draft DocEntry"]),
    doc_num: toInt(r["Nº do documento"]),
    doc_total: total,
    currency: normalizeCurrency(r["Código da moeda original"]),
    card_code: r["Código PN/Fornecedor"] || null,
    card_name: r["Fornecedor / Parceiro"] || null,
    remarks,
    stage_name: r["Modelo de aprovação"] || null,
    step: null,
    raw: r as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

/* =========================================================================
 * HANA view VW_PEDIDOS_COMPRA_APROVACOES (Apiuser)
 * -------------------------------------------------------------------------
 * Fase adicional que loga como Apiuser em cada empresa SAP, consulta a
 * view VW_PEDIDOS_COMPRA_APROVACOES e mescla o resultado em approval_history.
 * Diferente do webhook n8n (que só traz pendentes), esta view retorna a
 * decisão final (Aprovado/Rejeitado) com data/hora — permitindo popular
 * decisões que aconteceram fora do ERP Flow (SAP puro).
 * =======================================================================*/

function normalizeSapBaseUrl(url: string): string {
  let u = url.replace(/\/+$/, "");
  if (u.includes("/b1s/v1")) u = u.replace("/b1s/v1", "/b1s/v2");
  else if (!u.includes("/b1s/v2")) u = `${u}/b1s/v2`;
  return u;
}

async function sapLoginServiceLayer(
  baseUrl: string,
  user: string,
  pass: string,
  db: string,
): Promise<{ sessionId: string; routeId: string }> {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: user, Password: pass, CompanyDB: db }),
    signal: AbortSignal.timeout(SAP_HANA_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Login SAP falhou: HTTP ${resp.status}`);
  const json = await resp.json();
  const cookies = resp.headers.get("set-cookie") || "";
  const routeMatch = cookies.match(/B1ROUTEID=([^;]+)/);
  return { sessionId: json.SessionId as string, routeId: routeMatch?.[1] ?? "" };
}

async function sapLogoutServiceLayer(
  baseUrl: string,
  s: { sessionId: string; routeId: string },
): Promise<void> {
  try {
    await fetch(`${baseUrl}/Logout`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}` },
    });
  } catch { /* ignore */ }
}

async function fetchHanaView(
  companyDb: string,
  database: string,
  sessionId: string,
  view: string,
  hanaApiUrl?: string | null,
): Promise<Record<string, unknown>[]> {
  return await fetchHanaViewV2({
    schema: resolveHanaSchema(companyDb, database),
    view,
    sessionId,
    hanaApiUrl,
    timeoutMs: SAP_HANA_TIMEOUT_MS,
  });
}

function pickField(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function combineDateHourFlexible(date: unknown, hour: unknown): string | null {
  if (!date) return null;
  const d = new Date(String(date));
  if (isNaN(d.getTime())) return null;
  let hh = 0, mm = 0, ss = 0;
  if (hour != null && hour !== "") {
    const s = String(hour).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      const parts = s.split(":").map((p) => parseInt(p, 10));
      hh = parts[0] || 0; mm = parts[1] || 0; ss = parts[2] || 0;
    } else {
      const n = Number(s);
      if (Number.isFinite(n)) {
        if (n >= 100) { hh = Math.floor(n / 100); mm = n % 100; }
        else { hh = Math.trunc(n); }
      }
    }
  }
  d.setUTCHours(hh, mm, ss, 0);
  return d.toISOString();
}

function normalizeHanaDecision(status: unknown): string {
  const s = String(status || "").trim();
  if (!s) return "P";
  if (/rejeit|reprov|negad/i.test(s)) return "N";
  if (/aprov/i.test(s) && !/pend|aguard/i.test(s)) return "Y";
  if (/pend|aguard/i.test(s)) return "P";
  return "P";
}

function mapHanaApprovalRow(raw: Record<string, unknown>, companyDb: string) {
  const docNum = toInt(pickField(raw, "Nº pedido de compra", "Num_Pedido_Compra", "numPedidoCompra", "DocNum"));
  const docEntry = toInt(pickField(raw, "Nº do Esboço", "Num_Esboco", "DraftDocEntry", "DocEntry"));
  const approverName = (pickField(raw, "Aprovador(es)", "Aprovadores", "Aprovador") as string) || null;
  const approverEmail = ((pickField(raw, "Email do aprovador", "Email_Aprovador", "emailAprovador") as string) || "").trim() || null;
  const decision = normalizeHanaDecision(pickField(raw, "Status da aprovação", "Status_Aprovacao", "statusAprovacao"));
  const decisionDate = decision === "P" ? null : combineDateHourFlexible(
    pickField(raw, "Data de aprovação", "Data_Aprovacao", "dataAprovacao"),
    pickField(raw, "Hora de aprovação", "Hora_Aprovacao", "horaAprovacao"),
  );
  const remarks = (pickField(raw, "Observações", "Observacoes", "observacoes") as string) || null;
  const cardCode = (pickField(raw, "Código do fornecedor", "Codigo_PN", "CardCode") as string) || null;
  const cardName = (pickField(raw, "Nome do fornecedor", "Nome_PN", "CardName") as string) || null;
  const solicitante = (pickField(raw, "FGR :: SOLICITANTE", "Solicitante") as string) || null;
  const total = toNumber(pickField(raw, "Total do documento", "Total_Documento", "DocTotal"));
  const currency = normalizeCurrency(pickField(raw, "Moeda", "Currency", "DocCur"));

  // Chave estável por (docEntry|docNum, aprovador). Prefixo "hana" evita
  // colisão com o formato do webhook n8n (`${Code}::${email}`).
  const docKey = docEntry != null ? `E${docEntry}` : docNum != null ? `N${docNum}` : "";
  const approverKey = (approverEmail || approverName || "").toLowerCase().trim();
  if (!docKey || !approverKey) return null;

  return {
    external_id: `hana::${docKey}::${approverKey}`,
    company_db: companyDb,
    decision,
    decision_date: decisionDate,
    approver_code: null,
    approver_name: approverName,
    approver_email: approverEmail,
    requester_code: null,
    requester_name: solicitante,
    doc_object_type: "22",
    doc_type_name: "Pedido de Compra",
    doc_entry: docEntry,
    doc_num: docNum,
    doc_total: total,
    currency,
    card_code: cardCode,
    card_name: cardName,
    remarks,
    stage_name: null,
    step: null,
    raw: { source: "hana_view", view: "VW_PEDIDOS_COMPRA_APROVACOES", ...raw } as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

async function fetchAndMergeHanaApprovals(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<{ merged: number; upserted: number; skipped?: string; error?: string }> {
  try {
    const { data: credRows } = await supabase
      .from("system_credentials_v")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb);
    const creds: Record<string, string> = {};
    for (const r of (credRows || []) as { credential_key: string; credential_value: string }[]) {
      creds[r.credential_key] = r.credential_value;
    }
    if (!creds.username || !creds.password || !creds.service_layer_url) {
      return { merged: 0, upserted: 0, skipped: "credenciais SAP incompletas" };
    }
    if (creds.use_hana_db === "false") {
      return { merged: 0, upserted: 0, skipped: "HANA desabilitado" };
    }
    // Segurança: só logar como Apiuser (evita bloquear contas reais).
    if ((creds.username || "").trim().toLowerCase() !== "apiuser") {
      return { merged: 0, upserted: 0, skipped: "usuário SAP não é Apiuser" };
    }

    const baseUrl = normalizeSapBaseUrl(creds.service_layer_url);
    const dbName = creds.company_db || companyDb;
    const session = await withRemoteTimeout(() => sapLoginServiceLayer(baseUrl, creds.username, creds.password, dbName), "Login SAP");

    let rows: Record<string, unknown>[] = [];
    try {
      rows = await withRemoteTimeout(() => fetchHanaView(companyDb, dbName, session.sessionId, "VW_PEDIDOS_COMPRA_APROVACOES", creds.hana_api_url), "Consulta HANA");
      console.log(`[approval-history-sync] phase=hana fetched rows=${rows.length}`);
    } finally {
      await sapLogoutServiceLayer(baseUrl, session);
    }

    const directory = await readDirectory(supabase);
    const mapped = new Map<string, HistoryRecord>();
    for (const r of rows) {
      const row = mapHanaApprovalRow(r, companyDb);
      if (!row) continue;
      for (const individual of splitHanaPeople(row, directory)) mapped.set(`${individual.company_db}::${individual.external_id}`, individual);
    }
    const payload = Array.from(mapped.values()).filter((r): r is NonNullable<typeof r> => !!r);

    // Regra de regressão: não sobrescrever Y/N existente com P.
    const existingByKey = new Map<string, Record<string, unknown>>();
    if (payload.length > 0) {
      // Long external-id IN URLs were rejected and silently read as empty.
      // Paginate the company instead and fail explicitly on read errors.
      for (let offset = 0; ; offset += 1000) {
        const { data: existing, error } = await supabase.from("approval_history")
          .select("*").eq("company_db", companyDb).order("id").range(offset, offset + 999);
        if (error) throw new Error(error.message);
        for (const e of (existing || []) as Array<{ company_db: string; external_id: string; decision: string | null; [key: string]: unknown }>) {
          existingByKey.set(`${e.company_db}::${e.external_id}`, e);
        }
        if ((existing || []).length < 1000) break;
      }
    }
    const canonical = reconcileDecisions([...Array.from(existingByKey.values()).filter(r => rawOf(r).source === "audit_log"), ...payload], directory);
    const canonicalKeys = new Set(canonical.map(r => String(r.external_id)));
    const safe = payload.map(p => canonicalKeys.has(String(p.external_id)) ? p : {
      ...p, raw: { ...rawOf(p), superseded_by: "audit_same_draft_approver" },
    }).filter((p) => {
      const prev = existingByKey.get(`${p.company_db}::${p.external_id}`);
      if ((prev?.decision === "Y" || prev?.decision === "N") && p.decision === "P") return false;
      return !prev || !unchangedHanaRow(prev, p);
    });

    let upserted = 0;
    const BATCH = 200;
    // Disjoint canonical keys: four bounded batches avoid serial HANA writes
    // exceeding the HTTP request budget without changing merge semantics.
    for (let i = 0; i < safe.length; i += BATCH * 4) {
      const results = await Promise.all(Array.from({ length: 4 }, async (_, slot) => {
        const slice = safe.slice(i + slot * BATCH, i + (slot + 1) * BATCH);
        if (!slice.length) return { count: 0, error: null };
        const { error } = await supabase.from("approval_history")
          .upsert(slice, { onConflict: "company_db,external_id" });
        return { count: error ? 0 : slice.length, error };
      }));
      const failed = results.find((result) => result.error);
      if (failed?.error) throw new Error(failed.error.message);
      upserted += results.reduce((sum, result) => sum + result.count, 0);
    }

    return { merged: rows.length, upserted };
  } catch (e) {
    return { merged: 0, upserted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}



async function lookupApprovalRequests(db: ReturnType<typeof createClient>, company: string, codes: number[]): Promise<Map<number, HistoryRecord>> {
  const { data, error } = await db.from("system_credentials_v").select("credential_key,credential_value")
    .eq("system_name", "sap").eq("company_db", company);
  if (error) throw new Error(error.message);
  const creds = Object.fromEntries((data || []).map(r => [r.credential_key, r.credential_value]));
  const found = new Map<number, HistoryRecord>();
  if (String(creds.username || "").toLowerCase() !== "apiuser" || !creds.password || !creds.service_layer_url) return found;
  const base = normalizeSapBaseUrl(creds.service_layer_url);
  let session: { sessionId: string; routeId: string };
  try { session = await withRemoteTimeout(() => sapLoginServiceLayer(base, creds.username, creds.password, creds.company_db || company), "Login SAP"); }
  catch { return found; }
  const deadline = Date.now() + 18000;
  try {
    for (let offset = 0; offset < codes.length && Date.now() < deadline; offset += 8) {
      await Promise.all(codes.slice(offset, offset + 8).map(async code => {
        try {
          const resp = await fetch(`${base}/ApprovalRequests(${code})`, { signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
            headers: { Cookie: `B1SESSION=${session.sessionId}${session.routeId ? `; B1ROUTEID=${session.routeId}` : ""}` } });
          if (!resp.ok) return;
          const request = await resp.json();
          const draftEntry = positiveInt(request.DraftEntry) ?? (String(request.IsDraft) === "tYES" ? positiveInt(request.ObjectEntry) : null);
          if (draftEntry) found.set(code, { draftEntry, objectType: request.ObjectType,
            finalDocEntry: String(request.IsDraft) === "tNO" ? positiveInt(request.ObjectEntry) : null });
        } catch { /* unique HANA match remains available; no credentials in output */ }
      }));
    }
  } finally { await sapLogoutServiceLayer(base, session); }
  return found;
}

async function updateSyncState(
  supabase: ReturnType<typeof createClient>,
  status: string,
  message: string,
  count: number,
  auditSuccessByCompany?: Record<string, string>,
) {
  const { error } = await supabase.from("approval_history_sync_state").upsert(
    {
      id: 1,
      ...(auditSuccessByCompany ? { audit_success_by_company: auditSuccessByCompany } : {}),
      last_sync_at: new Date().toISOString(),
      last_status: status,
      last_message: message,
      last_count: count,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`Sync state: ${error.message}`);
}

async function listApprovalHistory(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  caller: Awaited<ReturnType<typeof requireAdminOrSapSession>>,
  body: { companyDb?: string; decision?: string; limit?: number; from?: string; to?: string },
) {
  const companyDb = (body.companyDb || "").trim();
  if (!companyDb) return jsonResponse({ success: false, error: "companyDb é obrigatório" }, 400);

  const decision = body.decision === "Y" || body.decision === "N" ? body.decision : "all";
  const limit = Math.min(Math.max(Number(body.limit) || 51, 1), 500);

  let q = supabase
    .from("approval_history")
    .select("*")
    .eq("company_db", companyDb)
    .is("raw->>superseded_by", null)
    .order("decision_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (decision !== "all") q = q.eq("decision", decision);
  const range = parseRange(body.from, body.to);
  if (range.from) q = q.gte("decision_date", range.from);
  if (range.to) q = q.lte("decision_date", range.to);

  if (caller.source === "sap_session" || (caller as { source?: string }).source === "cloud_user") {
    let canReadAll = false;
    try {
      await requireAdminOrSapAdmin(req);
      canReadAll = true;
    } catch { /* usuário ERP comum: restringe ao próprio histórico */ }
    if (!canReadAll) {
      const c = caller as unknown as { email?: string; userName?: string; source?: string };
      const identity = await resolveIdentity(supabase, c.source === "sap_session" ? null : c.email || c.userName || null,
        c.source === "sap_session" ? c.userName || null : null);
      const { data: access } = c.source === "sap_session" ? { data: true } : await supabase.rpc("user_can_access_company", { _email: c.email || c.userName, _company_db: companyDb });
      if (access !== true) return jsonResponse({ success: false, error: "Sem acesso a esta empresa" }, 403);
      const result = await listMyDecisions(supabase, { identity, companies: [companyDb], ...range, decision });
      return jsonResponse({ success: true, rows: result.sapRows.slice(0, limit), syncState: null });
    }
  }

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const { data: syncState } = await supabase
    .from("approval_history_sync_state")
    .select("last_sync_at,last_status,last_message,last_count")
    .eq("id", 1)
    .maybeSingle();

  return jsonResponse({ success: true, rows: rows || [], syncState: syncState || null });
}

async function listMine(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  caller: Awaited<ReturnType<typeof requireAdminOrSapSession>>,
  body: { companyDb: string; decision?: string; from?: string; to?: string; allCompanies?: boolean },
) {
  const c = caller as unknown as { source?: string; email?: string | null; userName?: string; companyDB?: string };
  const isSap = c.source === "sap_session";
  const email = isSap ? null : (c.email || (c.userName?.includes("@") ? c.userName : null) || null);
  const sapUser = isSap ? (c.userName || null) : null;
  if (!email && !sapUser) return jsonResponse({ success: false, error: "Identidade não resolvida" }, 403);

  let isAdmin = false;
  try { await requireAdminOrSapAdmin(req); isAdmin = true; } catch { /* comum */ }

  let companies: string[];
  // Bases de teste nunca entram em "Minhas" (nem com "Todas as empresas").
  const { data: all } = await supabase.from("companies").select("company_db,is_test");
  const testDbs = new Set(((all || []) as Array<{ company_db: string; is_test: boolean | null }>).filter((r) => r.is_test).map((r) => r.company_db));
  if (isSap) {
    companies = [c.companyDB || body.companyDb].filter((db) => !testDbs.has(db));
  } else {
    const candidates = (body.allCompanies
      ? ((all || []) as Array<{ company_db: string }>).map((r) => r.company_db)
      : [body.companyDb]).filter((db) => !testDbs.has(db));
    if (isAdmin) companies = candidates;
    else {
      const checks = await Promise.all(candidates.map(async (db) => {
        const { data } = await supabase.rpc("user_can_access_company", { _email: email, _company_db: db });
        return data === true ? db : null;
      }));
      companies = checks.filter((x): x is string => !!x);
      if (!body.allCompanies && companies.length === 0) {
        return jsonResponse({ success: false, error: "Sem acesso a esta empresa" }, 403);
      }
    }
  }

  const identity = await resolveIdentity(supabase, email, sapUser);
  const range = parseRange(body.from, body.to);
  const decision = body.decision === "Y" || body.decision === "N" ? body.decision : "all";
  const result = await listMyDecisions(supabase, { identity, companies, ...range, decision });
  const { data: syncState } = await supabase.from("approval_history_sync_state")
    .select("last_sync_at,last_status,last_message,last_count").eq("id", 1).maybeSingle();
  return jsonResponse({ success: true, ...result, companies, syncState: syncState || null });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cloudUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!cloudUrl || !serviceKey) return jsonResponse({ success: false, error: "Configuração indisponível" }, 500);
  const supabase = createClient(cloudUrl, serviceKey, {
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });

  let lockAcquired = false;
  let syncStatus: "success" | "error" = "error";
  let syncMessage = "Sincronização interrompida";
  let syncCount = 0;
  let auditSuccessByCompany: Record<string, string> | undefined;
  let phase = "authorization";
  const runStartedAt = new Date().toISOString();
  try {
    let body: { companyDb?: string; action?: string; decision?: string; limit?: number; from?: string; to?: string; allCompanies?: boolean; cursor?: number; mode?: string } = {};
    try { body = await req.json(); } catch { /* no body */ }
    const isMine = body.action === "list_mine";
    const isList = body.action === "list" || isMine;

    // Leitura (action=list) é somente-leitura e já é escopada por usuário:
    // aceita qualquer usuário autenticado no Cloud, mesmo com a sessão SAP
    // expirada (30 min) — antes o histórico do SAP sumia da tela nesse caso.
    let caller: Awaited<ReturnType<typeof requireAdminOrSapSession>>;
    try {
      if (!isList && (isSchedulerSecretRequest(req) || isServiceRoleRequest(req))) {
        const scheduler = await requireSchedulerOrAdmin(req, corsHeaders);
        if (!scheduler.ok) return scheduler.response;
        caller = { source: "cloud_user", userName: "scheduler" } as typeof caller;
      } else {
        caller = isList
          ? (await requireUserOrSapSession(req)) as typeof caller
          : await requireAdminOrSapSession(req);
      }
    } catch (err) {
      const r = authErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }
    if (!(caller as { source?: string }).source) {
      const u = caller as unknown as { email?: string | null };
      caller = {
        ...(caller as object),
        source: "cloud_user",
        userName: u.email || "",
      } as typeof caller;
    }

    const companyDb = (body.companyDb || req.headers.get("x-company-db") || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(companyDb)) {
      return jsonResponse({ success: false, error: "companyDb é obrigatório" }, 400);
    }
    if (caller.source === "sap_session" && caller.companyDB !== companyDb) {
      return jsonResponse({ success: false, error: "Empresa inválida para a sessão atual" }, 403);
    }
    if (isMine) {
      return await listMine(supabase, req, caller, { ...body, companyDb });
    }
    if (isList) {
      return await listApprovalHistory(supabase, req, caller, { ...body, companyDb });
    }


    if (body.action === "backfill_documents") {
      if (!["SBO_ANAGAMING", "SBO_CACTUS", "SBO_INSTITUTO_ANA", "open_gaming_sa"].includes(companyDb)) {
        return jsonResponse({ success: false, error: "Empresa fora do escopo autorizado" }, 400);
      }
      if (!(isSchedulerSecretRequest(req) || isServiceRoleRequest(req))) await requireAdminOrSapAdmin(req);
      const cursor = Number(body.cursor ?? 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0) return jsonResponse({ success: false, error: "Cursor inválido" }, 400);
      lockAcquired = await tryWatcherLock(supabase, "approval-history-sync", 3);
      if (!lockAcquired) return jsonResponse({ success: false, skipped: "another_run_in_progress" }, 409);
      phase = "backfill_documents";
      const result = body.mode === "document_match"
        ? { ...(await reconcileDocumentMatches(supabase, companyDb)), corrected: 0, done: true }
        : await backfillDocuments(supabase, companyDb, cursor, codes => lookupApprovalRequests(supabase, companyDb, codes));
      syncStatus = "success";
      syncCount = result.corrected;
      syncMessage = `Correção de documentos: ${JSON.stringify(result)}`;
      return jsonResponse({ success: true, ...result });
    }

    // Lock anti-execução-paralela
    lockAcquired = await tryWatcherLock(supabase, "approval-history-sync", 3);
    if (!lockAcquired) {
      return jsonResponse({ success: true, skipped: "another_run_in_progress", summary: "Sincronização já em andamento", received: 0, upserted: 0 });
    }

    phase = "webhook";
    console.log(`[approval-history-sync] phase=${phase} started company=${companyDb}`);
    const { rows, warning: webhookWarning } = await readOptionalWebhook<WebhookRow>(WEBHOOK_URL);

    // Mapa empresa (display_name normalizado) -> company_db
    const { data: companiesData } = await supabase
      .from("companies")
      .select("company_db,display_name");
    const companyLookup = new Map<string, string>();
    for (const c of (companiesData || []) as Array<{ company_db: string; display_name: string }>) {
      companyLookup.set(normalizeName(c.display_name), c.company_db);
      companyLookup.set(normalizeName(c.company_db), c.company_db);
    }

    // Deduplica por (company_db, external_id), filtrando teste e linhas sem empresa
    const mapped = new Map<string, ReturnType<typeof mapRow>>();
    let skippedTest = 0;
    let skippedUnknownCompany = 0;
    for (const r of rows) {
      // Detecta linhas sem campo Empresa reconhecível: vão para quarentena (não usa fallback silencioso)
      const rawEmpresa = (r.Empresa || "").trim();
      const resolved = resolveCompanyDb(rawEmpresa, companyLookup, "");
      if (!resolved) {
        skippedUnknownCompany++;
        console.warn(`[approval-history-sync] linha sem Empresa reconhecível (Code=${r.Code}): "${rawEmpresa}" — ignorada`);
        continue;
      }
      if (isTestCompanyDb(resolved)) {
        skippedTest++;
        continue;
      }
      const row = mapRow(r, resolved);
      if (row.external_id.startsWith("::")) continue;
      mapped.set(`${row.company_db}::${row.external_id}`, row);
    }
    const payload = Array.from(mapped.values());

    // Máquina de estado: NÃO sobrescrever decisão final (Y/N) com pendente (P).
    // Pré-carrega decisões atuais e filtra do payload os updates que regrediram.
    const externalIds = payload.map((p) => p.external_id);
    const existingByKey = new Map<string, string>();
    if (externalIds.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < externalIds.length; i += CHUNK) {
        const ids = externalIds.slice(i, i + CHUNK);
        const { data: existing } = await supabase
          .from("approval_history")
          .select("company_db,external_id,decision")
          .in("external_id", ids);
        for (const e of (existing || []) as Array<{ company_db: string; external_id: string; decision: string | null }>) {
          existingByKey.set(`${e.company_db}::${e.external_id}`, e.decision || "");
        }
      }
    }
    let skippedRegression = 0;
    const safePayload = payload.filter((p) => {
      const prev = existingByKey.get(`${p.company_db}::${p.external_id}`);
      if ((prev === "Y" || prev === "N") && p.decision === "P") {
        skippedRegression++;
        console.warn(`[approval-history-sync] decisão final (${prev}) preservada em ${p.company_db}::${p.external_id} — pendente ignorado`);
        return false;
      }
      return true;
    });

    // Upsert em lotes
    const BATCH = 200;
    let upserted = 0;
    for (let i = 0; i < safePayload.length; i += BATCH) {
      const slice = safePayload.slice(i, i + BATCH);
      const { error } = await supabase
        .from("approval_history")
        .upsert(slice, { onConflict: "company_db,external_id" });
      if (error) throw new Error(error.message);
      upserted += slice.length;
    }

    // Read pending history once, plan in memory, persist in batches of 200.
    phase = "audit";
    console.log(`[approval-history-sync] phase=${phase} started company=${companyDb}`);
    let auditMerged = 0;
    let auditInserted = 0;
    let auditError: string | undefined;
    try {
      const { data: priorState, error: priorError } = await supabase
        .from("approval_history_sync_state").select("audit_success_by_company").eq("id", 1).maybeSingle();
      if (priorError) throw new Error(priorError.message);
      const watermarks = (priorState?.audit_success_by_company || {}) as Record<string, string>;
      const cutoff = auditCutoff(Date.parse(runStartedAt), watermarks[companyDb]);
      const auditRows: AuditDecision[] = [];
      for (let offset = 0; offset < 5000; offset += 1000) {
        const { data, error } = await supabase.from("audit_log")
          .select("action, entity_id, actor_email, created_at, details, company_db")
          .eq("entity_type", "approval_request").in("action", ["approve", "reject"])
          .eq("company_db", companyDb).gte("created_at", cutoff).lte("created_at", runStartedAt)
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .range(offset, offset + 999);
        if (error) throw new Error(error.message);
        auditRows.push(...(data || []) as AuditDecision[]);
        if ((data || []).length < 1000) break;
        if (offset === 4000) throw new Error("Mais de 5000 decisões: checkpoint preservado para evitar perda");
      }
      const decisions = dedupeAuditDecisions(auditRows);
      type PendingHistory = { id: string; external_id: string; company_db: string; decision: string | null; [key: string]: unknown };
      const pendingRows: PendingHistory[] = [];
      if (decisions.length) {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase.from("approval_history").select("*")
            .eq("company_db", companyDb).eq("decision", "P").order("id").range(offset, offset + 999);
          if (error) throw new Error(error.message);
          pendingRows.push(...(data || []) as PendingHistory[]);
          if ((data || []).length < 1000) break;
        }
      }
      const updates = pendingAuditUpdates(pendingRows, decisions, runStartedAt);
      const persisted = await readCompanyHistory(supabase, companyDb);
      const hanaHistory = persisted.filter(r => rawOf(r).source === "hana_view" && !rawOf(r).superseded_by);
      const persistedByKey = new Map(persisted.map(r => [String(r.external_id), r]));
      const canonicalRows = decisions.map((a) => {
        const code = String(a.entity_id);
        const actorEmail = String(a.actor_email).toLowerCase();
        const decision = a.action === "approve" ? "Y" : "N";
        const details = a.details || {};

        // (b) Upsert linha canônica chaveada pelo ator.
        const docNum = toInt(details.docNum);
        const docType = (details.docType as string) || null;
        const objectType = String(details.objectType || (docType ? DOC_TYPE_TO_OBJECT[docType] || "22" : "22"));
        const remarksParts = [
          (details.remarks as string) || null,
          details.actedAsSubstitute
            ? `Ação executada por SUBSTITUTO (${actorEmail}) em nome de ${details.substitutedForName || ""}${details.substitutedForEmail ? ` <${details.substitutedForEmail}>` : ""}.`
            : null,
          details.actingRole === "delegation"
            ? `Ação executada por DELEGAÇÃO (${actorEmail}).`
            : null,
        ].filter(Boolean);
        const row = {
          external_id: `${code}::${actorEmail}`,
          company_db: companyDb,
          decision,
          decision_date: a.created_at,
          approver_code: null,
          approver_name: (details.approver as string) || null,
          approver_email: actorEmail,
          requester_code: null,
          requester_name: null,
          doc_object_type: objectType,
          doc_type_name: docType,
          doc_entry: null,
          doc_num: docNum,
          doc_total: toNumber(details.docTotal),
          currency: normalizeCurrency(details.currency),
          card_code: null,
          card_name: (details.cardName as string) || null,
          remarks: remarksParts.join("\n\n") || null,
          stage_name: null,
          step: null,
          raw: { source: "audit_log", ...details } as unknown as Record<string, unknown>,
          synced_at: new Date().toISOString(),
        };
        const prior = persistedByKey.get(row.external_id);
        const base = { ...row, raw: { ...rawOf(prior || {}), ...details, source: "audit_log" } };
        return enrichAudit(base, uniqueHanaMatch(base, hanaHistory), null);
      });
      const write = async (batch: Record<string, unknown>[]) => {
        const { error } = await supabase.from("approval_history").upsert(batch, { onConflict: "company_db,external_id" });
        if (error) throw new Error(error.message);
      };
      auditMerged = await writeAuditBatches(updates, write);
      auditInserted = await writeAuditBatches(canonicalRows, write);
      auditSuccessByCompany = { ...watermarks, [companyDb]: runStartedAt };
      console.log(`[approval-history-sync] phase=audit finished decisions=${decisions.length} merged=${auditMerged} upserted=${auditInserted} cutoff=${cutoff}`);
    } catch (e) {
      auditError = e instanceof Error ? e.message : String(e);
      console.warn(`[approval-history-sync] merge audit_log falhou: ${String(e)}`);
    }

    // ================================================================
    // Fase extra: HANA view VW_PEDIDOS_COMPRA_APROVACOES (Apiuser)
    // Ignora empresas de teste; traz decisões finais (Y/N) do SAP puro.
    // ================================================================
    phase = "hana";
    console.log(`[approval-history-sync] phase=${phase} started company=${companyDb}`);
    let hanaResult: { merged: number; upserted: number; skipped?: string; error?: string } = { merged: 0, upserted: 0 };
    if (!isTestCompanyDb(companyDb)) {
      hanaResult = await fetchAndMergeHanaApprovals(supabase, companyDb);
      if (hanaResult.error) console.warn(`[approval-history-sync] HANA view falhou: ${hanaResult.error}`);
      if (hanaResult.skipped) console.log(`[approval-history-sync] HANA view skipped: ${hanaResult.skipped}`);
    }

    const totalWritten = upserted + auditMerged + auditInserted + hanaResult.upserted;
    const summary = `Sincronizados ${totalWritten} (teste:${skippedTest}, sem-empresa:${skippedUnknownCompany}, regressões:${skippedRegression}, audit-merge:${auditMerged}, audit-upsert:${auditInserted}, hana-merge:${hanaResult.merged}, hana-upsert:${hanaResult.upserted}${hanaResult.skipped ? `, hana-skipped:${hanaResult.skipped}` : ""}${hanaResult.error ? `, hana-error:${hanaResult.error}` : ""})`;
    const finalSummary = [summary, webhookWarning, auditError ? `audit-error:${auditError}` : undefined].filter(Boolean).join("; ");
    const status = finalSyncStatus(auditError, hanaResult.error);
    syncStatus = status;
    syncMessage = finalSummary;
    syncCount = totalWritten;
    console.log(`[approval-history-sync] phase=complete status=${status} count=${syncCount}`);

    return jsonResponse({
      success: status === "success",
      summary: finalSummary,
      webhook: { warning: webhookWarning || null },
      received: rows.length,
      upserted: syncCount,
      webhookUpserted: upserted,
      audit: { merged: auditMerged, upserted: auditInserted, error: auditError },
      hana: hanaResult,
      skipped: { test: skippedTest, unknown_company: skippedUnknownCompany, regression: skippedRegression },
      companyDb,
    });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    syncMessage = `phase=${phase}: ${message}`;
    console.warn(`[approval-history-sync] ${syncMessage}`);
    return jsonResponse({ success: false, error: syncMessage }, 500);
  } finally {
    // Never overwrite the running owner's state when auth/list/lock contention exits.
    if (lockAcquired) {
      try {
        await updateSyncState(supabase, syncStatus, syncMessage, syncCount, auditSuccessByCompany);
      } catch (error) {
        syncStatus = "error";
        syncMessage = `Falha ao persistir sync state: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[approval-history-sync] ${syncMessage}`);
        await updateSyncState(supabase, "error", syncMessage, syncCount, auditSuccessByCompany).catch(() => {});
      } finally {
        const { error } = await supabase.rpc("release_watcher_lock", {
          _name: "approval-history-sync", _status: syncStatus === "error" ? "error" : "ok", _message: syncMessage,
        });
        if (error) {
          console.warn(`[approval-history-sync] lock release failed: ${error.message}`);
          await supabase.rpc("release_watcher_lock", {
            _name: "approval-history-sync", _status: "error", _message: syncMessage,
          });
        }
      }
    }
  }
});
// schema fix: SBO_OPENGAMING 1784592109
