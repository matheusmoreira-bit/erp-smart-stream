// Edge function: all write operations on internal expenses.
//
// Consolidates create / update / submit / cancel / attachments / log so that
// public.expenses, public.expense_items, public.expense_attachments and
// public.expense_approval_log can have their anon+authenticated write
// policies removed. Every mutation is authorized here against the caller's
// SAP session (or Cloud admin JWT).
//
// Actions (POST body { action, ... }):
//   - create             { input }               → inserts expense + items + logs
//   - update             { expense_id, input }   → owner/admin updates fields + items
//   - submit             { expense_id }          → owner/admin marks pendente_aprovacao
//   - cancel             { expense_id }          → owner/admin marks cancelado
//   - reactivate         { expense_id }          → author/admin: cancelado → rascunho
//   - attachments_add    { expense_id, attachments[] } → after client uploads to storage
//   - log_decision       { expense_id, decision, remarks?, levelOrder? }
//
// approve / reject stay in expense-approval-action (they have their own
// approver-designation logic).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateSapSession, requireUser, AuthError } from "../_shared/auth.ts";
import { pickApproverSkippingRequester, SELF_APPROVAL_FALLBACK } from "../_shared/approval-skip.ts";
import { resolveApproverWithEscalation } from "../_shared/approval-escalate.ts";
import { MATRIX_FALLBACK_APPROVER, notifyMatrixGap } from "../_shared/matrix-fallback.ts";
import { notifyApprovalPending } from "../_shared/approval-notify.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { findMatchingRule, pickHierarchicalFallbackRule, type RuleRow } from "../_shared/rule-match.ts";
import { applyCcRedirect, loadCcRedirects } from "../_shared/cc-redirect.ts";
import { buildSapBaseUrl, loadSapCreds, sapCookieLogin, sapLogout } from "../_shared/sap-cache.ts";
import { sapFetch } from "../_shared/sap-fetch.ts";
// (buildRateioChain foi substituído por fluxos independentes por segmento)
import {
  buildRateioSegments,
  buildReembolsoSegments,
  persistRateioSegments,
  type RateioSegment,
} from "../_shared/rateio-segments.ts";
import { classifyExpenseEdit, normalizeExpenseItems } from "../_shared/expense-items.ts";
import { isPagCorpExpense } from "../_shared/pagcorp-expense.ts";
import { isNativeErpExpenseOrigin } from "../_shared/expense-origin.ts";



const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

const FUNCTION_VERSION = "2026-08-25.2";

/**
 * Reavalia a matriz de aprovação para um documento que está sem `approval_rule_id`.
 * Usa o CC do cabeçalho e, quando vazio, os CCs dos itens (caso de rateio/reembolso,
 * em que o CC só existe nas linhas). Só cai no fallback global quando nem a regra
 * exata nem a alçada do ramo do CC existem.
 */
async function rematchRuleFromMatrix(
  admin: SupabaseClient,
  ctx: {
    companyDb: string;
    docType: string;
    totalAmount: number;
    costCenter: string;
    project: string;
    currency: string | null;
    requesterName: string | null;
    supplierName: string | null;
    supplierCode: string | null;
    expenseId: string;
    rateioType?: string | null;
    items?: Array<{ cost_center?: string | null }> | null;
  },
): Promise<string | null> {
  if (!ctx.companyDb) return null;

  let itemCcs: string[] = (ctx.items || [])
    .map((it) => String(it?.cost_center || "").trim())
    .filter(Boolean);
  if (itemCcs.length === 0) {
    const { data } = await admin
      .from("expense_items")
      .select("cost_center")
      .eq("expense_id", ctx.expenseId);
    itemCcs = ((data || []) as Array<{ cost_center: string | null }>)
      .map((it) => String(it.cost_center || "").trim())
      .filter(Boolean);
  }
  const candidateCcs = Array.from(new Set(ctx.costCenter ? [ctx.costCenter] : itemCcs));
  // Regras globais (inclusive aprovação automática) não dependem de CC.
  if (candidateCcs.length === 0) candidateCcs.push("");

  const { data: rulesRaw } = await admin
    .from("approval_rules")
    .select("*")
    .eq("company_db", ctx.companyDb)
    .eq("is_active", true);
  const rules = (rulesRaw || []) as unknown as RuleRow[];
  if (rules.length === 0) return null;

  const buildCtx = (cc: string) => ({
    total_amount: ctx.totalAmount,
    cost_center: cc,
    project: ctx.project,
    requester_name: ctx.requesterName || "",
    supplier_name: `${ctx.supplierName || ""} ${ctx.supplierCode || ""}`.trim(),
    "supplier.name": String(ctx.supplierName || "").toLowerCase(),
    "supplier.code": String(ctx.supplierCode || "").toLowerCase(),
    currency: ctx.currency || "BRL",
    doc_type: ctx.docType,
    rateio_type: String(ctx.rateioType || "padrao").toLowerCase(),
  });

  for (const cc of candidateCcs) {
    const match = findMatchingRule(rules, buildCtx(cc), ctx.docType);
    if (match) return match.id;
  }
  for (const cc of candidateCcs) {
    const hier = pickHierarchicalFallbackRule(rules, buildCtx(cc), ctx.docType);
    if (hier) return hier.rule.id;
  }
  return null;
}

async function isAutomaticApprovalRule(
  admin: SupabaseClient,
  ruleId: string | null | undefined,
): Promise<boolean> {
  if (!ruleId) return false;
  const { data, error } = await admin
    .from("approval_rules")
    .select("auto_approve")
    .eq("id", ruleId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Falha ao verificar aprovação automática: ${error.message}`);
  return data?.auto_approve === true;
}


function json(status: number, body: unknown) {
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), function_version: FUNCTION_VERSION }
    : body;
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Function-Version": FUNCTION_VERSION,
    },
  });
}

function withoutUnsupportedExpenseColumns(updates: Record<string, unknown>) {
  const safeUpdates = { ...updates };
  // Compatibilidade com bases cujo schema ainda não possui os campos de revisão.
  // A revisão continua registrada no log/auditoria, sem bloquear a edição.
  delete safeUpdates.revision_number;
  delete safeUpdates.revision_note;
  delete safeUpdates.payment_method;
  delete safeUpdates.payment_boleto_barcode;
  delete safeUpdates.payment_boleto_digitable_line;
  delete safeUpdates.payment_metadata;
  return safeUpdates;
}

function isMissingColumnError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /schema cache|Could not find the .* column|column .* does not exist/i.test(text);
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function boletoBarcodeFrom(value: unknown): string {
  const clean = digits(value);
  if (clean.length === 44) return clean;
  if (clean.length === 47) {
    return `${clean.slice(0, 4)}${clean.slice(32, 33)}${clean.slice(33, 47)}${clean.slice(4, 9)}${clean.slice(10, 20)}${clean.slice(21, 31)}`;
  }
  if (clean.length === 48) {
    return `${clean.slice(0, 11)}${clean.slice(12, 23)}${clean.slice(24, 35)}${clean.slice(36, 47)}`;
  }
  return clean;
}

async function updateExpenseWithItems(
  admin: SupabaseClient,
  expenseId: string,
  updates: Record<string, unknown>,
  items: any[],
): Promise<string | null> {
  // Não depender da RPC `update_expense_with_items`: em produção ela pode ainda
  // não existir no schema cache, bloqueando edições simples como vencimento.
  if (!Array.isArray(items) || items.length === 0) {
    return "O pedido precisa ter ao menos um item";
  }

  const { error: upErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
  if (upErr) return upErr.message;

  const { error: delErr } = await admin.from("expense_items").delete().eq("expense_id", expenseId);
  if (delErr) return delErr.message;

  const rows = items.map((it) => ({
    expense_id: expenseId,
    item_code: it.item_code || null,
    description: String(it.description || "").trim(),
    quantity: Number(it.quantity || 0),
    unit_price: Number(it.unit_price || 0),
    line_total: Number(it.line_total || 0),
    cost_center: it.cost_center || null,
    project: it.project || null,
    items_group_code: it.items_group_code ?? null,
    items_group_name: it.items_group_name ?? null,
    free_of_charge: it.free_of_charge === true,
  }));
  const { error: insErr } = await admin.from("expense_items").insert(rows as any);
  return insErr?.message || null;
}

function runAfterResponse(task: Promise<unknown>) {
  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else void task;
}

async function dispatchApprovedExpense(
  expenseId: string,
  docType: string,
  origin: string | null | undefined,
  patchDocument = false,
) {
  if (docType === "sales" || isNativeErpExpenseOrigin(origin)) return;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!serviceKey || !supabaseUrl) return;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/expense-to-sap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "x-internal-retry": "1",
      },
      body: JSON.stringify({
        expense_id: expenseId,
        patch_document: patchDocument,
        use_service_account: true,
      }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      console.warn("[expense-mutation] dispatch após aprovação automática falhou", {
        expenseId,
        status: response.status,
        error: result?.error || `HTTP ${response.status}`,
      });
    }
  } catch (error) {
    console.warn("[expense-mutation] dispatch após aprovação automática falhou", {
      expenseId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalize(s: unknown): string {
  return String(s ?? "").toLowerCase().trim();
}

function emailPrefix(v: string): string {
  const s = normalize(v);
  const i = s.indexOf("@");
  return i > 0 ? s.slice(0, i) : s;
}

/** Owner identity check — caller must match the expense's requester/creator. */
function isOwner(caller: string, expense: Record<string, unknown>): boolean {
  const c = normalize(caller);
  if (!c) return false;
  const cp = emailPrefix(c);
  const candidates = [
    expense.requester_email,
    expense.requester_name,
    expense.created_by_email,
  ].map((x) => normalize(x));
  return candidates.some((v) => v && (v === c || emailPrefix(v) === cp));
}

interface Caller {
  identity: string | null;      // for owner comparison (SAP userName or email)
  email: string | null;         // for logging
  isCloudAdmin: boolean;
  isSuperUser: boolean;
  companyDB: string | null;     // from SAP session, if any
}

async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  let identity: string | null = null;
  let email: string | null = null;
  let isCloudAdmin = false;
  let isSuperUser = false;
  let companyDB: string | null = null;

  // Try Cloud JWT first (admins).
  try {
    const u = await requireUser(req);
    email = u.email || null;
    identity = u.email || null;
    const { data } = await admin.rpc("has_role", { _user_id: u.id, _role: "admin" });
    if (data === true) isCloudAdmin = true;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }

  // Try SAP session
  const sap = await validateSapSession(req);
  if (sap) {
    if (!identity) identity = sap.userName;
    companyDB = sap.companyDB;
    try {
      const { data: mapped } = await admin.rpc("is_sap_user_admin", {
        _sap_username: sap.userName.toLowerCase(),
      });
      if (mapped === true) isSuperUser = true;
    } catch { /* ignore */ }
    if (!isSuperUser && sap.userName.toLowerCase() === "manager") isSuperUser = true;
  }

  return { identity, email, isCloudAdmin, isSuperUser, companyDB };
}

function isSapNo(value: unknown): boolean {
  return String(value ?? "").toLowerCase() === "tno" || value === false;
}

function isSapYes(value: unknown): boolean {
  return String(value ?? "").toLowerCase() === "tyes" || value === true;
}

async function validateActiveSapItems(
  admin: SupabaseClient,
  companyDb: string,
  items: Array<{ item_code?: string | null }>,
  docType: string,
  options: { liveSap?: boolean } = {},
): Promise<string | null> {
  const codes = Array.from(
    new Set(
      (items || [])
        .map((it) => String(it?.item_code || "").trim())
        .filter(Boolean),
    ),
  );
  if (codes.length === 0) return null;

  const { data: company } = await admin
    .from("companies")
    .select("erp_type")
    .eq("company_db", companyDb)
    .maybeSingle();
  if (String(company?.erp_type || "sap").toLowerCase() === "omie") {
    const invalid = codes.filter((code) => !/^P:\d+$/i.test(code));
    return invalid.length > 0
      ? `Pedido de ${docType === "sales" ? "Venda" : "Compra"} Omie aceita apenas produtos ativos selecionados no catálogo (códigos P:<id>). Item(ns) inválido(s): ${invalid.join(", ")}.`
      : null;
  }

  if (docType === "sales") return null;

  if (options.liveSap === false) {
    const { data: cacheRows } = await admin
      .from("sap_cache")
      .select("data")
      .eq("company_db", companyDb)
      .in("cache_key", ["items_purchase_active_v3", "items_purchase_active_v4"])
      .order("expires_at", { ascending: false })
      .limit(1);
    const cachedItems = Array.isArray(cacheRows) && cacheRows.length > 0
      ? ((cacheRows[0] as any).data || [])
      : [];
    if (!Array.isArray(cachedItems) || cachedItems.length === 0) return null;

    const activeCodes = new Set(
      cachedItems
        .map((row: any) => String(row?.ItemCode || "").trim())
        .filter(Boolean),
    );
    const missing = codes.filter((code) => !activeCodes.has(code));
    return missing.length > 0
      ? `Item não encontrado no cache de itens ativos da empresa ${companyDb}: ${missing.join(", ")}. Atualize a lista de itens e selecione novamente.`
      : null;
  }

  const creds = await loadSapCreds(admin as unknown as ReturnType<typeof createClient>, companyDb, { requireApiuser: false });
  if (!creds) {
    return "Não foi possível validar os itens no ERP: credenciais SAP não configuradas para esta empresa.";
  }
  const baseUrl = buildSapBaseUrl(creds.service_layer_url);
  const cookie = await sapCookieLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
  try {
    const invalid: string[] = [];
    for (const code of codes) {
      const escaped = code.replace(/'/g, "''");
      const url = `${baseUrl}/Items('${encodeURIComponent(escaped)}')?$select=ItemCode,ItemName,Valid,Frozen,ItemType,PurchaseItem`;
      const res = await sapFetch(url, { headers: { Cookie: cookie }, timeoutMs: 20_000 });
      if (!res.ok) {
        invalid.push(`${code} (não encontrado na empresa ${companyDb})`);
        continue;
      }
      const row = await res.json().catch(() => ({}));
      const inactive =
        isSapNo(row.Valid) ||
        isSapYes(row.Frozen) ||
        String(row.ItemType || "") === "itFixedAssets" ||
        isSapNo(row.PurchaseItem);
      if (inactive) {
        invalid.push(`${code}${row.ItemName ? ` - ${row.ItemName}` : ""}`);
      }
    }
    if (invalid.length > 0) {
      return `Item inativo ou não liberado para compras no ERP (${companyDb}): ${invalid.join(", ")}. Selecione um item ativo para esta empresa.`;
    }
    return null;
  } finally {
    await sapLogout(baseUrl, cookie);
  }
}

/* ───────────────────────── Actions ───────────────────────── */

const ALLOWED_CREATE_STATUS = new Set(["rascunho", "pendente_aprovacao"]);
// Origens que criam despesa já aprovada (não passam pelo fluxo interno de aprovação).
// PagCorp = gastos de cartão corporativo — vão direto para integração SAP.
const AUTO_APPROVED_ORIGINS = new Set(["pagcorp"]);
const ALLOWED_LOG_DECISIONS = new Set([
  "created", "submitted", "cancelled", "reactivated", "integrated", "integration_failed",
]);

async function actionCreate(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.identity) return json(401, { error: "Não autenticado" });
  const input = body?.input ?? {};

  const origin = String(input.origin || "manual");
  let status = String(input.status || "rascunho");
  // Cartão corporativo (PagCorp): nunca passa por aprovação, mesmo quando o
  // documento é digitado manualmente pelo time de cartões.
  const isCardExpense = isPagCorpExpense(origin, input.remarks);
  if (isCardExpense && status !== "rascunho") status = "aprovado";
  const isAutoApproved = status === "aprovado" && (isCardExpense || AUTO_APPROVED_ORIGINS.has(origin));
  if (!ALLOWED_CREATE_STATUS.has(status) && !isAutoApproved) {
    return json(400, { error: `status inicial inválido: ${status}` });
  }


  const items: any[] = Array.isArray(input.items) ? input.items : [];
  const totalAmount = items.reduce((s, it) => s + Number(it.line_total || 0), 0);

  // Server enforces requester identity — client cannot impersonate.
  const requesterName = caller.identity;
  const requesterEmail = caller.identity.includes("@") ? caller.identity : caller.identity;
  const companyDb = String(input.company_db || caller.companyDB || "").trim();
  if (!companyDb) return json(400, { error: "company_db é obrigatório" });

  // Data de vencimento é obrigatória para todo pedido criado via ERP Flow.
  const dueDate = input.due_date ? String(input.due_date).trim() : "";
  if (!dueDate) return json(400, { error: "Data de vencimento é obrigatória" });
  const docType = String(input.doc_type || "purchase").toLowerCase();
  const isUberExpense = origin === "uber";
  if (!isUberExpense && docType !== "sales" && Number(input.attachment_count || 0) < 1) {
    return json(400, { error: "Anexo obrigatório: documentos devem ser criados com ao menos 1 anexo." });
  }
  const itemValidationError = await validateActiveSapItems(admin, companyDb, items, docType, { liveSap: false });
  if (itemValidationError) return json(400, { error: itemValidationError });

  // Centros de custo desativados são redirecionados para a alçada ativa
  // equivalente (CC + projeto) antes de resolver o aprovador.
  const ccRedirects = await loadCcRedirects(admin, companyDb);
  const redirectNotes: string[] = [];
  if (ccRedirects.size > 0) {
    const head = applyCcRedirect(ccRedirects, input.cost_center, input.project);
    if (head.redirected) {
      input.cost_center = head.costCenter;
      input.project = head.project;
      redirectNotes.push(`${head.from} → ${head.costCenter}${head.project ? ` / ${head.project}` : ""}`);
    }
    for (const it of items) {
      const line = applyCcRedirect(ccRedirects, it?.cost_center, it?.project);
      if (line.redirected) {
        it.cost_center = line.costCenter;
        it.project = line.project;
        redirectNotes.push(`${line.from} → ${line.costCenter}${line.project ? ` / ${line.project}` : ""}`);
      }
    }
  }
  const ccRedirected = redirectNotes.length > 0;

  // If pendente_aprovacao and approval_rule_id provided, verify rule exists & is active.
  // Quando houve redirecionamento de CC, a regra enviada pelo cliente foi calculada
  // com o CC antigo — reavaliamos a matriz com o CC/projeto corrigidos.
  let ruleId = input.approval_rule_id ? String(input.approval_rule_id) : null;

  if (ruleId) {
    const { data: rule, error } = await admin
      .from("approval_rules")
      .select("id, is_active, company_db")
      .eq("id", ruleId)
      .maybeSingle();
    if (error) return json(500, { error: `Falha ao validar regra: ${error.message}` });
    if (!rule || !(rule as any).is_active) return json(400, { error: "Regra de aprovação inválida ou inativa" });
    // Rule must belong to the same company (or be global)
    const rc = (rule as any).company_db;
    if (rc && rc !== companyDb) return json(400, { error: "Regra pertence a outra empresa" });
  }

  // Rematch quando houve redirecionamento de CC OU quando o cliente não
  // conseguiu casar nenhuma regra (ex.: CC/projeto só existem nos itens).
  if (ccRedirected || !ruleId) {
    const rematched = await rematchRuleFromMatrix(admin, {
      companyDb,
      docType,
      totalAmount,
      costCenter: String(input.cost_center || items[0]?.cost_center || "").trim(),
      project: String(input.project || items[0]?.project || "").trim(),
      currency: input.currency || "BRL",
      requesterName,
      supplierName: input.supplier_name || null,
      supplierCode: input.supplier_code || null,
      expenseId: "",
      rateioType: (input as any).rateio_type || null,
      items,
    });
    if (rematched) ruleId = rematched;
  }

  const autoApprovedByRule =
    status === "pendente_aprovacao" && await isAutomaticApprovalRule(admin, ruleId);
  if (autoApprovedByRule) status = "aprovado";



  // Self-approval guard: when the requester matches the level's approver,
  // skip forward to the next level. If every level matches, fall back to
  // Matheus Moreira (global validator, all companies).
  let resolvedApprover: string | null = input.current_approver || null;
  let resolvedApproverEmail: string | null = null;
  let resolvedLevel = 1;
  let fallbackUsed = false;
  let escalatedTo: string | null = null;
  let matrixGap = false;
  // RATEIO entre alçadas diferentes: cada segmento (CC + projeto) tem o seu
  // PRÓPRIO fluxo, independente. Persistimos os segmentos após criar a despesa;
  // aqui só resolvemos os aprovadores iniciais (um por segmento).
  // Tipo de rateio no cabeçalho (folha/imposto/viagens) força uma regra única —
  // nesse caso NÃO há trilhas independentes por CC.
  // REEMBOLSO é a exceção: roda em PARALELO com a alçada padrão.
  const rateioTypeNorm = String(input.rateio_type || "").toLowerCase();
  const isReembolso = rateioTypeNorm === "reembolso";
  const rateioOverride = ["folha", "imposto", "viagens"].includes(rateioTypeNorm);
  const segCtx = {
    companyDb,
    docType,
    currency: input.currency || "BRL",
    requesterName,
    supplierName: input.supplier_name || null,
    supplierCode: input.supplier_code || null,
    headerCostCenter: input.cost_center || null,
    headerProject: input.project || null,
    rateioType: rateioTypeNorm || "padrao",
  };
  const rateioSegments = status !== "pendente_aprovacao" || rateioOverride
    ? null
    : isReembolso
      ? await buildReembolsoSegments(admin, items as any, segCtx)
      : await buildRateioSegments(admin, items as any, segCtx);
  if (rateioSegments && rateioSegments.length > 0) {
    const picks = rateioSegments.map((s) =>
      pickApproverSkippingRequester(s.chain, requesterName, requesterEmail, 1),
    );
    const names = Array.from(new Set(picks.map((p) => p.approver_name).filter(Boolean)));
    resolvedApprover = names.join(" / ") || resolvedApprover;
    resolvedApproverEmail = picks[0]?.approver_email || null;
    resolvedLevel = Math.min(...picks.map((p) => p.level_order));
    fallbackUsed = picks.some((p) => p.fallback_used);
  } else if (status === "pendente_aprovacao" && ruleId) {

    const picked = await resolveApproverWithEscalation(admin, ruleId, {
      companyDb,
      docType,
      totalAmount,
      costCenter: input.cost_center || items[0]?.cost_center || null,
      project: input.project || items[0]?.project || null,
      requesterName,
      requesterEmail,
      supplierName: input.supplier_name || null,
      supplierCode: input.supplier_code || null,
      currency: input.currency || "BRL",
    }, 1);
    resolvedApprover = picked.approver_name || resolvedApprover;
    resolvedApproverEmail = picked.approver_email;
    resolvedLevel = picked.level_order;
    fallbackUsed = picked.fallback_used;
    escalatedTo = picked.escalated ? (picked.escalated_rule_name || picked.escalated_rule_id || "faixa superior") : null;
  } else if (status === "pendente_aprovacao" && !ruleId) {
    // Lacuna na matriz: nenhuma regra casou → aprovador global de contingência.
    resolvedApprover = MATRIX_FALLBACK_APPROVER.name;
    resolvedApproverEmail = MATRIX_FALLBACK_APPROVER.email;
    resolvedLevel = 1;
    matrixGap = true;
  }

  const insertPayload: Record<string, unknown> = {
    supplier_code: input.supplier_code || null,
    supplier_name: input.supplier_name || "",
    total_amount: totalAmount,
    currency: input.currency || "BRL",
    cost_center: input.cost_center || null,
    project: input.project || null,
    remarks: input.remarks || null,
    status,
    requester_name: requesterName,
    requester_email: requesterEmail,
    created_by_email: requesterEmail,
    current_approver: resolvedApprover,
    approval_rule_id: ruleId,
    origin: input.origin || "manual",
    company_db: companyDb,
    branch_id: input.branch_id ?? 1,
    doc_type: docType,
    doc_date: input.doc_date || null,
    due_date: input.due_date || null,
    payment_terms_code: (() => {
      const code = (input as { payment_terms_code?: unknown }).payment_terms_code;
      const s = code == null ? "" : String(code).trim();
      return s.length > 0 && s.length <= 50 ? s : null;
    })(),
    payment_terms_name: (() => {
      const name = (input as { payment_terms_name?: unknown }).payment_terms_name;
      const s = name == null ? "" : String(name).trim();
      return s.length > 0 && s.length <= 255 ? s : null;
    })(),
    payment_method: (() => {
      const method = String((input as { payment_method?: unknown }).payment_method || "").toLowerCase();
      return ["boleto", "pix", "ted", "unknown"].includes(method) ? method : null;
    })(),
    payment_boleto_barcode: (() => {
      const value = boletoBarcodeFrom(
        (input as { payment_boleto_barcode?: unknown }).payment_boleto_barcode ||
        (input as { payment_boleto_digitable_line?: unknown }).payment_boleto_digitable_line ||
        "",
      );
      return value.length === 44 ? value : null;
    })(),
    payment_boleto_digitable_line: (() => {
      const value = digits((input as { payment_boleto_digitable_line?: unknown }).payment_boleto_digitable_line);
      return value.length >= 44 ? value.slice(0, 80) : null;
    })(),
    payment_metadata: (() => {
      const metadata = (input as { payment_metadata?: unknown }).payment_metadata;
      return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    })(),
    rateio_type: input.rateio_type || null,
    nfse_split_mode:
      (input as { nfse_split_mode?: string }).nfse_split_mode === "per_brand" ? "per_brand" : "unified",
    sales_usage: (() => {
      const u = (input as { sales_usage?: unknown }).sales_usage;
      const s = u == null ? "" : String(u).trim();
      return s.length > 0 && s.length <= 20 ? s : null;
    })(),
    current_level_order: autoApprovedByRule ? 0 : (resolvedLevel || 1),
  };

  let { data: expense, error: expErr } = await admin
    .from("expenses")
    .insert(insertPayload as any)
    .select()
    .single();
  if (expErr && isMissingColumnError(expErr)) {
    const retry = await admin
      .from("expenses")
      .insert(withoutUnsupportedExpenseColumns(insertPayload) as any)
      .select()
      .single();
    expense = retry.data;
    expErr = retry.error;
  }
  if (expErr) return json(500, { error: `Falha ao criar despesa: ${expErr.message}` });

  const expenseId = (expense as any).id as string;

  if (items.length > 0) {
    const rows = items.map((it) => ({
      expense_id: expenseId,
      item_code: it.item_code || null,
      description: it.description || "",
      quantity: Number(it.quantity || 0),
      unit_price: Number(it.unit_price || 0),
      line_total: Number(it.line_total || 0),
      cost_center: it.cost_center || input.cost_center || null,
      project: it.project || input.project || null,
      items_group_code: it.items_group_code ?? null,
      items_group_name: it.items_group_name ?? null,
      free_of_charge: it.free_of_charge === true,
    }));
    const { error: itemsErr } = await admin.from("expense_items").insert(rows as any);
    if (itemsErr) return json(500, { error: `Falha ao inserir itens: ${itemsErr.message}` });
  }

  // Fluxos independentes por segmento (CC + projeto) — cada um com a sua cadeia.
  if (rateioSegments && rateioSegments.length > 0) {
    try {
      await persistRateioSegments(admin, expenseId, rateioSegments, requesterName, requesterEmail);
    } catch (e) {
      console.warn("[expense-mutation] falha ao gravar segmentos de rateio:", (e as Error)?.message || e);
    }
  }



  await admin.from("expense_approval_log").insert({
    expense_id: expenseId,
    decision: "created",
    approver_name: caller.identity,
    approver_email: caller.email || (caller.identity.includes("@") ? caller.identity : null),
    remarks: ccRedirected
      ? [input.remarks || null, `CC desativado redirecionado: ${redirectNotes.join("; ")}`]
          .filter(Boolean)
          .join(" | ")
      : (input.remarks || null),

  } as any);
  if (autoApprovedByRule) {
    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "approved",
      approver_name: "Sistema",
      approver_email: null,
      level_order: 0,
      remarks: "Aprovado automaticamente pela regra de aprovação aplicada.",
    } as any);
    runAfterResponse(dispatchApprovedExpense(expenseId, docType, origin));
  }
  if (status === "pendente_aprovacao") {
    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "submitted",
      approver_name: caller.identity,
      approver_email: caller.email || (caller.identity.includes("@") ? caller.identity : null),
      level_order: resolvedLevel,
      remarks: matrixGap
        ? `Sem regra de aprovação aplicável (lacuna na matriz) — direcionado para ${MATRIX_FALLBACK_APPROVER.name}.`
        : escalatedTo
        ? `Auto-aprovação evitada: solicitante era o aprovador — escalonado para a faixa superior (${escalatedTo}) → ${resolvedApprover}.`
        : fallbackUsed
        ? `Solicitante coincide com o(s) aprovador(es) da regra — direcionado para ${SELF_APPROVAL_FALLBACK.name}.`
        : (resolvedLevel > 1
          ? `Nível(is) anterior(es) puladod(s): solicitante era o aprovador designado.`
          : null),
    } as any);
  }

  if (matrixGap) {
    runAfterResponse(
      notifyMatrixGap({
        companyDb,
        docType: String(input.doc_type || "purchase"),
        expenseId,
        costCenter: input.cost_center || items[0]?.cost_center || null,
        project: input.project || items[0]?.project || null,
        totalAmount,
        currency: input.currency || "BRL",
        requester: requesterName,
        reason: "Nenhuma regra ativa casou com os critérios do documento",
      }).catch((e) => console.warn("[expense-mutation] notifyMatrixGap failed:", e instanceof Error ? e.message : e)),
    );
  }



  if (status === "pendente_aprovacao") {
    runAfterResponse(
      notifyApprovalPending(admin, {
        expenseId,
        companyDb,
        approverEmail: resolvedApproverEmail,
        approverName: resolvedApprover,
        levelOrder: resolvedLevel,
        requesterName,
        supplierName: input.supplier_name || input.supplier_code,
        totalAmount,
        currency: input.currency || "BRL",
        docType: String(insertPayload.doc_type || "purchase"),
        resolution: {
          source: matrixGap ? "default_fallback" : (fallbackUsed ? "self_approval_escalation" : "matrix_rule"),
          reason: matrixGap
            ? "Nenhuma regra ativa casou com os critérios do documento — aprovador global de contingência"
            : fallbackUsed
              ? "Solicitante era o aprovador designado — redirecionado para o aprovador de contingência"
              : `Regra da matriz aplicada no nível ${resolvedLevel}${escalatedTo ? ` (escalado para ${escalatedTo})` : ""}`,
          ruleId: matrixGap ? null : ruleId,
          costCenter: input.cost_center || items[0]?.cost_center || null,
          project: input.project || items[0]?.project || null,
          metadata: { escalated_to: escalatedTo, matrix_gap: matrixGap, fallback_used: fallbackUsed },
        },
      }).catch((e) => console.warn("[expense-mutation] notifyApprovalPending failed:", e instanceof Error ? e.message : e)),
    );

  }


  return json(200, { ok: true, expense, auto_approved: autoApprovedByRule });
}

async function loadExpenseForOwner(admin: SupabaseClient, expenseId: string) {
  const { data, error } = await admin
    .from("expenses")
    .select("*")
    .eq("id", expenseId)
    .maybeSingle();
  if (error) return { error: `Falha ao carregar despesa: ${error.message}` } as const;
  if (!data) return { error: "Despesa não encontrada" } as const;
  return { data } as const;
}

async function actionUpdate(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.identity && !caller.isCloudAdmin) return json(401, { error: "Não autenticado" });
  const expenseId = String(body?.expense_id || "");
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });

  const res = await loadExpenseForOwner(admin, expenseId);
  if ("error" in res) return json(res.error === "Despesa não encontrada" ? 404 : 500, { error: res.error });
  const current = res.data as any;

  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;
  if (!isPrivileged && !isOwner(caller.identity || "", current)) {
    return json(403, { error: "Você não pode editar esta despesa" });
  }

  const status = current.status as string;
  const hasSapError = !!current.sap_integration_error;
  const alreadyInSap = !!(current.sap_doc_entry || current.sap_doc_num);
  const editMode = classifyExpenseEdit(status, alreadyInSap);

  if (current.sap_integration_locked_at) {
    const lockedAt = new Date(current.sap_integration_locked_at).getTime();
    if (Number.isFinite(lockedAt) && Date.now() - lockedAt < 5 * 60_000) {
      return json(409, {
        error: "O pedido está sendo integrado ao ERP neste momento. Aguarde a conclusão antes de editar.",
      });
    }
  }

  // Bloqueio definitivo: depois que a NF de entrada foi lançada (ou o documento
  // seguiu para pagamento/finalização) qualquer alteração geraria divergência
  // com o ERP.
  if (editMode === "blocked" && ["nf_entrada", "pagamento", "finalizado"].includes(status)) {
    return json(409, {
      error: "Documento com NF de entrada lançada (ou encerrado) — edição não permitida.",
    });
  }
  if (alreadyInSap) {
    const { data: nfByExpense } = await admin
      .from("nf_entrada_imports")
      .select("status, sap_invoice_draft_id")
      .eq("expense_id", expenseId);
    const sapDocEntry = Number(current.sap_doc_entry || 0);
    const { data: nfBySap } = sapDocEntry > 0
      ? await admin
        .from("nf_entrada_imports")
        .select("status, sap_invoice_draft_id")
        .eq("sap_company_db", String(current.company_db || ""))
        .eq("sap_matched_po_doc_entry", sapDocEntry)
      : { data: [] };
    const nfRows = [...(nfByExpense || []), ...(nfBySap || [])];
    const nfPosted = (nfRows || []).some((r: any) =>
      r.sap_invoice_draft_id || ["awaiting_invoice", "completed"].includes(String(r.status))
    );
    if (nfPosted) {
      return json(409, {
        error: "Já existe NF de entrada lançada no ERP para este pedido — edição não permitida.",
      });
    }
  }

  // Documento já integrado ao ERP e ainda sem NF de entrada: pode ser editado.
  // Volta ao nível 1 de aprovação e, ao final, sofre patch completo no ERP.
  const editableApproved = editMode === "approved";
  const editableForFix = editableApproved && hasSapError;
  const editableIntegrated = editMode === "integrated";
  if (editMode === "blocked") {
    return json(409, {
      error: "Somente pedidos em rascunho, pendentes de aprovação, com erro de integração ou já lançados sem NF de entrada podem ser alterados.",
    });
  }


  const input = body?.input ?? {};
  const updates: Record<string, unknown> = {};
  if (input.supplier_name !== undefined) updates.supplier_name = input.supplier_name;
  if (input.supplier_code !== undefined) updates.supplier_code = input.supplier_code;
  if (input.remarks !== undefined) updates.remarks = input.remarks;
  if (input.doc_date !== undefined) updates.doc_date = input.doc_date || null;
  if (input.due_date !== undefined) updates.due_date = input.due_date || null;
  if (input.rateio_type !== undefined) updates.rateio_type = input.rateio_type || null;

  let items: any[] | undefined;
  if (input.items !== undefined) {
    try {
      items = normalizeExpenseItems(input.items);
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (items && items.length > 0) {
    // Edição é uma operação interna: não abre uma sessão no SAP nem consulta
    // item a item. A lista ativa já está cacheada localmente e a integração
    // só acontece após uma nova aprovação.
    const itemValidationError = await validateActiveSapItems(
      admin,
      String(current.company_db || ""),
      items,
      String(current.doc_type || "purchase"),
      { liveSap: false },
    );
    if (itemValidationError) return json(400, { error: itemValidationError });

    // Redireciona CCs desativados também na edição (cabeçalho + linhas).
    const ccRedirects = await loadCcRedirects(admin, String(current.company_db || ""));
    if (ccRedirects.size > 0) {
      const head = applyCcRedirect(ccRedirects, current.cost_center, current.project);
      if (head.redirected) {
        updates.cost_center = head.costCenter;
        updates.project = head.project;
      }
      for (const it of items) {
        const line = applyCcRedirect(ccRedirects, it?.cost_center, it?.project);
        if (line.redirected) {
          it.cost_center = line.costCenter;
          it.project = line.project;
        }
      }
    }
    const totalAmount = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
    updates.total_amount = totalAmount;

    // Cabeçalho segue as linhas: ao editar CC/projeto dos itens, o header é
    // recalculado (primeiro valor distinto) para não exibir dado antigo.
    const uniq = (vals: unknown[]) =>
      Array.from(new Set(vals.map((v) => String(v ?? "").trim()).filter(Boolean)));
    const lineProjects = uniq(items.map((it: any) => it?.project));
    const lineCcs = uniq(items.map((it: any) => it?.cost_center));
    if (input.project === undefined && lineProjects.length > 0) updates.project = lineProjects[0];
    if (input.cost_center === undefined && lineCcs.length > 0) updates.cost_center = lineCcs[0];
  }

  if (editableForFix) updates.sap_integration_error = null;


  // ── Anexos: valida antes de qualquer escrita ────────────────────────────
  const removeIds: string[] = Array.isArray(input.remove_attachment_ids)
    ? input.remove_attachment_ids.map((x: unknown) => String(x)).filter(Boolean)
    : [];
  const addAttachments: any[] = Array.isArray(input.add_attachments) ? input.add_attachments : [];
  const attachmentsChanged = removeIds.length > 0 || addAttachments.length > 0;

  let removeTargets: Array<{ id: string; file_path: string }> = [];
  if (attachmentsChanged) {
    // Carrega os anexos atuais para validar (1) que os IDs pertencem à despesa
    // e (2) que a contagem final não fica em zero.
    const { data: existing, error: exErr } = await admin
      .from("expense_attachments")
      .select("id, file_path")
      .eq("expense_id", expenseId);
    if (exErr) return json(500, { error: `Falha ao ler anexos: ${exErr.message}` });
    const rows = (existing || []) as Array<{ id: string; file_path: string }>;
    const validIds = new Set(rows.map((r) => r.id));
    for (const rid of removeIds) {
      if (!validIds.has(rid)) return json(400, { error: `Anexo ${rid} não pertence a esta despesa` });
    }
    removeTargets = rows.filter((r) => removeIds.includes(r.id));
    const finalCount = rows.length - removeTargets.length + addAttachments.length;
    if (String(current.doc_type || "purchase").toLowerCase() !== "sales" && finalCount < 1) {
      return json(400, { error: "O pedido precisa manter ao menos 1 anexo." });
    }
  }

  // Regra de negócio: qualquer edição em documento que já saiu do rascunho
  // (pendente_aprovacao ou aprovado com erro de SAP) deve retornar ao fluxo
  // de aprovação a partir do nível 1, recomputando o aprovador designado.
  // Também dispara resubmit quando o tipo de rateio muda em rascunho (o
  // caminho de aprovação depende do rateio_type) e quando anexos mudam
  // (adicionar/remover comprova pré-condição de aprovação).
  const rateioChanged = !!input.rateio_changed;
  const shouldResubmit =
    status === "pendente_aprovacao" ||
    editableApproved ||
    editableIntegrated ||
    (attachmentsChanged && status === "pendente_aprovacao");
  let resubmittedApprover: string | null = null;
  let resubmittedLevel = 1;
  let resubmitFallbackUsed = false;
  let resubmittedAutoApproved = false;
  let resubmittedSegments: RateioSegment[] | null = null;

  // Se o rateio mudou, o cliente já resolveu a nova regra e o 1º aprovador.
  // - Em rascunho: atualiza apenas os campos de roteamento; status continua rascunho.
  // - Em pendente_aprovacao (ou aprovado com erro): resubmete a partir do nível 1
  //   usando a NOVA regra.
  if (rateioChanged) {
    updates.approval_rule_id = input.new_approval_rule_id ?? null;
    if (status === "rascunho") {
      updates.current_level_order = 1;
      updates.current_approver = input.new_current_approver ?? null;
    }
  }

  if (shouldResubmit) {
    const nextRevision = Math.max(1, Number(current.revision_number || 1)) + 1;
    let nextRuleId = rateioChanged
      ? (input.new_approval_rule_id ?? null)
      : (current.approval_rule_id ?? null);
    const nextApproverFromClient = rateioChanged
      ? (input.new_current_approver ?? null)
      : null;

    // Sem regra vinculada (ex.: documento criado antes do CC ser preenchido nos
    // itens, ou rateio alterado sem regra enviada pelo cliente): antes de cair
    // no fallback global da matriz, reavalia a matriz com os dados ATUAIS.
    if (!nextRuleId) {
      const rematched = await rematchRuleFromMatrix(admin, {
        companyDb: String(current.company_db || ""),
        docType: String(current.doc_type || "purchase"),
        totalAmount: Number((updates as any).total_amount ?? current.total_amount ?? 0),
        costCenter: String((updates as any).cost_center ?? current.cost_center ?? "").trim(),
        project: String((updates as any).project ?? current.project ?? "").trim(),
        currency: current.currency,
        requesterName: current.requester_name,
        supplierName: current.supplier_name,
        supplierCode: current.supplier_code,
        expenseId,
        rateioType: (updates as any).rateio_type ?? (current as any).rateio_type ?? null,
        items,
      });
      if (rematched) {
        nextRuleId = rematched;
        updates.approval_rule_id = rematched;
      }
    }

    let resolvedLevel = 1;
    let resolvedApprover: string | null = nextApproverFromClient;
    let fallbackUsed = false;
    resubmittedAutoApproved = await isAutomaticApprovalRule(admin, nextRuleId);

    if (resubmittedAutoApproved) {
      resolvedLevel = 0;
      resolvedApprover = null;
    } else if (nextRuleId) {
      const picked = await resolveApproverWithEscalation(admin, nextRuleId, {
        companyDb: String(current.company_db || ""),
        docType: String(current.doc_type || "purchase"),
        totalAmount: Number((updates as any).total_amount ?? current.total_amount ?? 0),
        costCenter: (updates as any).cost_center ?? current.cost_center ?? null,
        project: (updates as any).project ?? current.project ?? null,
        requesterName: current.requester_name,
        requesterEmail: current.requester_email,
        supplierName: current.supplier_name,
        supplierCode: current.supplier_code,
        currency: current.currency,
      }, 1);
      resolvedLevel = picked.level_order;
      resolvedApprover = picked.approver_name || resolvedApprover;
      fallbackUsed = picked.fallback_used;
    } else {
      resolvedApprover = MATRIX_FALLBACK_APPROVER.name;
      resolvedLevel = 1;
      await notifyMatrixGap({
        companyDb: String(current.company_db || ""),
        docType: String(current.doc_type || "purchase"),
        expenseId,
        costCenter: (updates as any).cost_center ?? current.cost_center ?? null,
        project: (updates as any).project ?? current.project ?? null,
        totalAmount: Number((updates as any).total_amount ?? current.total_amount ?? 0),
        currency: current.currency,
        requester: current.requester_name,
        reason: "Reenvio sem regra de aprovação aplicável",
      });
    }
    updates.status = resubmittedAutoApproved ? "aprovado" : "pendente_aprovacao";
    updates.current_level_order = resolvedLevel;
    updates.current_approver = resolvedApprover;
    updates.sap_integration_error = null;
    if (alreadyInSap) updates.sap_purchase_order_status = "update_pending";
    updates.revision_number = nextRevision;
    // O contexto da revisão é preservado no log de aprovação e na auditoria.
    // A persistência remove campos de revisão em bases que ainda não os possuem.
    resubmittedApprover = resolvedApprover;
    resubmittedLevel = resolvedLevel;
    resubmitFallbackUsed = fallbackUsed;

    // Edição cria uma nova revisão: todas as trilhas são recalculadas do zero,
    // sem carregar status ou aprovações da versão anterior do documento.
    if (!resubmittedAutoApproved) {
      let segmentItems = items;
      if (!segmentItems) {
        const { data: storedItems, error: storedItemsError } = await admin
          .from("expense_items")
          .select("cost_center, project, line_total")
          .eq("expense_id", expenseId);
        if (storedItemsError) {
          return json(500, { error: `Falha ao recalcular trilhas após edição: ${storedItemsError.message}` });
        }
        segmentItems = (storedItems || []) as any[];
      }
      const effectiveRateioType = String(
        updates.rateio_type ?? current.rateio_type ?? "padrao",
      ).toLowerCase();
      const rateioOverride = ["folha", "imposto", "viagens"].includes(effectiveRateioType);
      if (!rateioOverride) {
        const segmentContext = {
          companyDb: String(current.company_db || ""),
          docType: String(current.doc_type || "purchase"),
          currency: current.currency || "BRL",
          requesterName: current.requester_name || null,
          supplierName: String(updates.supplier_name ?? current.supplier_name ?? "") || null,
          supplierCode: String(updates.supplier_code ?? current.supplier_code ?? "") || null,
          headerCostCenter: String(updates.cost_center ?? current.cost_center ?? "") || null,
          headerProject: String(updates.project ?? current.project ?? "") || null,
          rateioType: effectiveRateioType,
        };
        resubmittedSegments = effectiveRateioType === "reembolso"
          ? await buildReembolsoSegments(admin, segmentItems as any, segmentContext)
          : await buildRateioSegments(admin, segmentItems as any, segmentContext);
        if (resubmittedSegments && resubmittedSegments.length > 0) {
          const picks = resubmittedSegments.map((segment) =>
            pickApproverSkippingRequester(
              segment.chain,
              current.requester_name || null,
              current.requester_email || null,
              1,
            )
          );
          const approvers = Array.from(new Set(
            picks.map((pick) => pick.approver_name).filter(Boolean),
          ));
          resubmittedApprover = approvers.join(" / ") || resolvedApprover;
          resubmittedLevel = Math.min(...picks.map((pick) => pick.level_order));
          updates.current_approver = resubmittedApprover;
          updates.current_level_order = resubmittedLevel;
        }
      }
    }
  }

  const persistedUpdates = withoutUnsupportedExpenseColumns(updates);
  // Snapshot das linhas antes da escrita — usado para descrever a alteração
  // no histórico de eventos do documento.
  let previousItems: Array<Record<string, unknown>> = [];
  if (items) {
    const { data: prev } = await admin
      .from("expense_items")
      .select("item_code, item_name, description, quantity, line_total, cost_center, project")
      .eq("expense_id", expenseId);
    previousItems = (prev || []) as Array<Record<string, unknown>>;
  }

  if (items) {
    const updateErr = await updateExpenseWithItems(admin, expenseId, persistedUpdates, items);
    if (updateErr) return json(500, { error: `Falha ao atualizar pedido e itens: ${updateErr}` });
  } else if (Object.keys(persistedUpdates).length > 0) {
    const { error: upErr } = await admin.from("expenses").update(persistedUpdates).eq("id", expenseId);
    if (upErr) return json(500, { error: `Falha ao atualizar: ${upErr.message}` });
  }


  if (shouldResubmit) {
    if (resubmittedSegments && resubmittedSegments.length > 0 && !resubmittedAutoApproved) {
      await persistRateioSegments(
        admin,
        expenseId,
        resubmittedSegments,
        current.requester_name || null,
        current.requester_email || null,
      );
    } else {
      await admin.from("expense_approval_segments").delete().eq("expense_id", expenseId);
    }
  }

  // ── Aplica mudanças de anexos ───────────────────────────────────────────
  const addedNames: string[] = [];
  const removedNames: string[] = [];
  if (attachmentsChanged) {
    if (removeTargets.length > 0) {
      // Ordem importa para não deixar órfãos:
      // 1) DELETE no banco primeiro (fonte da verdade, transacional).
      // 2) Só então remove os objetos do storage.
      // Se o passo (2) falhar, logamos com detalhes para reconciliação —
      // mas o vínculo lógico já não existe mais.
      const { data: delAtt, error: delAttErr } = await admin
        .from("expense_attachments")
        .delete()
        .eq("expense_id", expenseId)
        .in("id", removeTargets.map((r) => r.id))
        .select("id, file_name, file_path");
      if (delAttErr) return json(500, { error: `Falha ao remover anexos: ${delAttErr.message}` });

      const deletedRows = (delAtt || []) as Array<{ id: string; file_name: string; file_path: string }>;
      for (const r of deletedRows) removedNames.push(r.file_name);

      const paths = deletedRows.map((r) => r.file_path).filter(Boolean);
      if (paths.length > 0) {
        try {
          const { data: removed, error: rmErr } = await admin.storage
            .from("expense-attachments")
            .remove(paths);
          if (rmErr) {
            console.error("[expense-mutation] storage.remove falhou (arquivos podem ficar órfãos)", {
              expense_id: expenseId,
              paths,
              error: rmErr.message,
            });
          } else {
            const removedPaths = new Set((removed || []).map((f: any) => f.name));
            const missed = paths.filter((p) => !removedPaths.has(p));
            if (missed.length > 0) {
              console.warn("[expense-mutation] storage.remove: caminhos não confirmados", {
                expense_id: expenseId,
                missed,
              });
            }
          }
        } catch (e) {
          console.error("[expense-mutation] storage.remove throw", {
            expense_id: expenseId,
            paths,
            error: (e as Error).message,
          });
        }
      }
    }
    if (addAttachments.length > 0) {
      const addRows = addAttachments.map((a) => ({
        expense_id: expenseId,
        file_path: String(a.file_path || ""),
        file_name: String(a.file_name || ""),
        file_size: Number(a.file_size || 0),
        mime_type: String(a.mime_type || "application/octet-stream"),
      })).filter((r) => r.file_path && r.file_name);
      if (addRows.length > 0) {
        const { error: addErr } = await admin.from("expense_attachments").insert(addRows as any);
        if (addErr) return json(500, { error: `Falha ao registrar novos anexos: ${addErr.message}` });
        for (const r of addRows) addedNames.push(r.file_name);
      }
    }
  }

  // ── Evento "editado": sempre registrado, mesmo quando a edição não
  // reinicia o fluxo de aprovação (rascunho, troca de item, etc.).
  {
    const fmt = (v: unknown) => {
      if (v === null || v === undefined || v === "") return "—";
      return String(v);
    };
    const changes: string[] = [];
    // Versão estruturada das mudanças — alimenta o histórico de versões
    // (public.expense_revisions) e o aviso de "atualização" ao aprovador.
    const structured: Array<{ field: string; label: string; before: unknown; after: unknown }> = [];
    const labels: Record<string, string> = {
      supplier_name: "Fornecedor",
      supplier_code: "Código do fornecedor",
      remarks: "Observação",
      doc_date: "Data do documento",
      due_date: "Vencimento",
      rateio_type: "Tipo de rateio",
      cost_center: "Centro de custo",
      project: "Projeto",
      total_amount: "Valor total",
    };
    for (const [field, label] of Object.entries(labels)) {
      if (!(field in updates)) continue;
      const before = (current as Record<string, unknown>)[field];
      const after = (updates as Record<string, unknown>)[field];
      if (String(before ?? "") === String(after ?? "")) continue;
      changes.push(`${label}: ${fmt(before)} → ${fmt(after)}`);
      structured.push({ field, label, before: before ?? null, after: after ?? null });
    }
    if (items) {
      const key = (it: Record<string, unknown>) =>
        `${String(it.item_code ?? "").trim()}|${String(it.cost_center ?? "").trim()}|${
          String(it.project ?? "").trim()
        }|${Number(it.quantity ?? 0)}|${Number(it.line_total ?? 0)}`;
      const beforeKeys = previousItems.map(key).sort();
      const afterKeys = (items as Array<Record<string, unknown>>).map(key).sort();
      if (beforeKeys.join("~") !== afterKeys.join("~")) {
        const beforeCodes = Array.from(
          new Set(previousItems.map((it) => String(it.item_code ?? "").trim()).filter(Boolean)),
        );
        const afterCodes = Array.from(
          new Set(
            (items as Array<Record<string, unknown>>)
              .map((it) => String(it.item_code ?? "").trim())
              .filter(Boolean),
          ),
        );
        const removedCodes = beforeCodes.filter((c) => !afterCodes.includes(c));
        const addedCodes = afterCodes.filter((c) => !beforeCodes.includes(c));
        const itemNote = removedCodes.length > 0 || addedCodes.length > 0
          ? ` (itens ${removedCodes.join(", ") || "—"} → ${addedCodes.join(", ") || "—"})`
          : "";
        changes.push(
          `Linhas: ${previousItems.length} → ${(items as unknown[]).length}${itemNote}`,
        );
        structured.push({
          field: "items",
          label: "Itens do pedido",
          before: `${previousItems.length} linha(s)${beforeCodes.length ? `: ${beforeCodes.join(", ")}` : ""}`,
          after: `${(items as unknown[]).length} linha(s)${afterCodes.length ? `: ${afterCodes.join(", ")}` : ""}`,
        });
      }
    }
    if (addedNames.length > 0) {
      changes.push(`Anexos adicionados: ${addedNames.join(", ")}`);
      structured.push({ field: "attachments_added", label: "Anexos adicionados", before: null, after: addedNames.join(", ") });
    }
    if (removedNames.length > 0) {
      changes.push(`Anexos removidos: ${removedNames.join(", ")}`);
      structured.push({ field: "attachments_removed", label: "Anexos removidos", before: removedNames.join(", "), after: null });
    }

    const revisionNumber = Number(updates.revision_number ?? current.revision_number ?? 1);

    if (changes.length > 0) {
      await admin.from("expense_approval_log").insert({
        expense_id: expenseId,
        decision: "edited",
        approver_name: caller.identity,
        approver_email: caller.email ||
          (caller.identity && caller.identity.includes("@") ? caller.identity : null),
        level_order: null,
        remarks: `Pedido alterado (revisão ${revisionNumber}). ${changes.join(" · ")}`,
      } as any);

      const { error: revErr } = await admin.from("expense_revisions").insert({
        expense_id: expenseId,
        revision_number: revisionNumber,
        changed_by_name: caller.identity,
        changed_by_email: caller.email ||
          (caller.identity && caller.identity.includes("@") ? caller.identity : null),
        status_before: status,
        status_after: String(updates.status ?? current.status ?? status),
        resubmitted: !!shouldResubmit,
        changes: structured,
        snapshot: {
          supplier_name: updates.supplier_name ?? current.supplier_name ?? null,
          supplier_code: updates.supplier_code ?? current.supplier_code ?? null,
          cost_center: updates.cost_center ?? current.cost_center ?? null,
          project: updates.project ?? current.project ?? null,
          total_amount: updates.total_amount ?? current.total_amount ?? null,
          currency: current.currency ?? null,
          doc_date: updates.doc_date ?? current.doc_date ?? null,
          due_date: updates.due_date ?? current.due_date ?? null,
          remarks: updates.remarks ?? current.remarks ?? null,
          items: (items ?? previousItems) as unknown,
        },
      } as any);
      if (revErr) {
        console.error("[expense-mutation] falha ao registrar versão do pedido", {
          expense_id: expenseId,
          revision: revisionNumber,
          error: revErr.message,
        });
      }
    }
  }



  if (shouldResubmit || (attachmentsChanged && status === "pendente_aprovacao")) {
    // Motivo(s) que dispararam o reinício do fluxo — o log serve como
    // trilha de auditoria, então listamos TODOS os gatilhos aplicáveis.
    const reasons: string[] = [];
    if (rateioChanged) reasons.push("tipo de rateio alterado");
    if (editableForFix) reasons.push("correção após erro de integração SAP");
    else if (editableApproved) reasons.push("alteração de pedido já aprovado");
    if (editableIntegrated) reasons.push(`atualização do PC ${current.sap_doc_num || current.sap_doc_entry}`);
    if (attachmentsChanged) reasons.push("anexos alterados");
    if (reasons.length === 0) reasons.push("edição do documento");

    // Detalhes completos das mudanças de anexos: contagem + nomes.
    const attachmentDetails: string[] = [];
    if (attachmentsChanged) {
      if (addedNames.length > 0) {
        attachmentDetails.push(
          `+${addedNames.length} anexo(s) adicionado(s): ${addedNames.join(", ")}`,
        );
      }
      if (removedNames.length > 0) {
        attachmentDetails.push(
          `-${removedNames.length} anexo(s) removido(s): ${removedNames.join(", ")}`,
        );
      }
    }

    const attachmentNote = attachmentDetails.length > 0
      ? ` Detalhes de anexos: ${attachmentDetails.join("; ")}.`
      : "";
    const reasonNote = `Motivo: ${reasons.join(" + ")}.`;
    const routingNote = resubmittedAutoApproved
      ? "Documento aprovado automaticamente pela regra aplicada."
      : resubmitFallbackUsed
      ? `Solicitante coincide com aprovador(es); direcionado para ${SELF_APPROVAL_FALLBACK.name}.`
      : `Fluxo de aprovação reiniciado a partir do nível ${resubmittedLevel}.`;

    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: resubmittedAutoApproved ? "approved" : "submitted",
      approver_name: resubmittedAutoApproved ? "Sistema" : caller.identity,
      approver_email: resubmittedAutoApproved
        ? null
        : caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
      level_order: resubmittedLevel,
      remarks: `Atualização da versão anterior (status: ${status}). ${reasonNote} ${routingNote}${attachmentNote}`.trim(),
    } as any);
  }


  await admin.rpc("insert_audit_log", {
    p_action: "update_expense",
    p_entity_type: "expense",
    p_entity_id: expenseId,
    p_actor_email: caller.identity,
    p_company_db: current.company_db || null,
    p_details: {
      previous_total: current.total_amount,
      new_total: updates.total_amount ?? current.total_amount,
      updated_fields: Object.keys(updates),
      items_count: items?.length,
      revision_number: updates.revision_number ?? current.revision_number ?? 1,
      resubmitted_to_approval: shouldResubmit && !resubmittedAutoApproved,
      auto_approved: resubmittedAutoApproved,
      new_approver: resubmittedApprover,
    } as any,
  });

  if (resubmittedAutoApproved) {
    runAfterResponse(dispatchApprovedExpense(
      expenseId,
      String(current.doc_type || "purchase"),
      current.origin,
      alreadyInSap,
    ));
  }

  return json(200, {
    ok: true,
    resubmitted: shouldResubmit && !resubmittedAutoApproved,
    auto_approved: resubmittedAutoApproved,
    new_approver: resubmittedApprover,
  });
}

async function actionSubmit(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.identity && !caller.isCloudAdmin) return json(401, { error: "Não autenticado" });
  const expenseId = String(body?.expense_id || "");
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });

  const res = await loadExpenseForOwner(admin, expenseId);
  if ("error" in res) return json(res.error === "Despesa não encontrada" ? 404 : 500, { error: res.error });
  const current = res.data as any;

  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;
  if (!isPrivileged && !isOwner(caller.identity || "", current)) {
    return json(403, { error: "Você não pode submeter esta despesa" });
  }
  if (current.status !== "rascunho") {
    return json(409, { error: `Despesa não está em rascunho (status: ${current.status})` });
  }

  // Cartão corporativo (PagCorp) nunca entra em fluxo de aprovação.
  const autoApprovedByRule = isPagCorpExpense(current.origin, current.remarks)
    || await isAutomaticApprovalRule(admin, current.approval_rule_id);
  if (autoApprovedByRule) {
    const { error } = await admin
      .from("expenses")
      .update({ status: "aprovado", current_level_order: 0, current_approver: null })
      .eq("id", expenseId);
    if (error) return json(500, { error: `Falha ao aprovar automaticamente: ${error.message}` });

    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "approved",
      approver_name: "Sistema",
      approver_email: null,
      level_order: 0,
      remarks: "Aprovado automaticamente pela regra de aprovação aplicada.",
    } as any);

    runAfterResponse(dispatchApprovedExpense(
      expenseId,
      String(current.doc_type || "purchase"),
      current.origin,
      !!current.sap_doc_entry,
    ));

    return json(200, {
      ok: true,
      auto_approved: true,
      expense: { ...current, status: "aprovado", current_level_order: 0, current_approver: null },
    });
  }

  // Recompute approver with self-approval guard on submit.
  let resolvedLevel = current.current_level_order || 1;
  let resolvedApprover: string | null = current.current_approver || null;
  let fallbackUsed = false;
  let matrixGapOnSubmit = false;
  if (current.approval_rule_id) {
    const picked = await resolveApproverWithEscalation(admin, current.approval_rule_id, {
      companyDb: String(current.company_db || ""),
      docType: String(current.doc_type || "purchase"),
      totalAmount: Number(current.total_amount || 0),
      costCenter: current.cost_center,
      project: current.project,
      requesterName: current.requester_name,
      requesterEmail: current.requester_email,
      supplierName: current.supplier_name,
      supplierCode: current.supplier_code,
      currency: current.currency,
    }, resolvedLevel);
    resolvedLevel = picked.level_order;
    resolvedApprover = picked.approver_name || resolvedApprover;
    fallbackUsed = picked.fallback_used;
  } else {
    resolvedApprover = MATRIX_FALLBACK_APPROVER.name;
    resolvedLevel = 1;
    matrixGapOnSubmit = true;
  }

  const { error } = await admin
    .from("expenses")
    .update({
      status: "pendente_aprovacao",
      current_level_order: resolvedLevel,
      current_approver: resolvedApprover,
    })
    .eq("id", expenseId);
  if (error) return json(500, { error: `Falha ao submeter: ${error.message}` });

  await admin.from("expense_approval_log").insert({
    expense_id: expenseId,
    decision: "submitted",
    approver_name: caller.identity,
    approver_email: caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
    level_order: resolvedLevel,
    remarks: matrixGapOnSubmit
      ? `Sem regra de aprovação aplicável (lacuna na matriz) — direcionado para ${MATRIX_FALLBACK_APPROVER.name}.`
      : fallbackUsed
      ? `Solicitante coincide com o(s) aprovador(es) da regra — direcionado para ${SELF_APPROVAL_FALLBACK.name}.`
      : null,
  } as any);

  if (matrixGapOnSubmit) {
    await notifyMatrixGap({
      companyDb: String(current.company_db || ""),
      docType: String(current.doc_type || "purchase"),
      expenseId,
      costCenter: current.cost_center,
      project: current.project,
      totalAmount: Number(current.total_amount || 0),
      currency: current.currency,
      requester: current.requester_name,
      reason: "Submissão sem regra de aprovação aplicável",
    });
  }



  return json(200, { ok: true, expense: current });
}

async function actionCancel(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.identity && !caller.isCloudAdmin) return json(401, { error: "Não autenticado" });
  const expenseId = String(body?.expense_id || "");
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });

  const res = await loadExpenseForOwner(admin, expenseId);
  if ("error" in res) return json(res.error === "Despesa não encontrada" ? 404 : 500, { error: res.error });
  const current = res.data as any;

  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;
  if (!isPrivileged && !isOwner(caller.identity || "", current)) {
    return json(403, { error: "Você não pode cancelar esta despesa" });
  }
  const alreadyInSap = !!(current.sap_doc_entry || current.sap_doc_num);
  const cancellableStatuses = new Set(["rascunho", "pendente_aprovacao"]);
  // Documento já integrado ao ERP e ainda SEM NF de entrada: o cancelamento no
  // ERP Flow precisa ser propagado ao ERP (cancelamento do pedido de compra).
  const integratedCancellable = alreadyInSap && (current.status === "aprovado" || current.status === "pc_lancado");
  if (!cancellableStatuses.has(current.status) && !integratedCancellable) {
    return json(409, { error: `Despesa em status ${current.status} não pode ser cancelada aqui.` });
  }

  if (integratedCancellable) {
    // Bloqueia se já existe NF de entrada (esboço ou lançada) para o pedido.
    const { data: nfRows } = await admin
      .from("nf_entrada_imports")
      .select("status, sap_invoice_draft_id")
      .eq("expense_id", expenseId);
    const nfPosted = (nfRows || []).some((r: any) =>
      r.sap_invoice_draft_id || ["awaiting_invoice", "completed"].includes(String(r.status))
    );
    if (nfPosted) {
      return json(409, {
        error: "Já existe NF de entrada lançada no ERP para este pedido — cancele a NF no ERP antes.",
      });
    }

    const docEntry = Number(current.sap_doc_entry || 0);
    if (!docEntry) {
      return json(409, {
        error: "Pedido integrado sem DocEntry no ERP — cancele manualmente no ERP antes.",
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let sapOk = false;
    let sapMsg = "";
    try {
      const r = await fetch(`${url}/functions/v1/sap-cancel-purchase-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          companyDb: current.company_db,
          docEntries: [docEntry],
          finalStatus: "cancelado",
          reason: `Cancelado no ERP Flow por ${caller.identity || caller.email || "usuário"}`,
        }),
      });
      const out = await r.json().catch(() => ({}));
      const first = Array.isArray(out?.results) ? out.results[0] : null;
      sapOk = !!out?.success && !!first?.ok;
      sapMsg = String(first?.body || out?.error || "");
    } catch (e) {
      sapMsg = e instanceof Error ? e.message : String(e);
    }

    if (!sapOk) {
      return json(502, {
        error: `Não foi possível cancelar o pedido no ERP${sapMsg ? `: ${sapMsg}` : ""}. O documento segue ativo no ERP Flow.`,
      });
    }

    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "cancelled",
      approver_name: caller.identity,
      approver_email: caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
      remarks: `Cancelamento propagado ao ERP (PC ${current.sap_doc_num || docEntry}).`,
    } as any);

    return json(200, { ok: true, sap_cancelled: true });
  }

  const { error } = await admin.from("expenses").update({ status: "cancelado" }).eq("id", expenseId);
  if (error) return json(500, { error: `Falha ao cancelar: ${error.message}` });

  await admin.from("expense_approval_log").insert({
    expense_id: expenseId,
    decision: "cancelled",
    approver_name: caller.identity,
    approver_email: caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
  } as any);

  return json(200, { ok: true });
}


/**
 * Reativa um documento cancelado, devolvendo-o para rascunho.
 * Permitido ao autor do documento (ou admin/super-usuário) e apenas quando o
 * documento nunca foi integrado ao ERP.
 */
async function actionReactivate(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.identity && !caller.isCloudAdmin) return json(401, { error: "Não autenticado" });
  const expenseId = String(body?.expense_id || "");
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });

  const res = await loadExpenseForOwner(admin, expenseId);
  if ("error" in res) return json(res.error === "Despesa não encontrada" ? 404 : 500, { error: res.error });
  const current = res.data as any;

  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;
  if (!isPrivileged && !isOwner(caller.identity || "", current)) {
    return json(403, { error: "Apenas o autor do documento pode reativá-lo" });
  }
  if (current.status !== "cancelado") {
    return json(409, { error: `Despesa em status ${current.status} não pode ser reativada.` });
  }
  if (current.sap_doc_entry || current.sap_doc_num) {
    return json(409, { error: "Documento já integrado ao ERP não pode ser reativado." });
  }

  const { error } = await admin
    .from("expenses")
    .update({
      status: "rascunho",
      current_approver: null,
      current_level_order: 1,
      sap_integration_error: null,
    })
    .eq("id", expenseId);
  if (error) return json(500, { error: `Falha ao reativar: ${error.message}` });

  await admin.from("expense_approval_log").insert({
    expense_id: expenseId,
    decision: "reactivated",
    approver_name: caller.identity,
    approver_email: caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
    remarks: "Documento cancelado reativado pelo autor — retornou para rascunho.",
  } as any);

  return json(200, { ok: true });
}

async function actionAttachmentsAdd(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.identity && !caller.isCloudAdmin) return json(401, { error: "Não autenticado" });
  const expenseId = String(body?.expense_id || "");
  const attachments: any[] = Array.isArray(body?.attachments) ? body.attachments : [];
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });
  if (attachments.length === 0) return json(200, { ok: true, inserted: 0 });

  const res = await loadExpenseForOwner(admin, expenseId);
  if ("error" in res) return json(res.error === "Despesa não encontrada" ? 404 : 500, { error: res.error });
  const current = res.data as any;

  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;
  if (!isPrivileged && !isOwner(caller.identity || "", current)) {
    return json(403, { error: "Você não pode anexar arquivos a esta despesa" });
  }

  // Documento integrado ao ERP continua aceitando NOVOS anexos (backfill) até
  // que a NF de entrada seja lançada. Depois disso, nada mais pode ser incluído.
  const attachBlocked = new Set(["nf_entrada", "pagamento", "finalizado", "cancelado", "rejeitado"]);
  if (attachBlocked.has(String(current.status))) {
    return json(409, {
      error: "Documento encerrado (NF de entrada lançada ou cancelado) — não é possível adicionar anexos.",
    });
  }

  const rows = attachments.map((a) => ({
    expense_id: expenseId,
    file_path: String(a.file_path || ""),
    file_name: String(a.file_name || ""),
    file_size: Number(a.file_size || 0),
    mime_type: String(a.mime_type || "application/octet-stream"),
  })).filter((r) => r.file_path && r.file_name);

  if (rows.length === 0) return json(400, { error: "Nenhum anexo válido" });

  // O gateway de upload já registra a linha; aqui só entram os que faltarem
  // (idempotência — evita anexo duplicado na tela).
  const { data: existing } = await admin
    .from("expense_attachments")
    .select("file_path")
    .eq("expense_id", expenseId)
    .in("file_path", rows.map((r) => r.file_path));
  const known = new Set(((existing || []) as any[]).map((r) => String(r.file_path)));
  const missing = rows.filter((r) => !known.has(r.file_path));
  if (missing.length === 0) return json(200, { ok: true, inserted: 0 });

  const { error } = await admin.from("expense_attachments").insert(missing as any);
  if (error) return json(500, { error: `Falha ao registrar anexos: ${error.message}` });
  return json(200, { ok: true, inserted: missing.length });
}

async function actionLogDecision(admin: SupabaseClient, caller: Caller, body: any) {
  if (!caller.identity && !caller.isCloudAdmin) return json(401, { error: "Não autenticado" });
  const expenseId = String(body?.expense_id || "");
  const decision = String(body?.decision || "");
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });
  if (!ALLOWED_LOG_DECISIONS.has(decision)) {
    return json(400, { error: `decision inválido: ${decision}` });
  }

  const res = await loadExpenseForOwner(admin, expenseId);
  if ("error" in res) return json(res.error === "Despesa não encontrada" ? 404 : 500, { error: res.error });
  const current = res.data as any;

  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;
  if (!isPrivileged && !isOwner(caller.identity || "", current)) {
    // Also allow the current approver (matches how approval logs are written)
    const approver = normalize(current.current_approver);
    const c = normalize(caller.identity);
    if (!c || (approver && approver !== c && emailPrefix(approver) !== emailPrefix(c))) {
      return json(403, { error: "Você não pode registrar log para esta despesa" });
    }
  }

  await admin.from("expense_approval_log").insert({
    expense_id: expenseId,
    decision,
    approver_name: caller.identity,
    approver_email: caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
    level_order: body?.levelOrder ?? null,
    remarks: body?.remarks ?? null,
  } as any);

  return json(200, { ok: true });
}

/* ─────────────── Idempotência da criação (pentest 3.4) ───────────────
 * Duas requisições "create" simultâneas (duplo clique, replay, corrida)
 * criavam dois pedidos. Aqui uma chave única — enviada pelo cliente em
 * `x-idempotency-key` ou derivada do conteúdo do pedido — é reservada de
 * forma atômica (PK do Postgres). A segunda chamada não executa a criação:
 * devolve a resposta da primeira ou 409 enquanto ela ainda está em curso.
 */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createFingerprint(caller: Caller, body: any): Promise<string> {
  const input = body?.input ?? {};
  const items = Array.isArray(input.items) ? input.items : [];
  return await sha256Hex(JSON.stringify({
    who: normalize(caller.identity),
    db: normalize(input.company_db || caller.companyDB),
    supplier: normalize(input.supplier_code || input.supplier_name),
    doc: normalize(input.doc_date),
    due: normalize(input.due_date),
    total: items.reduce((s: number, it: any) => s + Number(it.line_total || 0), 0),
    items: items.map((it: any) => [it.item_code, it.quantity, it.unit_price, it.cost_center, it.project]),
  }));
}

async function runCreateOnce(admin: SupabaseClient, caller: Caller, body: any, req: Request, depth = 0) {
  const fingerprint = await createFingerprint(caller, body);
  const headerKey = (req.headers.get("x-idempotency-key") || "").trim().slice(0, 200);
  const key = headerKey || `fp:${fingerprint}`;

  const { error: claimErr } = await admin.from("expense_create_idempotency").insert({
    idempotency_key: key,
    caller_identity: normalize(caller.identity),
    company_db: String(body?.input?.company_db || caller.companyDB || "") || null,
    fingerprint,
  } as any);

  if (claimErr) {
    // 23505 = chave já reservada → requisição repetida.
    const { data: prev } = await admin
      .from("expense_create_idempotency")
      .select("expense_id, response, status_code, completed_at, created_at")
      .eq("idempotency_key", key)
      .maybeSingle();
    const row = prev as any;

    // A chave é derivada do conteúdo do pedido. Se o documento anterior deixou
    // de existir ou foi cancelado/rejeitado, o usuário está legitimamente
    // recriando o mesmo pedido: libera a chave em vez de devolver o documento
    // morto (que depois recusava os anexos).
    const releaseAndRetry = async () => {
      await admin.from("expense_create_idempotency").delete().eq("idempotency_key", key);
      if (depth >= 1) {
        return json(409, {
          error: "Não foi possível concluir a criação. Tente novamente em instantes.",
        });
      }
      return await runCreateOnce(admin, caller, body, req, depth + 1);
    };

    if (row?.completed_at && row?.response) {
      const prevId = row.expense_id ? String(row.expense_id) : "";
      if (!prevId) return await releaseAndRetry();
      const { data: prevExpense } = await admin
        .from("expenses")
        .select("id, status")
        .eq("id", prevId)
        .maybeSingle();
      const prevStatus = String((prevExpense as any)?.status || "");
      if (!prevExpense || prevStatus === "cancelado" || prevStatus === "rejeitado") {
        return await releaseAndRetry();
      }
      return json(Number(row.status_code) || 200, row.response);
    }

    // Reserva em curso mas travada (função caiu no meio): libera após 5 min.
    const claimedAt = row?.created_at ? Date.parse(String(row.created_at)) : NaN;
    if (Number.isFinite(claimedAt) && Date.now() - claimedAt > 5 * 60 * 1000) {
      return await releaseAndRetry();
    }

    return json(409, {
      error: "Este pedido já está sendo criado. Aguarde a confirmação antes de tentar novamente.",
    });
  }


  let res: Response;
  try {
    res = await actionCreate(admin, caller, body);
  } catch (e) {
    await admin.from("expense_create_idempotency").delete().eq("idempotency_key", key);
    throw e;
  }

  const clone = res.clone();
  let payload: unknown = null;
  try { payload = await clone.json(); } catch { /* ignore */ }
  if (res.status >= 400) {
    // Falha: libera a chave para permitir nova tentativa legítima.
    await admin.from("expense_create_idempotency").delete().eq("idempotency_key", key);
    return res;
  }
  await admin
    .from("expense_create_idempotency")
    .update({
      expense_id: (payload as any)?.expense?.id ?? (payload as any)?.id ?? null,
      response: payload as any,
      status_code: res.status,
      completed_at: new Date().toISOString(),
    } as any)
    .eq("idempotency_key", key);
  return res;
}

/* ───────────────────────── HTTP entry ───────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: any = {};
  try { body = await req.json(); } catch { return json(400, { error: "Corpo inválido" }); }

  const action = String(body?.action || "");
  if (action === "version") return json(200, { ok: true, version: FUNCTION_VERSION });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let caller: Caller;
  try {
    caller = await identifyCaller(req, admin);
  } catch (e) {
    if (e instanceof AuthError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
  if (!caller.identity && !caller.isCloudAdmin) {
    return json(401, { error: "Não autenticado (SAP session ou Cloud admin necessário)" });
  }

  // Limite por usuário nas ações de escrita (pentest 3.4).
  const rl = await enforceRateLimit(admin, {
    scope: `expense-mutation:${action || "unknown"}`,
    identifier: normalize(caller.identity) || "cloud-admin",
    max: action === "create" ? 20 : 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return json(429, {
      error: "Muitas requisições. Aguarde alguns instantes antes de tentar novamente.",
      retry_after: rl.retryAfter,
    });
  }

  try {
    switch (action) {
      case "create":          return await runCreateOnce(admin, caller, body, req);
      case "update":          return await actionUpdate(admin, caller, body);
      case "submit":          return await actionSubmit(admin, caller, body);
      case "cancel":          return await actionCancel(admin, caller, body);
      case "reactivate":      return await actionReactivate(admin, caller, body);
      case "attachments_add": return await actionAttachmentsAdd(admin, caller, body);
      case "log_decision":    return await actionLogDecision(admin, caller, body);
      default: return json(400, { error: `Ação desconhecida: ${action}` });
    }
  } catch (e) {
    console.error("[expense-mutation] error", e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
