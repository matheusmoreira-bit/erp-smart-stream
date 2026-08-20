// Overdue reminders dispatcher — envia lembretes via WhatsApp para
// documentos vencidos (due_date < hoje) que continuam em pendente_aprovacao.
// Roda a cada 5 min via pg_cron e respeita a frequência configurada por
// company_db em `overdue_reminder_settings`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { logNotificationAudit } from "../_shared/approval-notify.ts";
import { getChannelSettings } from "../_shared/notification-channels.ts";
import { normalizeText } from "../_shared/text-normalize.ts";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";
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

interface CompanyRow {
  company_db: string;
  is_test: boolean;
}

function normalizePhone(p?: string | null): string {
  if (!p) return "";
  const digits = p.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function sendWhatsApp(to: string, message: string) {
  if (!WHATSAPP_TOKEN) {
    console.warn("[overdue-reminders-dispatch] WHATSAPP_TOKEN não configurado; notificação ignorada.");
    return { ok: false, status: 0, body: "WHATSAPP_TOKEN ausente" };
  }
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

const slug = (s: string) => normalizeText(s);

function identityParts(value?: string | null): Set<string> {
  const normalized = slug(value || "");
  if (!normalized) return new Set();
  const prefix = normalized.split("@")[0];
  const compact = (v: string) => v.replace(/[^a-z0-9]/g, "");
  return new Set([normalized, prefix, compact(normalized), compact(prefix)].filter(Boolean));
}

function sameIdentity(left?: string | null, right?: string | null): boolean {
  const a = identityParts(left);
  const b = identityParts(right);
  return Array.from(a).some((value) => b.has(value));
}

function requesterIsCurrentApprover(expense: Expense): boolean {
  return sameIdentity(expense.current_approver, expense.requester_name) ||
    sameIdentity(expense.current_approver, expense.requester_email);
}

// Resolve identificadores adicionais (código SAP) a partir de nome de exibição
// ou e-mail — o campo `current_approver` costuma guardar "Felipe Escudeiro".
async function expandIdentifiers(
  sb: ReturnType<typeof createClient>,
  raw: string[],
): Promise<string[]> {
  const out = new Set<string>();
  for (const c of raw) {
    out.add(c);
    out.add(slug(c));
    const at = c.indexOf("@");
    if (at > 0) {
      out.add(c.slice(0, at));
      out.add(slug(c.slice(0, at)));
    }
  }

  // e-mails → user_key
  const emails = raw.filter((c) => c.includes("@")).map((c) => c.toLowerCase());
  if (emails.length > 0) {
    const { data } = await sb
      .from("sap_user_emails")
      .select("user_key, email")
      .in("email", emails);
    for (const r of (data as { user_key: string }[] | null) || []) out.add(r.user_key);
  }

  // nomes de exibição → sap_user_code / user_key
  const { data: dir } = await sb
    .from("sap_user_directory")
    .select("user_key, sap_user_code, display_name");
  const wanted = new Set(raw.map(slug));
  for (const r of (dir as { user_key: string; sap_user_code: string | null; display_name: string | null }[] | null) || []) {
    const names = [r.display_name, r.user_key, r.sap_user_code].filter(Boolean).map((n) => slug(String(n)));
    if (names.some((n) => wanted.has(n))) {
      if (r.user_key) out.add(r.user_key);
      if (r.sap_user_code) out.add(r.sap_user_code);
    }
  }

  return Array.from(out).filter((v) => v.length > 0);
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

  const codes = await expandIdentifiers(sb, clean);
  if (codes.length === 0) return null;

  const pick = (rows: { user_code: string; phone: string }[] | null) =>
    rows?.find((r) => r.phone && r.phone.trim()) || null;

  // 1) telefone cadastrado na própria empresa
  const { data: sameCompany } = await sb
    .from("user_phones")
    .select("user_code, phone")
    .eq("company_db", companyDB)
    .in("user_code", codes)
    .limit(10);
  let row = pick(sameCompany as { user_code: string; phone: string }[] | null);

  // 2) fallback: mesmo usuário em qualquer outra base
  if (!row) {
    const { data: anyCompany } = await sb
      .from("user_phones")
      .select("user_code, phone")
      .in("user_code", codes)
      .limit(10);
    row = pick(anyCompany as { user_code: string; phone: string }[] | null);
  }

  return row ? normalizePhone(row.phone) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;
  const disabled = blockIfIntegrationsDisabled(corsHeaders);
  if (disabled) return disabled;

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

    // Notificações externas nunca devem sair de bases de teste. A interface
    // pode exibi-las para administradores, mas isso não autoriza WhatsApp real.
    const { data: companyRows, error: companyErr } = await sb
      .from("companies")
      .select("company_db, is_test, display_name");
    if (companyErr) throw companyErr;
    // Regras de governança (globais + override por empresa).
    const { data: govRows } = await sb
      .from("notification_governance")
      .select("company_db, exclude_test_companies, block_self_approval, notify_requester, extra_recipients, blocked_recipients, enabled");
    type Gov = {
      company_db: string | null;
      exclude_test_companies: boolean;
      block_self_approval: boolean;
      notify_requester: boolean;
      extra_recipients: string[];
      blocked_recipients: string[];
      enabled: boolean;
    };
    const govList = (govRows as Gov[] | null) || [];
    const govGlobal = govList.find((g) => g.company_db === null) || null;
    const govByCompany: Record<string, Gov> = {};
    for (const g of govList) if (g.company_db) govByCompany[g.company_db] = g;
    const govFor = (db: string): Gov =>
      govByCompany[db] ||
      govGlobal || {
        company_db: null,
        exclude_test_companies: true,
        block_self_approval: true,
        notify_requester: false,
        extra_recipients: [],
        blocked_recipients: [],
        enabled: true,
      };
    const isBlockedRecipient = (gov: Gov, candidates: (string | null | undefined)[]) => {
      const list = (gov.blocked_recipients || []).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (list.length === 0) return false;
      return candidates.some((c) => c && list.includes(String(c).trim().toLowerCase()));
    };

    const companyNames: Record<string, string> = {};
    for (const c of ((companyRows as CompanyRow[] | null) || [])) {
      const named = c as CompanyRow & { display_name?: string | null };
      if (named.display_name) companyNames[c.company_db] = named.display_name;
    }
    const testCompanies = new Set(
      ((companyRows as CompanyRow[] | null) || [])
        .filter((company) => company.is_test)
        .map((company) => company.company_db),
    );

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

      const gov = govFor(exp.company_db);
      if (!gov.enabled) {
        details.push({ id: exp.id, skip: "governance_disabled" });
        skipped++;
        continue;
      }

      if (gov.exclude_test_companies && testCompanies.has(exp.company_db)) {
        details.push({ id: exp.id, skip: "test_company" });
        skipped++;
        continue;
      }

      // Defesa adicional: mesmo que um documento legado ou uma delegação
      // incorreta coloque o solicitante como aprovador, não envie a ele uma
      // cobrança para aprovar a própria solicitação.
      if (gov.block_self_approval && requesterIsCurrentApprover(exp)) {
        await sb.from("overdue_reminder_log").insert({
          expense_id: exp.id,
          company_db: exp.company_db,
          recipient_role: "approver",
          recipient_name: exp.current_approver,
          status: "skipped_self_approval",
          response: "solicitante e aprovador atual representam a mesma identidade",
        });
        details.push({ id: exp.id, skip: "self_approval" });
        skipped++;
        continue;
      }

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
        company: companyNames[exp.company_db] || exp.company_db,
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

      const recipients: Array<{ role: "approver" | "requester" | "watcher"; nameCandidates: (string | null | undefined)[]; enabled: boolean }> = [
        { role: "approver", nameCandidates: [exp.current_approver], enabled: s.notify_approver },
        { role: "requester", nameCandidates: [exp.requester_email, exp.requester_name], enabled: s.notify_requester && gov.notify_requester },
        ...(gov.extra_recipients || []).filter(Boolean).map((name) => ({
          role: "watcher" as const,
          nameCandidates: [name] as (string | null | undefined)[],
          enabled: true,
        })),
      ];

      for (const r of recipients) {
        if (!r.enabled) continue;
        if (isBlockedRecipient(gov, r.nameCandidates)) {
          await sb.from("overdue_reminder_log").insert({
            expense_id: exp.id,
            company_db: exp.company_db,
            recipient_role: r.role,
            recipient_name: r.nameCandidates.find(Boolean) || null,
            status: "skipped_blocked",
            response: "destinatário bloqueado nas regras de notificação",
          });
          skipped++;
          continue;
        }
        const lastForRole = logs.find((l) => l.recipient_role === r.role);
        if (lastForRole) {
          const ageMin = (Date.now() - new Date(lastForRole.sent_at).getTime()) / 60000;
          if (ageMin < s.frequency_minutes) {
            details.push({ id: exp.id, role: r.role, skip: "frequency", ageMin });
            continue;
          }
        }

        const chans = await getChannelSettings(sb, exp.company_db, "overdue_reminder");
        if (!chans.whatsapp) {
          await sb.from("overdue_reminder_log").insert({
            expense_id: exp.id,
            company_db: exp.company_db,
            recipient_role: r.role,
            recipient_name: r.nameCandidates.find(Boolean) || null,
            status: "skipped_channel_disabled",
            response: "canal WhatsApp desativado para esta empresa/evento",
          });
          skipped++;
          continue;
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
        await logNotificationAudit(sb, {
          expenseId: exp.id,
          companyDb: exp.company_db,
          docType: (exp as any).doc_type ?? null,
          channel: "whatsapp",
          recipient: phone,
          recipientName: r.nameCandidates.find(Boolean) || null,
          recipientRole: r.role,
          eventKey: "overdue_reminder",
          status: res.ok ? "sent" : "error",
          amount: (exp as any).total_amount ?? null,
          currency: (exp as any).currency ?? null,
          resolution: {
            source: r.role === "approver" ? "current_approver" : `reminder_${r.role}`,
            reason: r.role === "approver"
              ? `Aprovador atual do documento (${(exp as any).current_approver || "—"}) — lembrete de vencimento`
              : `Destinatário configurado nas regras de lembrete (papel: ${r.role})`,
            ruleId: (exp as any).approval_rule_id || null,
            costCenter: (exp as any).cost_center || null,
            project: (exp as any).project || null,
          },
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
