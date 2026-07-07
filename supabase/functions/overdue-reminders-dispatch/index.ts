// Overdue reminders dispatcher — envia lembretes via WhatsApp para
// documentos vencidos (due_date < hoje) que continuam em pendente_aprovacao.
// Roda a cada 5 min via pg_cron e respeita a frequência configurada por
// company_db em `overdue_reminder_settings`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") || "https://erp-flow.cactuscorporation.com";

interface Settings {
  company_db: string | null;
  enabled: boolean;
  frequency_minutes: number;
  template: string;
  window_start_hour: number;
  window_end_hour: number;
  weekdays_only: boolean;
  max_reminders_per_doc: number;
  notify_approver: boolean;
  notify_requester: boolean;
}

interface Expense {
  id: string;
  company_db: string;
  doc_type: string;
  supplier_name: string;
  requester_name: string;
  requester_email: string | null;
  current_approver: string | null;
  total_amount: number;
  currency: string;
  due_date: string;
  created_at: string;
}

function normalizePhone(p?: string | null): string {
  if (!p) return "";
  const digits = p.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function sendWhatsApp(to: string, message: string) {
  const body = new URLSearchParams({ to, message });
  const resp = await fetch(WHATSAPP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  return { ok: resp.ok, status: resp.status, body: await resp.text().catch(() => "") };
}

function formatCurrency(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// Retorna { hour, weekday } no fuso America/Sao_Paulo
function nowInSaoPaulo(): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value || "";
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour, weekday: wdMap[weekdayStr] ?? 1 };
}

function isWithinWindow(s: Settings): boolean {
  const { hour, weekday } = nowInSaoPaulo();
  if (s.weekdays_only && (weekday === 0 || weekday === 6)) return false;
  if (hour < s.window_start_hour || hour >= s.window_end_hour) return false;
  return true;
}

async function findPhone(
  sb: ReturnType<typeof createClient>,
  companyDB: string,
  candidates: (string | null | undefined)[],
): Promise<string | null> {
  const clean = candidates
    .map((c) => (c || "").trim())
    .filter((c) => c.length > 0);
  if (clean.length === 0) return null;
  // Também tenta prefixo antes do "@" caso venha um e-mail.
  const expanded = new Set<string>();
  for (const c of clean) {
    expanded.add(c);
    const at = c.indexOf("@");
    if (at > 0) expanded.add(c.slice(0, at));
  }
  const codes = Array.from(expanded);
  const { data } = await sb
    .from("user_phones")
    .select("user_code, phone")
    .eq("company_db", companyDB)
    .in("user_code", codes)
    .limit(5);
  const row = (data as { user_code: string; phone: string }[] | null)?.find((r) => r.phone && r.phone.trim());
  return row ? normalizePhone(row.phone) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Carrega todas as configs; monta mapa por company_db (com fallback global).
    const { data: settingsRows } = await sb
      .from("overdue_reminder_settings")
      .select("*");
    const settings = (settingsRows as Settings[]) || [];
    const globalSettings = settings.find((s) => s.company_db === null) || null;
    const perCompany: Record<string, Settings> = {};
    for (const s of settings) if (s.company_db) perCompany[s.company_db] = s;

    // Se global está desabilitado E não há override por empresa, sai.
    if (!globalSettings?.enabled && Object.values(perCompany).every((s) => !s.enabled)) {
      return new Response(JSON.stringify({ ok: true, skipped: "all_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Busca despesas vencidas e pendentes.
    const today = new Date().toISOString().slice(0, 10);
    const { data: expRows, error: expErr } = await sb
      .from("expenses")
      .select("id, company_db, doc_type, supplier_name, requester_name, requester_email, current_approver, total_amount, currency, due_date, created_at")
      .eq("status", "pendente_aprovacao")
      .lt("due_date", today)
      .not("due_date", "is", null);
    if (expErr) throw expErr;
    const expenses = (expRows as Expense[]) || [];

    let sent = 0;
    let skipped = 0;
    const details: Array<Record<string, unknown>> = [];

    for (const exp of expenses) {
      const s = perCompany[exp.company_db] || globalSettings;
      if (!s || !s.enabled) { skipped++; continue; }

      // Janela de horário
      if (!isWithinWindow(s)) {
        await sb.from("overdue_reminder_log").insert({
          expense_id: exp.id,
          company_db: exp.company_db,
          recipient_role: "approver",
          status: "skipped_window",
          response: "fora da janela de envio",
        });
        skipped++;
        continue;
      }

      // Verifica último envio por destinatário e limite máximo.
      const { data: logRows } = await sb
        .from("overdue_reminder_log")
        .select("recipient_role, sent_at, status")
        .eq("expense_id", exp.id)
        .in("status", ["sent"])
        .order("sent_at", { ascending: false })
        .limit(50);
      const logs = (logRows as { recipient_role: string; sent_at: string; status: string }[]) || [];

      if (s.max_reminders_per_doc > 0 && logs.length >= s.max_reminders_per_doc) {
        skipped++;
        continue;
      }

      const daysOverdue = Math.max(
        1,
        Math.floor((Date.now() - new Date(`${exp.due_date}T00:00:00`).getTime()) / 86400000),
      );

      const baseVars: Record<string, string> = {
        supplier: exp.supplier_name || "—",
        currency: exp.currency || "BRL",
        amount: formatCurrency(Number(exp.total_amount || 0), exp.currency || "BRL"),
        due_date: formatDateBR(exp.due_date),
        days_overdue: String(daysOverdue),
        requester: exp.requester_name || "—",
        approver: exp.current_approver || "—",
        doc_type: exp.doc_type || "documento",
        link: `${PUBLIC_APP_URL}/aprovacoes?doc=${encodeURIComponent("internal:" + exp.id)}`,
      };

      const recipients: Array<{ role: "approver" | "requester"; nameCandidates: (string | null | undefined)[]; enabled: boolean }> = [
        { role: "approver", nameCandidates: [exp.current_approver], enabled: s.notify_approver },
        { role: "requester", nameCandidates: [exp.requester_email, exp.requester_name], enabled: s.notify_requester },
      ];

      for (const r of recipients) {
        if (!r.enabled) continue;
        const lastForRole = logs.find((l) => l.recipient_role === r.role);
        if (lastForRole) {
          const ageMin = (Date.now() - new Date(lastForRole.sent_at).getTime()) / 60000;
          if (ageMin < s.frequency_minutes) {
            details.push({ id: exp.id, role: r.role, skip: "frequency", ageMin });
            continue;
          }
        }

        const phone = await findPhone(sb, exp.company_db, r.nameCandidates);
        if (!phone) {
          await sb.from("overdue_reminder_log").insert({
            expense_id: exp.id,
            company_db: exp.company_db,
            recipient_role: r.role,
            recipient_name: r.nameCandidates.find(Boolean) || null,
            status: "skipped_no_phone",
          });
          skipped++;
          continue;
        }

        const message = renderTemplate(s.template, baseVars);
        const res = await sendWhatsApp(phone, message);
        await sb.from("overdue_reminder_log").insert({
          expense_id: exp.id,
          company_db: exp.company_db,
          recipient_role: r.role,
          recipient_name: r.nameCandidates.find(Boolean) || null,
          recipient_phone: phone,
          status: res.ok ? "sent" : "error",
          response: `${res.status} ${res.body}`.slice(0, 1000),
        });
        if (res.ok) sent++;
        else skipped++;
        details.push({ id: exp.id, role: r.role, phone, sent: res.ok });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        elapsedMs: Date.now() - t0,
        overdueCount: expenses.length,
        sent,
        skipped,
        details: details.slice(0, 100),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message, elapsedMs: Date.now() - t0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
