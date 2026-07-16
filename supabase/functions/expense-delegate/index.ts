// Delega/revoga a aprovação interna de uma despesa. Precisa rodar no
// servidor porque o RLS de `public.expenses` só permite UPDATE para admins
// autenticados via Cloud (auth.uid()); os usuários deste app se autenticam
// via SAP, então a atualização feita pelo cliente com a anon key era
// silenciosamente descartada.
//
// Autoriza:
//   - Cloud admin (JWT com role admin), OU
//   - SAP superuser / SAP admin mapeado, OU
//   - Qualquer aprovador designado do documento (nível atual da regra ou
//     o `current_approver` vigente após uma delegação anterior). Isso
//     permite que o próprio responsável pelo documento repasse a
//     aprovação sem depender do super-admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, validateSapSession, AuthError } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
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
function emailPrefix(email: string): string {
  const e = normalize(email);
  const i = e.indexOf("@");
  return i > 0 ? e.slice(0, i) : e;
}
function tokenize(s: string): string[] {
  return normalize(s).replace(/[._\-@]+/g, " ").split(/\s+/).filter(Boolean);
}
function isDesignatedApprover(
  caller: string,
  approverName: string | null,
  approverEmail: string | null,
): boolean {
  const c = normalize(caller);
  if (!c) return false;
  const ae = normalize(approverEmail);
  if (ae) {
    if (c === ae) return true;
    if (emailPrefix(c) === emailPrefix(ae) && emailPrefix(ae).length > 0) return true;
  }
  const nameTokens = tokenize(approverName || "");
  const callerTokens = tokenize(caller);
  if (nameTokens.length === 0 || callerTokens.length === 0) return false;
  const allIn = callerTokens.every((t) => nameTokens.includes(t));
  if (!allIn) return false;
  if (callerTokens.length >= 2) return true;
  return nameTokens.length === 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

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

  // ── Identify caller (Cloud JWT ou sessão SAP) ─────────────────────────
  let callerIdentity: string | null = null;
  let callerEmail: string | null = null;
  let isCloudAdmin = false;
  let isSapAdmin = false;

  try {
    const cloudUser = await requireUser(req);
    callerEmail = cloudUser.email || null;
    callerIdentity = cloudUser.email || null;
    const { data: hasAdmin } = await admin.rpc("has_role", {
      _user_id: cloudUser.id,
      _role: "admin",
    });
    if (hasAdmin === true) isCloudAdmin = true;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }

  const sap = await validateSapSession(req);
  if (sap) {
    if (!callerIdentity) callerIdentity = sap.userName;
    if (!callerEmail) callerEmail = sap.email;
    try {
      const { data: mappedAdmin } = await admin.rpc("is_sap_user_admin", {
        _sap_username: (sap.userName || "").toLowerCase(),
      });
      if (mappedAdmin === true) isSapAdmin = true;
    } catch {
      /* noop */
    }
    if (!isSapAdmin && (sap.userName || "").toLowerCase() === "manager") isSapAdmin = true;
  }

  if (!callerIdentity && !isCloudAdmin) {
    return json(401, {
      error:
        "Não autenticado — envie um JWT válido do Lovable Cloud ou os headers x-sap-* de uma sessão SAP ativa.",
    });
  }

  // ── Carrega despesa ───────────────────────────────────────────────────
  const { data: exp, error: expErr } = await admin
    .from("expenses")
    .select("id, status, current_approver, original_approver, company_db, approval_rule_id, current_level_order")
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
  const currentLevel = Number((exp as any).current_level_order || 1);

  // ── Autorização: admin/superuser OU aprovador designado ───────────────
  let isAuthorized = isCloudAdmin || isSapAdmin;

  if (!isAuthorized && callerIdentity) {
    // Override (delegação vigente) tem precedência sobre a regra.
    if (previousApprover && previousApprover.trim()) {
      const isEmail = previousApprover.includes("@");
      isAuthorized = isDesignatedApprover(
        callerIdentity,
        isEmail ? null : previousApprover,
        isEmail ? previousApprover : null,
      );
    }

    if (!isAuthorized && (exp as any).approval_rule_id) {
      const { data: lvls } = await admin
        .from("approval_rule_levels")
        .select("level_order, approver_name, approver_email")
        .eq("rule_id", (exp as any).approval_rule_id);
      const rows = (lvls || []) as Array<{
        level_order: number;
        approver_name: string;
        approver_email: string | null;
      }>;
      const currentRows = rows.filter((l) => l.level_order === currentLevel);
      isAuthorized = currentRows.some((r) =>
        isDesignatedApprover(callerIdentity!, r.approver_name, r.approver_email),
      );
    }
  }

  if (!isAuthorized) {
    return json(403, {
      error:
        "Somente o aprovador responsável (ou um administrador) pode delegar este documento.",
    });
  }

  const actorLabel = callerEmail || callerIdentity || null;

  if (action === "delegate") {
    const newApproverEmail = String(body.new_approver_email || "").trim();
    const newApproverName = String(body.new_approver_name || "").trim();
    // Preferimos armazenar o NOME do delegado (ex.: "Douglas Vinicius") em
    // vez do e-mail, para exibir de forma legível no card e no histórico.
    const newApprover = newApproverName || newApproverEmail;
    if (!newApprover) {
      return json(400, { error: "new_approver_email ou new_approver_name é obrigatório." });
    }

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
      actor_email: actorLabel,
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
        delegatedBy: actorLabel,
        isSuperUser: isCloudAdmin || isSapAdmin,
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
    actor_email: actorLabel,
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
      revokedBy: actorLabel,
      isSuperUser: isCloudAdmin || isSapAdmin,
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
