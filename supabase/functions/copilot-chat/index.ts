// Copilot IA (Backoffice) — chat com acesso ao banco + ações operacionais auditadas.
// Baseado no padrão ai-assistant + report-ai-chat (SSE streaming da resposta final).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
      name: "run_sql_read",
      description:
        "Executa SELECT ad-hoc (somente leitura) via RPC pública. Use para cruzamentos que outras tools não cobrem. Uma única sentença SELECT.",
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
      if (args.company_db) q = q.eq("company_db", args.company_db);
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
      let q = sb.from("approval_rules").select("*").eq("is_active", true).order("priority", { ascending: false });
      if (args.company_db) q = q.eq("company_db", args.company_db);
      if (args.cost_center) q = q.eq("cost_center", args.cost_center);
      if (args.project) q = q.eq("project", args.project);
      const { data: rules, error } = await q;
      if (error) throw error;
      const ids = (rules || []).map((r: any) => r.id);
      const { data: levels } = ids.length
        ? await sb.from("approval_rule_levels").select("*").in("rule_id", ids).order("level_order")
        : { data: [] as any[] };
      return (rules || []).map((r: any) => ({ ...r, levels: (levels || []).filter((l: any) => l.rule_id === r.id) }));
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
const SYSTEM_PROMPT = `Você é o Copiloto Operacional do ERP Flow (Backoffice), assistindo administradores.
Você tem acesso ao banco via ferramentas e pode EXECUTAR AÇÕES (redirecionar aprovação, reprocessar integração, criar regras).

Regras críticas:
1. SEMPRE consulte dados reais via ferramentas. Nunca invente números, IDs, e-mails.
2. Antes de EXECUTAR qualquer ação de escrita (redirect_approval, reprocess_*, revert_*, send_notification, toggle_approval_rule, upsert_approval_rule):
   a) Primeiro pesquise os dados relevantes com tools de leitura.
   b) Depois apresente ao usuário um resumo claro do que será feito.
   c) Peça confirmação explícita ("posso executar?").
   d) SOMENTE após o usuário confirmar em texto ("sim", "confirma", "pode", etc), chame a tool de escrita com \`confirmed: true\`.
3. Se chamar uma tool de escrita SEM \`confirmed: true\`, ela retornará um preview — apresente esse preview ao usuário e aguarde confirmação.
4. Responda em português do Brasil, use markdown (tabelas, listas), formate moeda em BRL e datas DD/MM/YYYY.
5. Para consultas complexas não cobertas por tools específicas, use \`run_sql_read\` com um SELECT bem escrito (uma única sentença).
6. Toda ação de escrita é auditada (audit_log). Cite o motivo quando o usuário fornecer.
7. Se algo falhar, mostre a mensagem de erro exata e proponha próximo passo.

Ferramentas de leitura são livres. Ferramentas de escrita mudam o sistema — trate-as com cuidado.`;

// ============================================================
// Server
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const sbUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData, error: userErr } = await sbUser.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);
    // Gate admin
    const { data: isAdmin } = await sbAdmin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Acesso restrito a administradores." }, 403);

    const actor: Actor = { userId: userData.user.id, email: userData.user.email || "" };

    const { messages } = await req.json() as { messages: any[] };

    const conv: any[] = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

    // Tool-calling loop (até 12 passos)
    for (let step = 0; step < 12; step++) {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: conv,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!aiResp.ok) {
        const t = await aiResp.text();
        console.error("gateway error", aiResp.status, t);
        if (aiResp.status === 429) return json({ error: "Limite de requisições excedido. Aguarde alguns instantes." }, 429);
        if (aiResp.status === 402) return json({ error: "Créditos da IA esgotados. Adicione créditos no workspace." }, 402);
        return json({ error: "Erro no gateway de IA." }, 500);
      }

      const data = await aiResp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) break;

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0) {
        // Resposta final — devolve como stream SSE simples (compatível com o cliente atual)
        return streamText(msg.content || "");
      }

      conv.push(msg);
      for (const tc of toolCalls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
        let result: unknown;
        try {
          result = await runTool(tc.function.name, args, sbAdmin, actor);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        conv.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 15000),
        });
      }
    }

    return streamText("_Limite de etapas atingido — refine a pergunta._");
  } catch (e) {
    console.error("copilot-chat error:", e);
    return json({ error: e instanceof Error ? e.message : "Erro" }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Stream SSE compatível com o parser do ReportAiChat (choices[0].delta.content).
function streamText(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      // Chunk único para simplicidade (o loop pode terminar rápido).
      const payload = { choices: [{ delta: { content: text } }] };
      ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      ctrl.enqueue(encoder.encode(`data: [DONE]\n\n`));
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
