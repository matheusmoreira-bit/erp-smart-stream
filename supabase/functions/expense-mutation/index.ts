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
//   - attachments_add    { expense_id, attachments[] } → after client uploads to storage
//   - log_decision       { expense_id, decision, remarks?, levelOrder? }
//
// approve / reject stay in expense-approval-action (they have their own
// approver-designation logic).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateSapSession, requireUser, AuthError } from "../_shared/auth.ts";
import { pickApproverSkippingRequester, SELF_APPROVAL_FALLBACK } from "../_shared/approval-skip.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  "created", "submitted", "cancelled", "integrated", "integration_failed",
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
  if (status === "pendente_aprovacao" && ruleId) {
    const { data: lvls } = await admin
      .from("approval_rule_levels")
      .select("level_order, approver_name, approver_email")
      .eq("rule_id", ruleId)
      .order("level_order", { ascending: true });
    const picked = pickApproverSkippingRequester(
      (lvls || []) as any,
      requesterName,
      requesterEmail,
      1,
    );
    resolvedApprover = picked.approver_name || resolvedApprover;
    resolvedApproverEmail = picked.approver_email;
    resolvedLevel = picked.level_order;
    fallbackUsed = picked.fallback_used;
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
      remarks: fallbackUsed
        ? `Solicitante coincide com o(s) aprovador(es) da regra — direcionado para ${SELF_APPROVAL_FALLBACK.name}.`
        : (resolvedLevel > 1
          ? `Nível(is) anterior(es) puladod(s): solicitante era o aprovador designado.`
          : null),
    } as any);
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

  // Regra de negócio: qualquer edição em documento que já saiu do rascunho
  // (pendente_aprovacao ou aprovado com erro de SAP) deve retornar ao fluxo
  // de aprovação a partir do nível 1, recomputando o aprovador designado.
  // Também dispara resubmit quando o tipo de rateio muda em rascunho (o
  // caminho de aprovação depende do rateio_type).
  const rateioChanged = !!input.rateio_changed;
  const shouldResubmit = status === "pendente_aprovacao" || editableForFix || (rateioChanged && status === "rascunho");
  let resubmittedApprover: string | null = null;
  let resubmittedLevel = 1;
  let resubmitFallbackUsed = false;
  if (shouldResubmit) {
    // Se rateio mudou, o cliente já resolveu a nova regra e o aprovador do nível 1.
    // Caso contrário, usa a regra atual da despesa.
    const nextRuleId = rateioChanged
      ? (input.new_approval_rule_id ?? null)
      : (current.approval_rule_id ?? null);
    const nextApproverFromClient = rateioChanged
      ? (input.new_current_approver ?? null)
      : null;

    if (rateioChanged) {
      updates.approval_rule_id = nextRuleId;
    }

    let resolvedLevel = 1;
    let resolvedApprover: string | null = nextApproverFromClient;
    let fallbackUsed = false;
    if (nextRuleId) {
      const { data: lvls } = await admin
        .from("approval_rule_levels")
        .select("level_order, approver_name, approver_email")
        .eq("rule_id", nextRuleId)
        .order("level_order", { ascending: true });
      const picked = pickApproverSkippingRequester(
        (lvls || []) as any,
        current.requester_name,
        current.requester_email,
        1,
      );
      resolvedLevel = picked.level_order;
      resolvedApprover = picked.approver_name || resolvedApprover;
      fallbackUsed = picked.fallback_used;
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

  if (shouldResubmit) {
    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "submitted",
      approver_name: caller.identity,
      approver_email: caller.email || (caller.identity && caller.identity.includes("@") ? caller.identity : null),
      level_order: resubmittedLevel,
      remarks: resubmitFallbackUsed
        ? `Reenviado após edição — solicitante coincide com aprovador(es); direcionado para ${SELF_APPROVAL_FALLBACK.name}.`
        : `Reenviado após edição — fluxo de aprovação reiniciado a partir do nível ${resubmittedLevel}.`,
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
  if (current.approval_rule_id) {
    const { data: lvls } = await admin
      .from("approval_rule_levels")
      .select("level_order, approver_name, approver_email")
      .eq("rule_id", current.approval_rule_id)
      .order("level_order", { ascending: true });
    const picked = pickApproverSkippingRequester(
      (lvls || []) as any,
      current.requester_name,
      current.requester_email,
      resolvedLevel,
    );
    resolvedLevel = picked.level_order;
    resolvedApprover = picked.approver_name || resolvedApprover;
    fallbackUsed = picked.fallback_used;
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
    remarks: fallbackUsed
      ? `Solicitante coincide com o(s) aprovador(es) da regra — direcionado para ${SELF_APPROVAL_FALLBACK.name}.`
      : null,
  } as any);

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

/* ───────────────────────── HTTP entry ───────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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

  try {
    switch (action) {
      case "create":          return await actionCreate(admin, caller, body);
      case "update":          return await actionUpdate(admin, caller, body);
      case "submit":          return await actionSubmit(admin, caller, body);
      case "cancel":          return await actionCancel(admin, caller, body);
      case "attachments_add": return await actionAttachmentsAdd(admin, caller, body);
      case "log_decision":    return await actionLogDecision(admin, caller, body);
      default: return json(400, { error: `Ação desconhecida: ${action}` });
    }
  } catch (e) {
    console.error("[expense-mutation] error", e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
