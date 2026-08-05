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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  if (candidateCcs.length === 0) return null;

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


function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  const status = String(input.status || "rascunho");
  const isAutoApproved = status === "aprovado" && AUTO_APPROVED_ORIGINS.has(origin);
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

  // If pendente_aprovacao and approval_rule_id provided, verify rule exists & is active.
  const ruleId = input.approval_rule_id ? String(input.approval_rule_id) : null;
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

  // Self-approval guard: when the requester matches the level's approver,
  // skip forward to the next level. If every level matches, fall back to
  // Juliana Gavineli (global validator, all companies).
  let resolvedApprover: string | null = input.current_approver || null;
  let resolvedApproverEmail: string | null = null;
  let resolvedLevel = 1;
  let fallbackUsed = false;
  let escalatedTo: string | null = null;
  let matrixGap = false;
  if (status === "pendente_aprovacao" && ruleId) {
    const picked = await resolveApproverWithEscalation(admin, ruleId, {
      companyDb,
      docType: String(input.doc_type || "purchase"),
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
    doc_type: input.doc_type || "purchase",
    doc_date: input.doc_date || null,
    due_date: input.due_date || null,
    rateio_type: input.rateio_type || null,
    nfse_split_mode:
      (input as { nfse_split_mode?: string }).nfse_split_mode === "per_brand" ? "per_brand" : "unified",
    sales_usage: (() => {
      const u = (input as { sales_usage?: unknown }).sales_usage;
      const s = u == null ? "" : String(u).trim();
      return s.length > 0 && s.length <= 20 ? s : null;
    })(),
    current_level_order: resolvedLevel || 1,
  };

  const { data: expense, error: expErr } = await admin
    .from("expenses")
    .insert(insertPayload as any)
    .select()
    .single();
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
    }));
    const { error: itemsErr } = await admin.from("expense_items").insert(rows as any);
    if (itemsErr) return json(500, { error: `Falha ao inserir itens: ${itemsErr.message}` });
  }

  await admin.from("expense_approval_log").insert({
    expense_id: expenseId,
    decision: "created",
    approver_name: caller.identity,
    approver_email: caller.email || (caller.identity.includes("@") ? caller.identity : null),
    remarks: input.remarks || null,
  } as any);
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
    await notifyMatrixGap({
      companyDb,
      docType: String(input.doc_type || "purchase"),
      expenseId,
      costCenter: input.cost_center || items[0]?.cost_center || null,
      project: input.project || items[0]?.project || null,
      totalAmount,
      currency: input.currency || "BRL",
      requester: requesterName,
      reason: "Nenhuma regra ativa casou com os critérios do documento",
    });
  }



  if (status === "pendente_aprovacao") {
    await notifyApprovalPending(admin, {
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
    });

  }


  return json(200, { ok: true, expense });
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
  if (alreadyInSap) {
    return json(409, {
      error: "Documento já integrado ao ERP — edição não permitida.",
    });
  }
  const editableForFix = status === "aprovado" && hasSapError && !alreadyInSap;
  if (status !== "rascunho" && status !== "pendente_aprovacao" && !editableForFix) {
    return json(409, {
      error: "Somente pedidos em rascunho, pendentes de aprovação ou aprovados com erro de integração podem ser alterados.",
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

  const items: any[] | undefined = Array.isArray(input.items) ? input.items : undefined;
  if (items && items.length > 0) {
    const totalAmount = items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    updates.total_amount = totalAmount;
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
    if (finalCount < 1) {
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
    editableForFix ||
    (attachmentsChanged && status === "pendente_aprovacao");
  let resubmittedApprover: string | null = null;
  let resubmittedLevel = 1;
  let resubmitFallbackUsed = false;

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

    if (nextRuleId) {
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
    updates.status = "pendente_aprovacao";
    updates.current_level_order = resolvedLevel;
    updates.current_approver = resolvedApprover;
    updates.sap_integration_error = null;
    resubmittedApprover = resolvedApprover;
    resubmittedLevel = resolvedLevel;
    resubmitFallbackUsed = fallbackUsed;
  }

  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
    if (upErr) return json(500, { error: `Falha ao atualizar: ${upErr.message}` });
  }

  if (items) {
    const { error: delErr } = await admin.from("expense_items").delete().eq("expense_id", expenseId);
    if (delErr) return json(500, { error: `Falha ao substituir itens: ${delErr.message}` });
    if (items.length > 0) {
      const rows = items.map((it) => ({
        expense_id: expenseId,
        item_code: it.item_code || null,
        description: it.description || "",
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        line_total: Number(it.line_total || 0),
        cost_center: it.cost_center || null,
        project: it.project || null,
        items_group_code: it.items_group_code ?? null,
        items_group_name: it.items_group_name ?? null,
      }));
      const { error: insErr } = await admin.from("expense_items").insert(rows as any);
      if (insErr) return json(500, { error: `Falha ao inserir itens: ${insErr.message}` });
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

  if (shouldResubmit || (attachmentsChanged && status === "pendente_aprovacao")) {
    // Motivo(s) que dispararam o reinício do fluxo — o log serve como
    // trilha de auditoria, então listamos TODOS os gatilhos aplicáveis.
    const reasons: string[] = [];
    if (rateioChanged) reasons.push("tipo de rateio alterado");
    if (editableForFix) reasons.push("correção após erro de integração SAP");
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
    const routingNote = resubmitFallbackUsed
      ? `Solicitante coincide com aprovador(es); direcionado para ${SELF_APPROVAL_FALLBACK.name}.`
      : `Fluxo de aprovação reiniciado a partir do nível ${resubmittedLevel}.`;

    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "submitted",
      approver_name: caller.identity,
      approver_email: caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
      level_order: resubmittedLevel,
      remarks: `Reenviado após edição. ${reasonNote} ${routingNote}${attachmentNote}`.trim(),
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
      resubmitted_to_approval: shouldResubmit,
      new_approver: resubmittedApprover,
    } as any,
  });

  return json(200, { ok: true, resubmitted: shouldResubmit, new_approver: resubmittedApprover });
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
  // Only cancel from rascunho / pendente_aprovacao — once approved/integrated,
  // cancellation must go through the SAP-cancel flow.
  if (current.status !== "rascunho" && current.status !== "pendente_aprovacao") {
    return json(409, { error: `Despesa em status ${current.status} não pode ser cancelada aqui.` });
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

  const { error } = await admin.from("expense_attachments").insert(rows as any);
  if (error) return json(500, { error: `Falha ao registrar anexos: ${error.message}` });
  return json(200, { ok: true, inserted: rows.length });
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

async function runCreateOnce(admin: SupabaseClient, caller: Caller, body: any, req: Request) {
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
      .select("expense_id, response, status_code, completed_at")
      .eq("idempotency_key", key)
      .maybeSingle();
    const row = prev as any;
    if (row?.completed_at && row?.response) {
      return json(Number(row.status_code) || 200, row.response);
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
