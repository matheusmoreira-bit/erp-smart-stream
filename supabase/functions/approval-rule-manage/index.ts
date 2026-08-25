// Escrita da matriz de alçadas (approval_rules / approval_rule_levels).
//
// A maior parte dos usuários autentica apenas via ERP (sem auth.uid()), e o RLS
// dessas tabelas só permite escrita para admins do Lovable Cloud — por isso o
// botão "Salvar Alterações" falhava silenciosamente. Aqui a autorização é feita
// no servidor (Cloud admin OU admin/superuser do SAP) e a gravação usa a
// service role, com registro em audit_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdminOrSapAdmin, authErrorResponse } from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

interface LevelInput {
  level_order?: number;
  approver_name?: string;
  approver_email?: string | null;
}

interface Body {
  action?: "create" | "update" | "toggle" | "delete";
  id?: string;
  company_db?: string;
  name?: string;
  priority?: number;
  doc_type?: string;
  criteria?: unknown;
  levels?: LevelInput[];
  is_active?: boolean;
  auto_approve?: boolean;
  actor?: string;
}

const DOC_TYPES = new Set(["both", "purchase", "sales", "advance"]);

function cleanLevels(levels: LevelInput[] | undefined) {
  return (levels || [])
    .map((l) => ({
      level_order: Number(l.level_order) || 1,
      approver_name: String(l.approver_name || "").trim(),
      approver_email: l.approver_email ? String(l.approver_email).trim() : null,
    }))
    .filter((l) => l.approver_name.length > 0)
    .slice(0, 100);
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  const corsHeaders = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let caller;
  try {
    caller = await requireAdminOrSapAdmin(req);
  } catch (err) {
    const resp = authErrorResponse(err, corsHeaders);
    if (resp) return resp;
    return json(500, { error: "Falha ao autenticar." });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Corpo inválido (JSON malformado)." });
  }

  const action = body.action;
  if (!action || !["create", "update", "toggle", "delete"].includes(action)) {
    return json(400, { error: "action deve ser create, update, toggle ou delete." });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const actor = String(body.actor || caller.email || "desconhecido").slice(0, 200);
  const companyDb = String(body.company_db || "").trim() || null;
  const docType = DOC_TYPES.has(String(body.doc_type)) ? String(body.doc_type) : "both";
  const name = String(body.name || "").trim().slice(0, 300);
  const priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0;
  const autoApprove = body.auto_approve === true;

  const logAudit = async (act: string, entityId: string, details: Record<string, unknown>) => {
    try {
      await admin.rpc("insert_audit_log", {
        p_action: act,
        p_entity_type: "approval_rule",
        p_entity_id: entityId,
        p_actor_email: actor,
        p_company_db: companyDb,
        p_details: details,
      });
    } catch { /* auditoria nunca bloqueia a operação */ }
  };

  if (action === "create") {
    if (!name) return json(400, { error: "Informe o nome da regra." });
    if (!companyDb) return json(400, { error: "Empresa não informada." });
    const levels = cleanLevels(body.levels);
    if (!autoApprove && levels.length === 0) return json(400, { error: "Adicione ao menos um nível de aprovação." });

    const { data: rule, error } = await admin
      .from("approval_rules")
      .insert({
        name,
        auto_approve: autoApprove,
        priority,
        criteria: body.criteria ?? [],
        doc_type: docType,
        created_by: actor,
        company_db: companyDb,
      })
      .select()
      .single();
    if (error) return json(500, { error: `Falha ao criar regra: ${error.message}` });

    if (levels.length > 0) {
      const { error: lvlErr } = await admin
        .from("approval_rule_levels")
        .insert(levels.map((l) => ({ ...l, rule_id: rule.id })));
      if (lvlErr) return json(500, { error: `Falha ao gravar níveis: ${lvlErr.message}` });
    }

    await logAudit("create_approval_rule", rule.id, { name, doc_type: docType, auto_approve: autoApprove });
    return json(200, { rule });
  }

  const id = String(body.id || "").trim();
  if (!id) return json(400, { error: "id da regra é obrigatório." });

  if (action === "update") {
    if (!name) return json(400, { error: "Informe o nome da regra." });
    const levels = cleanLevels(body.levels);
    if (!autoApprove && levels.length === 0) return json(400, { error: "Adicione ao menos um nível de aprovação." });

    const { data: updated, error } = await admin
      .from("approval_rules")
      .update({ name, auto_approve: autoApprove, priority, criteria: body.criteria ?? [], doc_type: docType })
      .eq("id", id)
      .select("id");
    if (error) return json(500, { error: `Falha ao salvar regra: ${error.message}` });
    if (!updated || updated.length === 0) return json(404, { error: "Regra não encontrada." });

    const { error: delErr } = await admin
      .from("approval_rule_levels")
      .delete()
      .eq("rule_id", id);
    if (delErr) return json(500, { error: `Falha ao atualizar níveis: ${delErr.message}` });

    if (levels.length > 0) {
      const { error: insErr } = await admin
        .from("approval_rule_levels")
        .insert(levels.map((l) => ({ ...l, rule_id: id })));
      if (insErr) return json(500, { error: `Falha ao gravar níveis: ${insErr.message}` });
    }

    await logAudit("update_approval_rule", id, { name, doc_type: docType, auto_approve: autoApprove });
    return json(200, { ok: true });
  }

  if (action === "toggle") {
    const isActive = body.is_active === true;
    const { error } = await admin
      .from("approval_rules")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) return json(500, { error: `Falha ao atualizar regra: ${error.message}` });
    await logAudit(isActive ? "enable_approval_rule" : "disable_approval_rule", id, {});
    return json(200, { ok: true });
  }

  // delete
  const { error } = await admin.from("approval_rules").delete().eq("id", id);
  if (error) return json(500, { error: `Falha ao excluir regra: ${error.message}` });
  await logAudit("delete_approval_rule", id, {});
  return json(200, { ok: true });
});
