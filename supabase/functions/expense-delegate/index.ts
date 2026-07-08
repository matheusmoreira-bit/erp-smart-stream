// Delega/revoga a aprovação interna de uma despesa. Precisa rodar no
// servidor porque o RLS de `public.expenses` só permite UPDATE para admins
// autenticados via Cloud (auth.uid()); os usuários deste app se autenticam
// via SAP, então a atualização feita pelo cliente com a anon key era
// silenciosamente descartada — o card seguia mostrando o aprovador antigo
// mesmo com `audit_log` registrando a delegação.
//
// Autoriza:
//   - Cloud admin (JWT com role admin), ou
//   - SAP superuser / SAP admin mapeado (via requireAdminOrSapAdmin)
//
// Ações suportadas:
//   - "delegate": grava current_approver = novo delegado, preservando
//     original_approver na PRIMEIRA delegação. Registra audit_log
//     `delegate_approval` com o contexto vindo do cliente.
//   - "revoke":   restaura current_approver = original_approver, limpa
//     original_approver, registra `revoke_delegation`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdminOrSapAdmin, authErrorResponse } from "../_shared/auth.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let caller;
  try {
    caller = await requireAdminOrSapAdmin(req);
  } catch (e) {
    const r = authErrorResponse(e, corsHeaders);
    if (r) return r;
    return json(401, { error: "Não autenticado" });
  }

  let body: {
    action?: "delegate" | "revoke";
    expense_id?: string;
    new_approver_email?: string;
    new_approver_name?: string;
    reason?: string;
    doc_num?: string | number | null;
    doc_type?: string | null;
    card_name?: string | null;
    doc_total?: number | null;
    currency?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Corpo inválido (JSON malformado)." });
  }

  const action = body.action;
  const expenseId = String(body.expense_id || "").trim();
  if (!expenseId) return json(400, { error: "expense_id é obrigatório." });
  if (action !== "delegate" && action !== "revoke") {
    return json(400, { error: "action deve ser 'delegate' ou 'revoke'." });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Carrega estado atual para preservar/restaurar original_approver.
  const { data: exp, error: expErr } = await admin
    .from("expenses")
    .select("id, status, current_approver, original_approver, company_db")
    .eq("id", expenseId)
    .maybeSingle();
  if (expErr) return json(500, { error: `Falha ao carregar despesa: ${expErr.message}` });
  if (!exp) return json(404, { error: "Despesa não encontrada." });
  if ((exp as any).status !== "pendente_aprovacao") {
    return json(409, {
      error: `Despesa não está pendente de aprovação (status: ${(exp as any).status}).`,
    });
  }

  const companyDb = (exp as any).company_db as string | null;
  const previousApprover = (exp as any).current_approver as string | null;
  const currentOriginal = ((exp as any).original_approver as string | null) || null;

  if (action === "delegate") {
    const newApproverEmail = String(body.new_approver_email || "").trim();
    const newApproverName = String(body.new_approver_name || "").trim();
    const newApprover = newApproverEmail || newApproverName;
    if (!newApprover) return json(400, { error: "new_approver_email ou new_approver_name é obrigatório." });

    // Preserva o aprovador raiz apenas na primeira delegação.
    const originalToKeep = currentOriginal && currentOriginal.trim()
      ? currentOriginal
      : previousApprover;

    const { error: updErr } = await admin
      .from("expenses")
      .update({
        current_approver: newApprover,
        original_approver: originalToKeep,
        updated_at: new Date().toISOString(),
      })
      .eq("id", expenseId)
      .eq("status", "pendente_aprovacao");
    if (updErr) return json(500, { error: `Falha ao atualizar aprovador: ${updErr.message}` });

    await admin.from("audit_log").insert({
      actor_email: (caller as any).email || (caller as any).userName || null,
      action: "delegate_approval",
      entity_type: "expense",
      entity_id: expenseId,
      company_db: companyDb,
      details: {
        docNum: body.doc_num ?? null,
        docType: body.doc_type ?? null,
        cardName: body.card_name ?? null,
        docTotal: body.doc_total ?? null,
        currency: body.currency ?? null,
        previousApprover,
        newApproverName: newApproverName || null,
        newApproverEmail: newApproverEmail || null,
        reason: body.reason ?? null,
        delegatedBy: (caller as any).email || (caller as any).userName || null,
        isSuperUser: true,
        scope: "internal",
      },
    });

    return json(200, {
      ok: true,
      action: "delegate",
      current_approver: newApprover,
      original_approver: originalToKeep,
    });
  }

  // action === "revoke"
  const restored = (currentOriginal || "").trim();
  if (!restored) {
    return json(409, { error: "Sem aprovador original registrado — nada a revogar." });
  }

  const { error: updErr } = await admin
    .from("expenses")
    .update({
      current_approver: restored,
      original_approver: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expenseId)
    .eq("status", "pendente_aprovacao");
  if (updErr) return json(500, { error: `Falha ao revogar delegação: ${updErr.message}` });

  await admin.from("audit_log").insert({
    actor_email: (caller as any).email || (caller as any).userName || null,
    action: "revoke_delegation",
    entity_type: "expense",
    entity_id: expenseId,
    company_db: companyDb,
    details: {
      docNum: body.doc_num ?? null,
      docType: body.doc_type ?? null,
      cardName: body.card_name ?? null,
      docTotal: body.doc_total ?? null,
      currency: body.currency ?? null,
      revokedFrom: previousApprover,
      restoredApprover: restored,
      reason: body.reason ?? null,
      revokedBy: (caller as any).email || (caller as any).userName || null,
      isSuperUser: true,
      scope: "internal",
    },
  });

  return json(200, {
    ok: true,
    action: "revoke",
    current_approver: restored,
    original_approver: null,
  });
});
