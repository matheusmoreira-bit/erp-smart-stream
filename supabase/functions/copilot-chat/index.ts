import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
// Copilot IA (Backoffice) — chat com acesso ao banco + ações operacionais auditadas.
// Baseado no padrão ai-assistant + report-ai-chat (SSE streaming da resposta final).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ============================================================
// Tools schema (OpenAI-compatible function calling)
// ============================================================
const readTools = [
  {
    type: "function",
    function: {
      name: "list_companies",
      description: "Lista empresas cadastradas (company_db, nome, tipo ERP, status).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "query_expenses",
      description:
        "Consulta despesas/pedidos de compra. Filtre por company_db, status, requester_email, current_approver, doc_entry, período.",
      parameters: {
        type: "object",
        properties: {
          company_db: { type: "string" },
          status: { type: "string", description: "draft|submitted|in_approval|approved|rejected|integrated|integration_failed" },
          requester_email: { type: "string" },
          current_approver_email: { type: "string" },
          doc_entry: { type: "number" },
          expense_id: { type: "string" },
          days: { type: "number", description: "Últimos N dias" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "expense_detail",
      description: "Detalhe completo de uma despesa: itens, histórico de aprovação, integrações SAP, anexos.",
      parameters: {
        type: "object",
        properties: { expense_id: { type: "string" } },
        required: ["expense_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_approval_rules",
      description: "Regras de aprovação ativas por empresa/CC/projeto/faixa de valor, com níveis (alçadas).",
      parameters: {
        type: "object",
        properties: {
          company_db: { type: "string" },
          cost_center: { type: "string" },
          project: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_pagcorp",
      description: "Transações PagCorp e status de integração/baixa.",
      parameters: {
        type: "object",
        properties: {
          company_db: { type: "string" },
          status: { type: "string" },
          days: { type: "number" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_integration_logs",
      description: "Últimos logs de integração (integration_log, nf_entrada_logs, pagcorp_integration_log, synapse_execution_log).",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "generic|nf_entrada|pagcorp|synapse" },
          company_db: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_audit_log",
      description: "Trilha de auditoria (audit_log).",
      parameters: {
        type: "object",
        properties: {
          actor_email: { type: "string" },
          action: { type: "string" },
          entity_type: { type: "string" },
          entity_id: { type: "string" },
          days: { type: "number" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_notifications",
      description: "Notificações enviadas / pendentes para um usuário.",
      parameters: {
        type: "object",
        properties: {
          user_identifier: { type: "string", description: "email ou uid" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_users",
      description: "Procura usuários SAP/colaboradores (user_code, e-mail, nome).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "describe_schema",
      description:
        "Descobre o schema real do banco: lista tabelas e colunas (nome + tipo). Use SEMPRE antes de escrever um run_sql_read sobre tabelas que você não conhece, ou quando um SELECT falhar por coluna inexistente.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Nome (ou parte) da tabela. Omita para listar todas as tabelas do schema public." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_sql_read",
      description:
        "Executa SELECT ad-hoc (somente leitura) via RPC pública. Use para cruzamentos, agregações e contagens que outras tools não cobrem. Uma única sentença SELECT, sempre com LIMIT.",
      parameters: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
        additionalProperties: false,
      },
    },
  },
];


// Ferramentas de ESCRITA: exigem `confirmed: true`. Sem isso, retornam um preview + pedem confirmação.
const writeTools = [
  {
    type: "function",
    function: {
      name: "redirect_approval",
      description:
        "Redireciona uma despesa em aprovação para outro aprovador. Grava audit_log e notifica o novo aprovador.",
      parameters: {
        type: "object",
        properties: {
          expense_id: { type: "string" },
          new_approver_email: { type: "string" },
          reason: { type: "string" },
          confirmed: { type: "boolean", description: "true para executar; false/omitir retorna preview" },
        },
        required: ["expense_id", "new_approver_email", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reprocess_sap_integration",
      description: "Reprocessa integração SAP (chama expense-integration-retry).",
      parameters: {
        type: "object",
        properties: {
          expense_id: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["expense_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reprocess_pagcorp_settlement",
      description: "Reprocessa baixa PagCorp travada (chama pagcorp-settlement-watcher para o payment_id).",
      parameters: {
        type: "object",
        properties: {
          integration_log_id: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["integration_log_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revert_expense_to_pending",
      description:
        "Reverte uma despesa aprovada para in_approval (uso raro; use quando fluxo migrou e precisa re-aprovar). Grava audit_log.",
      parameters: {
        type: "object",
        properties: {
          expense_id: { type: "string" },
          new_current_approver_email: { type: "string" },
          reason: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["expense_id", "new_current_approver_email", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_notification",
      description: "Envia notificação in-app para um usuário (via insert em notifications).",
      parameters: {
        type: "object",
        properties: {
          user_identifier: { type: "string", description: "email do usuário" },
          title: { type: "string" },
          body: { type: "string" },
          link: { type: "string" },
          category: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["user_identifier", "title", "body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_approval_rule",
      description: "Ativa/desativa uma regra de aprovação (approval_rules.is_active).",
      parameters: {
        type: "object",
        properties: {
          rule_id: { type: "string" },
          is_active: { type: "boolean" },
          reason: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["rule_id", "is_active", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_approval_rule",
      description:
        "Cria ou atualiza uma regra de aprovação simples (uma faixa, uma lista de aprovadores em níveis). " +
        "Para uploads em massa, prefira orientar o usuário a rodar SQL via canal auditado.",
      parameters: {
        type: "object",
        properties: {
          rule_id: { type: "string", description: "omita para criar" },
          company_db: { type: "string" },
          name: { type: "string" },
          cost_center: { type: "string" },
          project: { type: "string" },
          doc_type: { type: "string" },
          min_value: { type: "number" },
          max_value: { type: "number" },
          priority: { type: "number" },
          approvers_emails: { type: "array", items: { type: "string" }, description: "ordem = AP1..APn" },
          confirmed: { type: "boolean" },
        },
        required: ["company_db", "name", "approvers_emails"],
        additionalProperties: false,
      },
    },
  },
];

const tools = [...readTools, ...writeTools];

// ============================================================
// Tool runner
// ============================================================
type Actor = { userId: string; email: string };

async function audit(sb: SupabaseClient, actor: Actor, action: string, entity_type: string, entity_id: string | null, details: any) {
  await sb.from("audit_log").insert({
    actor_id: actor.userId,
    actor_email: actor.email,
    action,
    entity_type,
    entity_id,
    details,
  });
}

function requireConfirmation(args: any, summary: string) {
  return {
    _pending_confirmation: true,
    summary,
    hint: "Reenvie a chamada com `confirmed: true` para executar.",
    args,
  };
}

async function resolveCompanyDb(sb: SupabaseClient, input?: string): Promise<string | undefined> {
  if (!input) return undefined;
  const raw = String(input).trim();
  const { data: exact } = await sb.from("companies").select("company_db").eq("company_db", raw).maybeSingle();
  if (exact?.company_db) return exact.company_db;
  const { data } = await sb.from("companies").select("company_db, name").or(`company_db.ilike.%${raw}%,name.ilike.%${raw}%`).limit(2);
  if (data && data.length === 1) return data[0].company_db;
  return raw; // fall back so caller sees empty result rather than silent remap
}

function ccMatches(pattern: string | null | undefined, input: string): boolean {
  if (!pattern) return true; // null cost_center = curinga
  if (pattern === input) return true;
  // convert SQL LIKE pattern to regex
  const rx = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$");
  return rx.test(input);
}

async function runTool(name: string, args: any, sb: SupabaseClient, actor: Actor): Promise<unknown> {
  switch (name) {
    // ============ READ ============
    case "list_companies": {
      const { data, error } = await sb.from("companies").select("company_db, name, erp_type, is_active").order("name");
      if (error) throw error;
      return data;
    }
    case "query_expenses": {
      let q = sb.from("expenses")
        .select("id, doc_entry, company_db, supplier_name, requester_name, requester_email, total_amount, currency, status, current_approver, current_approver_email, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(Number(args.limit || 25));
      if (args.company_db) q = q.eq("company_db", (await resolveCompanyDb(sb, args.company_db))!);
      if (args.status) q = q.eq("status", args.status);
      if (args.requester_email) q = q.ilike("requester_email", args.requester_email);
      if (args.current_approver_email) q = q.ilike("current_approver_email", args.current_approver_email);
      if (args.doc_entry) q = q.eq("doc_entry", args.doc_entry);
      if (args.expense_id) q = q.eq("id", args.expense_id);
      if (args.days) q = q.gte("created_at", new Date(Date.now() - Number(args.days) * 86400000).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "expense_detail": {
      const id = String(args.expense_id);
      const [{ data: exp }, { data: items }, { data: history }, { data: attachments }] = await Promise.all([
        sb.from("expenses").select("*").eq("id", id).maybeSingle(),
        sb.from("expense_items").select("*").eq("expense_id", id).order("line_num"),
        sb.from("expense_approval_log").select("*").eq("expense_id", id).order("created_at"),
        sb.from("expense_attachments").select("id, filename, size_bytes, mime_type, created_at").eq("expense_id", id),
      ]);
      return { expense: exp, items, history, attachments };
    }
    case "query_approval_rules": {
      const companyDb = await resolveCompanyDb(sb, args.company_db);
      let q = sb.from("approval_rules").select("*").eq("is_active", true).order("priority", { ascending: false });
      if (companyDb) q = q.eq("company_db", companyDb);
      if (args.project) q = q.ilike("project", `%${args.project}%`);
      const { data: rulesRaw, error } = await q;
      if (error) throw error;
      let rules = rulesRaw || [];
      if (args.cost_center) {
        const cc = String(args.cost_center).trim();
        rules = rules.filter((r: any) => ccMatches(r.cost_center, cc));
      }
      const ids = rules.map((r: any) => r.id);
      const { data: levels } = ids.length
        ? await sb.from("approval_rule_levels").select("*").in("rule_id", ids).order("level_order")
        : { data: [] as any[] };
      return {
        resolved_company_db: companyDb,
        matched_count: rules.length,
        rules: rules.map((r: any) => ({ ...r, levels: (levels || []).filter((l: any) => l.rule_id === r.id) })),
      };
    }
    case "query_pagcorp": {
      let q = sb.from("pagcorp_integration_log")
        .select("id, company_db, status, payment_id, doc_entry, event_type, currency, amount, error_message, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(Number(args.limit || 25));
      if (args.company_db) q = q.eq("company_db", args.company_db);
      if (args.status) q = q.eq("status", args.status);
      if (args.days) q = q.gte("created_at", new Date(Date.now() - Number(args.days) * 86400000).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "query_integration_logs": {
      const source = String(args.source || "generic");
      const limit = Number(args.limit || 25);
      const table = source === "nf_entrada" ? "nf_entrada_logs"
        : source === "pagcorp" ? "pagcorp_integration_log"
        : source === "synapse" ? "synapse_execution_log"
        : "integration_log";
      let q = sb.from(table).select("*").order("created_at", { ascending: false }).limit(limit);
      if (args.company_db) q = q.eq("company_db", args.company_db);
      if (args.status) q = q.eq("status", args.status);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "query_audit_log": {
      let q = sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(Number(args.limit || 25));
      if (args.actor_email) q = q.ilike("actor_email", args.actor_email);
      if (args.action) q = q.eq("action", args.action);
      if (args.entity_type) q = q.eq("entity_type", args.entity_type);
      if (args.entity_id) q = q.eq("entity_id", args.entity_id);
      if (args.days) q = q.gte("created_at", new Date(Date.now() - Number(args.days) * 86400000).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "query_notifications": {
      const ids = [args.user_identifier].filter(Boolean);
      const { data, error } = await sb.from("notifications")
        .select("id, user_identifier, title, body, is_read, category, link, created_at")
        .in("user_identifier", ids)
        .order("created_at", { ascending: false })
        .limit(Number(args.limit || 30));
      if (error) throw error;
      return data;
    }
    case "search_users": {
      const q = String(args.query || "").trim();
      if (!q) return [];
      const [ul, cp] = await Promise.all([
        sb.from("user_licenses").select("user_code, user_name, company_db, license_type, is_locked")
          .or(`user_code.ilike.%${q}%,user_name.ilike.%${q}%`).limit(30),
        sb.from("collaborator_profiles").select("email, full_name, cost_center, department, phone")
          .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`).limit(30),
      ]);
      return { user_licenses: ul.data || [], collaborators: cp.data || [] };
    }
    case "describe_schema": {
      const t = String(args.table || "").trim().replace(/[^a-zA-Z0-9_%]/g, "");
      const sql = t
        ? `select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name ilike '%${t}%' order by table_name, ordinal_position limit 400`
        : `select table_name, count(*)::int as columns from information_schema.columns where table_schema = 'public' group by table_name order by table_name limit 400`;
      const { data, error } = await sb.rpc("copilot_read_query", { p_sql: sql });
      if (error) return { error: error.message };
      return data;
    }
    case "run_sql_read": {

      const sql = String(args.sql || "").trim();
      if (!/^select\b/i.test(sql) || /;\s*\S/.test(sql)) {
        return { error: "Somente uma sentença SELECT é permitida." };
      }
      // Depende de RPC 'copilot_read_query' criada por migration (SECURITY DEFINER, apenas admins).
      const { data, error } = await sb.rpc("copilot_read_query", { p_sql: sql });
      if (error) return { error: error.message };
      return data;
    }

    // ============ WRITE ============
    case "redirect_approval": {
      if (!args.confirmed) {
        return requireConfirmation(args, `Redirecionar despesa ${args.expense_id} para ${args.new_approver_email}. Motivo: ${args.reason}`);
      }
      const { data: exp } = await sb.from("expenses").select("id, company_db, current_approver, current_approver_email, supplier_name, total_amount")
        .eq("id", args.expense_id).maybeSingle();
      if (!exp) return { error: "Despesa não encontrada." };
      // Resolve nome pelo email
      const { data: prof } = await sb.from("collaborator_profiles").select("full_name").ilike("email", args.new_approver_email).maybeSingle();
      const newName = prof?.full_name || args.new_approver_email;
      const { error: upErr } = await sb.from("expenses").update({
        current_approver: newName,
        current_approver_email: args.new_approver_email.toLowerCase(),
        updated_at: new Date().toISOString(),
      }).eq("id", args.expense_id);
      if (upErr) return { error: upErr.message };
      await sb.from("notifications").insert({
        user_identifier: args.new_approver_email.toLowerCase(),
        title: "Aprovação redirecionada para você",
        body: `Despesa ${exp.supplier_name} (${exp.total_amount}) foi redirecionada. Motivo: ${args.reason}`,
        category: "approval",
        link: `/aprovacoes?id=${args.expense_id}`,
      });
      await audit(sb, actor, "copilot.redirect_approval", "expense", args.expense_id, {
        from: exp.current_approver_email, to: args.new_approver_email, reason: args.reason,
      });
      return { ok: true, redirected_from: exp.current_approver_email, redirected_to: args.new_approver_email };
    }
    case "reprocess_sap_integration": {
      if (!args.confirmed) return requireConfirmation(args, `Reprocessar integração SAP da despesa ${args.expense_id}.`);
      const resp = await sb.functions.invoke("expense-integration-retry", { body: { expense_id: args.expense_id } });
      await audit(sb, actor, "copilot.reprocess_sap", "expense", args.expense_id, { result: resp.data, error: resp.error?.message });
      return { ok: !resp.error, data: resp.data, error: resp.error?.message };
    }
    case "reprocess_pagcorp_settlement": {
      if (!args.confirmed) return requireConfirmation(args, `Reprocessar baixa PagCorp (log ${args.integration_log_id}).`);
      const { data: log } = await sb.from("pagcorp_integration_log").select("*").eq("id", args.integration_log_id).maybeSingle();
      if (!log) return { error: "Log PagCorp não encontrado." };
      await sb.from("pagcorp_integration_log").update({
        status: "awaiting_settlement",
        retry_after: null,
        updated_at: new Date().toISOString(),
      }).eq("id", args.integration_log_id);
      const resp = await sb.functions.invoke("pagcorp-settlement-watcher", { body: { company_db: log.company_db, force_ids: [args.integration_log_id] } });
      await audit(sb, actor, "copilot.reprocess_pagcorp", "pagcorp_integration_log", args.integration_log_id, { result: resp.data, error: resp.error?.message });
      return { ok: !resp.error, data: resp.data, error: resp.error?.message };
    }
    case "revert_expense_to_pending": {
      if (!args.confirmed) return requireConfirmation(args, `Reverter despesa ${args.expense_id} para in_approval, novo aprovador: ${args.new_current_approver_email}. Motivo: ${args.reason}`);
      const { data: prof } = await sb.from("collaborator_profiles").select("full_name").ilike("email", args.new_current_approver_email).maybeSingle();
      const { error } = await sb.from("expenses").update({
        status: "in_approval",
        current_approver: prof?.full_name || args.new_current_approver_email,
        current_approver_email: args.new_current_approver_email.toLowerCase(),
        updated_at: new Date().toISOString(),
      }).eq("id", args.expense_id);
      if (error) return { error: error.message };
      await audit(sb, actor, "copilot.revert_to_pending", "expense", args.expense_id, { reason: args.reason, new_approver: args.new_current_approver_email });
      return { ok: true };
    }
    case "send_notification": {
      if (!args.confirmed) return requireConfirmation(args, `Enviar notificação "${args.title}" para ${args.user_identifier}.`);
      const { error } = await sb.from("notifications").insert({
        user_identifier: String(args.user_identifier).toLowerCase(),
        title: args.title,
        body: args.body,
        link: args.link || null,
        category: args.category || "copilot",
      });
      if (error) return { error: error.message };
      await audit(sb, actor, "copilot.send_notification", "notification", null, { to: args.user_identifier, title: args.title });
      return { ok: true };
    }
    case "toggle_approval_rule": {
      if (!args.confirmed) return requireConfirmation(args, `${args.is_active ? "Ativar" : "Desativar"} regra ${args.rule_id}. Motivo: ${args.reason}`);
      const { error } = await sb.from("approval_rules").update({ is_active: args.is_active }).eq("id", args.rule_id);
      if (error) return { error: error.message };
      await audit(sb, actor, "copilot.toggle_rule", "approval_rule", args.rule_id, { is_active: args.is_active, reason: args.reason });
      return { ok: true };
    }
    case "upsert_approval_rule": {
      if (!args.confirmed) {
        return requireConfirmation(args, `Upsert regra "${args.name}" em ${args.company_db} (${args.approvers_emails?.length || 0} níveis).`);
      }
      let ruleId = args.rule_id as string | undefined;
      if (ruleId) {
        const { error } = await sb.from("approval_rules").update({
          name: args.name, cost_center: args.cost_center, project: args.project, doc_type: args.doc_type,
          min_value: args.min_value, max_value: args.max_value, priority: args.priority,
        }).eq("id", ruleId);
        if (error) return { error: error.message };
      } else {
        const { data, error } = await sb.from("approval_rules").insert({
          company_db: args.company_db, name: args.name, cost_center: args.cost_center, project: args.project,
          doc_type: args.doc_type || "PurchaseOrder", min_value: args.min_value ?? 0, max_value: args.max_value ?? null,
          priority: args.priority ?? 100, is_active: true,
        }).select("id").maybeSingle();
        if (error) return { error: error.message };
        ruleId = data?.id;
      }
      if (!ruleId) return { error: "Falha ao obter rule_id." };
      // Substitui níveis
      await sb.from("approval_rule_levels").delete().eq("rule_id", ruleId);
      const levels = (args.approvers_emails as string[]).map((email, i) => ({
        rule_id: ruleId, level_order: i + 1, approver_email: email.toLowerCase(), approver_name: email,
      }));
      const { error: lvlErr } = await sb.from("approval_rule_levels").insert(levels);
      if (lvlErr) return { error: lvlErr.message };
      await audit(sb, actor, args.rule_id ? "copilot.update_rule" : "copilot.create_rule", "approval_rule", ruleId, { args });
      return { ok: true, rule_id: ruleId };
    }
    default:
      return { error: `Tool desconhecida: ${name}` };
  }
}

// ============================================================
// System prompt
// ============================================================
function buildSystemPrompt(actorEmail: string) {
  const now = new Date();
  const today = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return `Você é o Copiloto Operacional do ERP Flow (Backoffice). Você atende administradores do sistema e age como um engenheiro de suporte sênior: investiga de verdade, cruza dados e resolve.

CONTEXTO
- Data/hora atual (America/Sao_Paulo): ${today}
- Administrador logado: ${actorEmail}
- Banco: PostgreSQL (Supabase). Você tem leitura ampla via tools e SQL (SELECT) e um conjunto de ações de escrita auditadas.

MÉTODO DE TRABALHO (obrigatório)
1. Entenda o pedido. Se for ambíguo em UM ponto crítico, faça UMA pergunta objetiva — caso contrário assuma o cenário mais provável, diga a suposição e siga.
2. NUNCA responda "não consigo" ou "não tenho acesso" antes de tentar. Você tem \`describe_schema\` + \`run_sql_read\`: quase toda pergunta sobre dados é respondível.
3. Investigue em profundidade: encadeie várias tools na mesma resposta. Consultou e veio vazio? Mude a hipótese (nome parcial, período maior, outra tabela, sem filtro de empresa) e tente de novo antes de concluir "não há registros".
4. Ao usar \`run_sql_read\`: se não tiver certeza das colunas, chame \`describe_schema\` primeiro. Se o SELECT falhar, LEIA a mensagem de erro, corrija e refaça — até 3 tentativas antes de reportar.
5. Não invente números, IDs, e-mails, nomes de tabela ou status. Tudo vem de tool.

QUALIDADE DA RESPOSTA
- Português do Brasil, markdown. Tabelas para listas, moeda em BRL (R$ 1.234,56), datas DD/MM/YYYY HH:mm.
- Comece pela conclusão (1-3 linhas), depois a evidência (tabela/dados), depois próximos passos quando fizer sentido.
- Cite identificadores úteis (expense_id, doc_entry, company_db) para o admin conseguir agir.
- Nada de encher linguiça: sem repetir o enunciado, sem disclaimers genéricos.
- Referencie pessoas pelo NOME quando disponível, não pelo e-mail cru.

MAPA DO DOMÍNIO
- \`expenses\` = pedidos de compra/venda do ERP Flow (status: draft, submitted, in_approval, approved, rejected, integrated, integration_failed); itens em \`expense_items\`; histórico em \`expense_approval_log\`; anexos em \`expense_attachments\`.
- Alçadas: \`approval_rules\` (+ \`approval_rule_levels\`, AP1..APn por \`level_order\`). \`cost_center\` pode ser wildcard SQL LIKE (ex: \`1.8.%\`) ou NULL (= curinga).
- Integrações: \`integration_log\` (SAP genérico), \`nf_entrada_logs\`, \`pagcorp_integration_log\` (cartão corporativo), \`synapse_execution_log\`.
- Pessoas: \`collaborator_profiles\` (e-mail, nome, CC, depto), \`user_licenses\` (usuários SAP).
- Empresas: \`companies\` — o usuário fala "OpenGaming", "Cactus", "Instituto"; o \`company_db\` real é tipo \`open_gaming_sa\`, \`SBO_CACTUS\`. Em dúvida, chame \`list_companies\`.

AÇÕES DE ESCRITA (redirect_approval, reprocess_*, revert_*, send_notification, toggle_approval_rule, upsert_approval_rule)
a) Levante os dados reais antes.
b) Chame a tool SEM \`confirmed\` para gerar o preview e apresente-o ao usuário pedindo confirmação explícita.
c) Só execute com \`confirmed: true\` depois de o usuário confirmar em texto.
d) Toda escrita é auditada em \`audit_log\`; registre o motivo informado.
Se uma ação falhar, mostre o erro exato e proponha o próximo passo concreto.`;
}

// Modelos: primário forte + fallbacks se o gateway recusar/falhar.
const MODEL_CHAIN = ["openai/gpt-5.5", "google/gemini-3.1-pro-preview", "google/gemini-3.6-flash"];

type GatewayStep = {
  content: string;
  toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
};

// Chama o gateway com stream:true, repassa os deltas de texto ao cliente
// e acumula tool_calls. Faz fallback de modelo em erro de gateway.
async function gatewayStep(
  conv: any[],
  emitText: (t: string) => void,
): Promise<GatewayStep> {
  let lastErr = "";
  for (const model of MODEL_CHAIN) {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: conv, tools, tool_choice: "auto", stream: true }),
    });

    if (!resp.ok || !resp.body) {
      lastErr = `${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 500);
      console.error("gateway error", model, lastErr);
      if (resp.status === 402) throw new Error("Créditos da IA esgotados. Adicione créditos no workspace.");
      if (resp.status === 429) throw new Error("Limite de requisições da IA excedido. Aguarde alguns instantes.");
      continue; // tenta próximo modelo
    }

    const content: string[] = [];
    const calls: Record<number, { id: string; name: string; args: string }> = {};
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: any;
        try { parsed = JSON.parse(payload); } catch { continue; }
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content) {
          content.push(delta.content);
          emitText(delta.content);
        }
        for (const tc of delta.tool_calls || []) {
          const idx = tc.index ?? 0;
          const slot = calls[idx] ||= { id: tc.id || `call_${idx}`, name: "", args: "" };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
      }
    }

    return {
      content: content.join(""),
      toolCalls: Object.values(calls)
        .filter((c) => c.name)
        .map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })),
    };
  }
  throw new Error(`Gateway de IA indisponível (${lastErr || "sem detalhes"}).`);
}

const TOOL_LABELS: Record<string, string> = {
  list_companies: "Listando empresas",
  query_expenses: "Consultando pedidos/despesas",
  expense_detail: "Abrindo detalhe do documento",
  query_approval_rules: "Analisando regras de aprovação",
  query_pagcorp: "Consultando PagCorp",
  query_integration_logs: "Lendo logs de integração",
  query_audit_log: "Lendo trilha de auditoria",
  query_notifications: "Consultando notificações",
  search_users: "Procurando usuários",
  describe_schema: "Inspecionando o schema do banco",
  run_sql_read: "Executando consulta SQL",
};

// ============================================================
// Server
// ============================================================
Deno.serve(withEdgeMetrics("copilot-chat", async (req, _mctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const sbUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData, error: userErr } = await sbUser.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin } = await sbAdmin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Acesso restrito a administradores." }, 403);

    const rl = await enforceRateLimit(sbAdmin, {
      scope: "copilot-chat",
      identifier: userData.user.id,
      max: 20,
      windowSeconds: 60,
    });
    if (!rl.allowed) return rateLimitResponse(rl, { ...corsHeaders, "Content-Type": "application/json" });

    const actor: Actor = { userId: userData.user.id, email: userData.user.email || "" };
    const { messages } = await req.json() as { messages: any[] };

    // Mantém a janela de contexto sob controle (últimas 24 mensagens do usuário/assistente).
    const history = (messages || []).slice(-24);
    const conv: any[] = [{ role: "system", content: buildSystemPrompt(actor.email) }, ...history];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const sse = (obj: unknown) => ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        const emitText = (t: string) => sse({ choices: [{ delta: { content: t } }] });
        const emitTool = (name: string, status: "running" | "done" | "error") =>
          sse({ tool: { name, label: TOOL_LABELS[name] || name, status } });

        try {
          for (let step = 0; step < 20; step++) {
            const { content, toolCalls } = await gatewayStep(conv, emitText);

            if (toolCalls.length === 0) {
              if (!content.trim() && step === 0) emitText("Não consegui gerar uma resposta. Reformule a pergunta.");
              break;
            }

            conv.push({
              role: "assistant",
              content: content || null,
              tool_calls: toolCalls,
            });

            for (const tc of toolCalls) {
              emitTool(tc.function.name, "running");
              let args: any = {};
              try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }
              let result: unknown;
              let ok = true;
              try {
                result = await runTool(tc.function.name, args, sbAdmin, actor);
              } catch (e) {
                ok = false;
                result = { error: e instanceof Error ? e.message : String(e) };
              }
              emitTool(tc.function.name, ok ? "done" : "error");
              conv.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(result ?? null).slice(0, 30000),
              });
            }

            if (step === 19) emitText("\n\n_Limite de etapas de investigação atingido — refine a pergunta._");
          }
        } catch (e) {
          console.error("copilot-chat stream error:", e);
          emitText(`\n\n⚠️ ${e instanceof Error ? e.message : "Erro inesperado no copiloto."}`);
        } finally {
          ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
          ctrl.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (e) {
    console.error("copilot-chat error:", e);
    return json({ error: e instanceof Error ? e.message : "Erro" }, 500);
  }
}));

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
