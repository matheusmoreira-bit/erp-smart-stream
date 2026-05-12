// AI Assistant: chat with tools to query system data
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ---------- Tools definitions ----------
const tools = [
  {
    type: "function",
    function: {
      name: "list_companies",
      description: "Lista empresas (bases SAP/OMIE) cadastradas no sistema com seu tipo de ERP.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "license_summary",
      description: "Resumo das licenças SAP por empresa: total de usuários, com PRO, com CRM, sem licença, ociosos. Opcionalmente filtre por company_db.",
      parameters: {
        type: "object",
        properties: { company_db: { type: "string", description: "Código da base. Omita para todas." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_users",
      description: "Busca usuários SAP pelo user_code (login) ou nome. Retorna licenças mapeadas em todas as empresas onde o usuário aparece.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Texto a buscar (user_code ou nome)" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "expenses_summary",
      description: "Resumo de despesas por status (rascunho, enviada, aprovada, rejeitada, integrada). Opcional por empresa e período.",
      parameters: {
        type: "object",
        properties: {
          company_db: { type: "string" },
          days: { type: "number", description: "Últimos N dias (padrão 30)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_approvals",
      description: "Lista despesas aguardando aprovação. Inclui solicitante, valor, dias em aberto, próximo aprovador.",
      parameters: {
        type: "object",
        properties: { company_db: { type: "string" }, limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approval_rules_overview",
      description: "Lista regras de aprovação configuradas e seus níveis (alçadas).",
      parameters: {
        type: "object",
        properties: { company_db: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_suppliers",
      description: "Busca fornecedores cadastrados por nome, CNPJ ou e-mail.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pagcorp_integration_stats",
      description: "Estatísticas de integrações PagCorp recentes (sucesso, erro, pendente).",
      parameters: {
        type: "object",
        properties: { days: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_log_recent",
      description: "Últimos eventos do log de auditoria. Pode filtrar por entidade ou ator (e-mail).",
      parameters: {
        type: "object",
        properties: {
          entity_type: { type: "string" },
          actor_email: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notifications_summary",
      description: "Resumo das notificações do usuário atual (não lidas, recentes).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "idle_license_alerts",
      description: "Alertas de licenças ociosas (usuários SAP sem login recente).",
      parameters: {
        type: "object",
        properties: { company_db: { type: "string" }, limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
];

// ---------- Tool runners ----------
async function runTool(name: string, args: Record<string, unknown>, sb: ReturnType<typeof createClient>, userId: string) {
  switch (name) {
    case "list_companies": {
      const { data, error } = await sb.from("companies").select("company_db, display_name, erp_type, active").eq("active", true);
      if (error) throw error;
      return data;
    }
    case "license_summary": {
      let q = sb.from("user_licenses").select("company_db, license_type, has_license, idle_days");
      if (args.company_db) q = q.eq("company_db", args.company_db);
      const { data, error } = await q;
      if (error) throw error;
      const grouped: Record<string, { total: number; pro: number; crm: number; sem: number; ociosos: number }> = {};
      for (const r of data || []) {
        const k = (r as any).company_db;
        if (!grouped[k]) grouped[k] = { total: 0, pro: 0, crm: 0, sem: 0, ociosos: 0 };
        grouped[k].total++;
        const lt = ((r as any).license_type || "").toUpperCase();
        if (lt === "PRO") grouped[k].pro++;
        else if (lt === "CRM") grouped[k].crm++;
        else grouped[k].sem++;
        if (((r as any).idle_days ?? 0) >= 30) grouped[k].ociosos++;
      }
      return grouped;
    }
    case "search_users": {
      const q = String(args.query || "");
      const { data, error } = await sb.from("user_licenses")
        .select("user_code, user_name, company_db, license_type, has_license, idle_days, last_login_at")
        .or(`user_code.ilike.%${q}%,user_name.ilike.%${q}%`)
        .limit(50);
      if (error) throw error;
      return data;
    }
    case "expenses_summary": {
      const days = Number(args.days || 30);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      let q = sb.from("expenses").select("status, company_db, total_amount, created_at").gte("created_at", since);
      if (args.company_db) q = q.eq("company_db", args.company_db);
      const { data, error } = await q;
      if (error) throw error;
      const byStatus: Record<string, { count: number; total: number }> = {};
      for (const r of data || []) {
        const s = (r as any).status || "unknown";
        if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 };
        byStatus[s].count++;
        byStatus[s].total += Number((r as any).total_amount || 0);
      }
      return { period_days: days, by_status: byStatus, total_records: data?.length || 0 };
    }
    case "list_pending_approvals": {
      const limit = Number(args.limit || 20);
      let q = sb.from("expenses")
        .select("id, title, requester_email, total_amount, currency, company_db, created_at, status, current_approver_email")
        .in("status", ["submitted", "in_approval"])
        .order("created_at", { ascending: true })
        .limit(limit);
      if (args.company_db) q = q.eq("company_db", args.company_db);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r,
        days_open: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000),
      }));
    }
    case "approval_rules_overview": {
      let q = sb.from("approval_rules").select("id, name, company_db, active, min_amount, max_amount, currency");
      if (args.company_db) q = q.eq("company_db", args.company_db);
      const { data: rules, error } = await q;
      if (error) throw error;
      const ids = (rules || []).map((r: any) => r.id);
      const { data: levels } = ids.length
        ? await sb.from("approval_rule_levels").select("rule_id, level, approver_email, min_amount").in("rule_id", ids)
        : { data: [] as any[] };
      return (rules || []).map((r: any) => ({ ...r, levels: (levels || []).filter((l: any) => l.rule_id === r.id) }));
    }
    case "search_suppliers": {
      const q = String(args.query || "");
      const limit = Number(args.limit || 20);
      const { data, error } = await sb.from("suppliers")
        .select("id, name, document, email, phone, country, status")
        .or(`name.ilike.%${q}%,document.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(limit);
      if (error) throw error;
      return data;
    }
    case "pagcorp_integration_stats": {
      const days = Number(args.days || 7);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await sb.from("pagcorp_integration_log")
        .select("status, created_at").gte("created_at", since);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data || []) {
        const s = (r as any).status || "unknown";
        counts[s] = (counts[s] || 0) + 1;
      }
      return { period_days: days, counts, total: data?.length || 0 };
    }
    case "audit_log_recent": {
      const limit = Number(args.limit || 20);
      let q = sb.from("audit_log").select("created_at, actor_email, action, entity_type, entity_id, company_db, details")
        .order("created_at", { ascending: false }).limit(limit);
      if (args.entity_type) q = q.eq("entity_type", args.entity_type);
      if (args.actor_email) q = q.eq("actor_email", args.actor_email);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "notifications_summary": {
      const { data, error } = await sb.from("notifications")
        .select("id, title, body, read_at, created_at, type")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const unread = (data || []).filter((n: any) => !n.read_at).length;
      return { unread, recent: data };
    }
    case "idle_license_alerts": {
      const limit = Number(args.limit || 20);
      let q = sb.from("user_licenses")
        .select("user_code, user_name, company_db, license_type, idle_days, last_login_at")
        .gte("idle_days", 30)
        .order("idle_days", { ascending: false })
        .limit(limit);
      if (args.company_db) q = q.eq("company_db", args.company_db);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

const SYSTEM_PROMPT = `Você é o assistente IA do sistema interno (SAP B1 Analytics + integrações PagCorp/OMIE).
Seu papel: responder perguntas do usuário consultando o banco através das ferramentas disponíveis, sem que ele precise navegar pelos módulos.

Regras:
- SEMPRE use as ferramentas para obter dados reais. Não invente números.
- Responda em português do Brasil, claro e objetivo.
- Use markdown (tabelas, listas, negrito) para apresentar dados.
- Formate moeda em BRL (R$ 1.234,56) e datas como DD/MM/YYYY.
- Quando relevante, sugira o módulo onde o usuário pode tomar uma ação (ex: "veja em /licenses").
- Se uma pergunta for ambígua (ex: "qual empresa?"), pergunte antes de chamar várias ferramentas.
- Encadeie ferramentas quando necessário (ex: list_companies → license_summary).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    // user-scoped client (for own messages/notifications)
    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await sbUser.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // service-role client for read-only data tool calls
    const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { messages, threadId } = await req.json() as { messages: any[]; threadId?: string };

    // Persist last user message
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (threadId && lastUser) {
      await sbUser.from("ai_chat_messages").insert({
        thread_id: threadId, user_id: userId, role: "user", content: lastUser.content,
      });
    }

    // Tool-calling loop (non-streaming for simplicity, then stream final answer)
    const conv: any[] = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

    for (let step = 0; step < 8; step++) {
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
        if (aiResp.status === 429) {
          return new Response(JSON.stringify({ error: "Limite de requisições excedido." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (aiResp.status === 402) {
          return new Response(JSON.stringify({ error: "Créditos da IA esgotados." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.error("AI error:", aiResp.status, t);
        return new Response(JSON.stringify({ error: "Erro ao consultar IA" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await aiResp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) break;

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0) {
        // Final answer
        const content = msg.content || "";
        if (threadId) {
          await sbUser.from("ai_chat_messages").insert({
            thread_id: threadId, user_id: userId, role: "assistant", content,
          });
          await sbUser.from("ai_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
        }
        return new Response(JSON.stringify({ content }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Push assistant tool-call message
      conv.push(msg);

      // Run each tool
      for (const tc of toolCalls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
        let result: unknown;
        try {
          result = await runTool(tc.function.name, args, sbAdmin, userId);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        conv.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
    }

    return new Response(JSON.stringify({ content: "Não consegui completar a resposta (limite de etapas)." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
