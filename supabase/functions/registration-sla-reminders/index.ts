// Edge function: registration-sla-reminders
// Lembretes automáticos de SLA (48h úteis) para chamados de cadastro
// (fornecedores/itens). Roda periodicamente (pg_cron) e envia:
//   - warning_24h : faltam <= 24h para o vencimento
//   - warning_8h  : faltam <= 8h para o vencimento
//   - overdue_dN  : chamado vencido (1 alerta por dia de atraso)
// Cada lembrete é enviado no máximo uma vez (unique request_id + kind).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const FACILITIES_FALLBACK = "compras@anagaming.com.br";
const OPEN_STATUSES = ["aberto", "em_andamento", "aguardando_solicitante", "pendente_solicitante"];
const APP_URL = "https://erp-flow.cactuscorporation.com";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return String(value);
  }
}

interface Req {
  id: string;
  request_type: string;
  title: string;
  status: string;
  requester_email: string;
  requester_name: string | null;
  company_db: string | null;
  due_at: string;
  created_at: string;
  assignee_email: string | null;
}

function buildHtml(req: Req, overdue: boolean, deltaLabel: string): string {
  const accent = overdue ? "#dc2626" : "#d97706";
  const kind = req.request_type === "item" ? "item" : "fornecedor";
  const head = overdue ? "Chamado de cadastro em atraso" : "Chamado de cadastro perto do vencimento";
  const rows: [string, string][] = [
    ["Chamado", req.id.slice(0, 8).toUpperCase()],
    ["Tipo", kind === "item" ? "Item" : "Fornecedor"],
    ["Assunto", req.title],
    ["Solicitante", `${req.requester_name || "—"} (${req.requester_email})`],
    ["Empresa", req.company_db || "—"],
    ["Aberto em", fmtDateTime(req.created_at)],
    ["Prazo (48h úteis)", fmtDateTime(req.due_at)],
    ["Situação", deltaLabel],
    ["Responsável", req.assignee_email || "Não atribuído"],
  ];
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Segoe UI,Arial,sans-serif;color:#18181b">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
    <div style="background:${accent};padding:18px 24px;color:#ffffff">
      <div style="font-size:18px;font-weight:600">${esc(head)}</div>
      <div style="font-size:13px;opacity:.9">SLA de atendimento: 48 horas úteis</div>
    </div>
    <div style="padding:20px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows
          .map(
            ([l, v]) =>
              `<tr><td style="padding:6px 0;color:#71717a;width:180px">${esc(l)}</td><td style="padding:6px 0;font-weight:500">${esc(v)}</td></tr>`,
          )
          .join("")}
      </table>
      <div style="margin-top:22px">
        <a href="${APP_URL}/cadastros/solicitacoes" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Abrir fila de chamados</a>
      </div>
    </div>
    <div style="padding:14px 24px;background:#fafafa;color:#71717a;font-size:12px;border-top:1px solid #e4e4e7">
      Mensagem automática do ERP Flow — lembrete de SLA de cadastro.
    </div>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stats = { candidates: 0, sent: 0, skipped: 0, errors: 0 };

  try {
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = Boolean(body?.dry_run);
    } catch {
      /* no body */
    }

    // Destinatários Facilities
    const recipients = new Set<string>([FACILITIES_FALLBACK]);
    const { data: groups } = await supabase
      .from("permission_groups")
      .select("id,name");
    const facilitiesIds = (groups || [])
      .filter((g) => ["facilities", "admin"].includes(String(g.name || "").trim().toLowerCase()))
      .map((g) => g.id);
    if (facilitiesIds.length) {
      const { data: assignments } = await supabase
        .from("user_group_assignments")
        .select("sap_email")
        .in("group_id", facilitiesIds);
      // As atribuições guardam a chave canônica do usuário SAP; os e-mails
      // ficam no diretório (1 usuário SAP : N e-mails).
      const keys = (assignments || [])
        .map((a) => String(a.sap_email || "").trim().toLowerCase())
        .filter(Boolean);
      for (const key of keys) {
        if (key.includes("@")) recipients.add(key);
      }
      if (keys.length) {
        const { data: mails } = await supabase
          .from("sap_user_emails")
          .select("email")
          .in("user_key", keys);
        for (const m of mails || []) {
          const email = String(m.email || "").trim().toLowerCase();
          if (email.includes("@")) recipients.add(email);
        }
      }
    }
    const to = Array.from(recipients);

    const { data: rows, error } = await supabase
      .from("registration_requests")
      .select(
        "id,request_type,title,status,requester_email,requester_name,company_db,due_at,created_at,assignee_email",
      )
      .in("status", OPEN_STATUSES)
      .limit(500);
    if (error) throw error;

    const now = Date.now();
    const pending: { req: Req; kind: string; overdue: boolean; label: string }[] = [];

    for (const r of (rows || []) as Req[]) {
      const due = new Date(r.due_at).getTime();
      const diffH = (due - now) / 3_600_000;
      if (diffH < 0) {
        const days = Math.max(1, Math.ceil(Math.abs(diffH) / 24));
        pending.push({
          req: r,
          kind: `overdue_d${days}`,
          overdue: true,
          label: `Vencido há ${Math.floor(Math.abs(diffH))}h`,
        });
      } else if (diffH <= 8) {
        pending.push({ req: r, kind: "warning_8h", overdue: false, label: `Faltam ${Math.floor(diffH)}h` });
      } else if (diffH <= 24) {
        pending.push({ req: r, kind: "warning_24h", overdue: false, label: `Faltam ${Math.floor(diffH)}h` });
      }
    }

    stats.candidates = pending.length;

    for (const item of pending) {
      if (dryRun) continue;
      // Deduplicação: insere o log primeiro (unique request_id+kind)
      const { error: logErr } = await supabase
        .from("registration_sla_reminder_log")
        .insert({
          request_id: item.req.id,
          kind: item.kind,
          recipients: to,
          status: "sending",
        });
      if (logErr) {
        stats.skipped++;
        continue; // já enviado
      }


      const subject = `${item.overdue ? "[ATRASADO]" : "[SLA]"} Chamado de cadastro ${item.req.id
        .slice(0, 8)
        .toUpperCase()} — ${item.req.title}`;
      try {
        const { error: mailErr } = await supabase.functions.invoke("send-smtp-email", {
          body: {
            to,
            subject,
            html: buildHtml(item.req, item.overdue, item.label),
            text: `${subject}\nPrazo: ${fmtDateTime(item.req.due_at)}\nSolicitante: ${item.req.requester_email}\n${APP_URL}/cadastros/solicitacoes`,
          },
        });
        if (mailErr) throw mailErr;
        stats.sent++;
        await supabase
          .from("registration_sla_reminder_log")
          .update({ status: "sent" })
          .eq("request_id", item.req.id)
          .eq("kind", item.kind);
        await supabase.from("registration_request_events").insert({
          request_id: item.req.id,
          event_type: "sla_reminder",
          message: item.overdue
            ? `Alerta de atraso enviado ao time de Facilities (${item.label}).`
            : `Lembrete de SLA enviado ao time de Facilities (${item.label}).`,
          author_email: "system@erpflow",
          author_name: "ERP Flow",
        });
      } catch (e) {
        stats.errors++;
        await supabase
          .from("registration_sla_reminder_log")
          .update({ status: "error", detail: e instanceof Error ? e.message : String(e) })
          .eq("request_id", item.req.id)
          .eq("kind", item.kind);
      }
    }

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), ...stats }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
