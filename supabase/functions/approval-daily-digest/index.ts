// Edge function: approval-daily-digest
// Resumo diário por e-mail dos documentos parados aguardando aprovação.
// Um e-mail por aprovador, listando tudo que continua pendente com ele.
// Executado por pg_cron (1x por dia) — exige scheduler/admin.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";

const APP_URL = (Deno.env.get("APP_PUBLIC_URL") || "https://erp-flow.cactuscorporation.com").replace(/\/+$/, "");
const MAX_DOCS = 2000;

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeKey(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function fmtMoney(value: number | null, currency: string | null): string {
  const n = Number(value || 0);
  return `${currency || "BRL"} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return String(value);
  }
}

interface PendingDoc {
  id: string;
  company_db: string | null;
  supplier_name: string | null;
  requester_name: string | null;
  total_amount: number | null;
  currency: string | null;
  due_date: string | null;
  created_at: string | null;
  doc_type: string | null;
  current_approver: string | null;
}

function buildHtml(name: string, docs: PendingDoc[]): string {
  const today = new Date();
  const rows = docs
    .map((d) => {
      const overdue = d.due_date ? new Date(d.due_date).getTime() < today.getTime() : false;
      const link = `${APP_URL}/aprovacoes?doc=${encodeURIComponent(`internal:${d.id}`)}`;
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;font-size:13px">${esc(d.supplier_name || "—")}<div style="color:#71717a;font-size:12px">${esc(d.requester_name || "—")} · ${esc(d.company_db || "—")}</div></td>
        <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;font-size:13px;white-space:nowrap">${esc(fmtMoney(d.total_amount, d.currency))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;font-size:13px;white-space:nowrap;color:${overdue ? "#dc2626" : "#18181b"}">${esc(fmtDate(d.due_date))}${overdue ? " (vencido)" : ""}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;font-size:13px"><a href="${esc(link)}" style="color:#0ea5e9;text-decoration:none">Abrir</a></td>
      </tr>`;
    })
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Segoe UI,Arial,sans-serif;color:#18181b">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
    <div style="background:#18181b;color:#fff;padding:18px 24px">
      <div style="font-size:18px;font-weight:600">Você tem ${docs.length} documento(s) aguardando aprovação</div>
      <div style="font-size:13px;opacity:.85">Resumo diário do ERP Flow</div>
    </div>
    <div style="padding:20px 24px">
      <p style="margin:0 0 14px;font-size:14px">Olá ${esc(name)}, estes documentos continuam parados na sua alçada:</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <th align="left" style="padding:6px 10px;font-size:12px;color:#71717a">Fornecedor / Solicitante</th>
          <th align="left" style="padding:6px 10px;font-size:12px;color:#71717a">Valor</th>
          <th align="left" style="padding:6px 10px;font-size:12px;color:#71717a">Vencimento</th>
          <th align="left" style="padding:6px 10px;font-size:12px;color:#71717a"></th>
        </tr>
        ${rows}
      </table>
      <div style="margin-top:22px">
        <a href="${APP_URL}/aprovacoes" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Abrir minhas aprovações</a>
      </div>
    </div>
    <div style="padding:14px 24px;background:#fafafa;color:#71717a;font-size:12px;border-top:1px solid #e4e4e7">
      Mensagem automática do ERP Flow — resumo diário de aprovações pendentes.
    </div>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response!;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const blocked = blockIfIntegrationsDisabled(corsHeaders);
  if (blocked) return blocked;

  const stats = { approvers: 0, docs: 0, sent: 0, errors: 0, skipped_no_email: 0 };

  try {
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = Boolean(body?.dry_run);
    } catch { /* sem corpo */ }

    const { data: docs, error } = await admin
      .from("expenses")
      .select(
        "id, company_db, supplier_name, requester_name, total_amount, currency, due_date, created_at, doc_type, current_approver",
      )
      .eq("status", "pendente_aprovacao")
      .limit(MAX_DOCS);
    if (error) throw error;

    // Empresas de teste não recebem lembrete.
    const { data: companies } = await admin.from("companies").select("company_db, is_test");
    const testDbs = new Set(
      ((companies || []) as Array<{ company_db: string; is_test: boolean }>)
        .filter((c) => c.is_test)
        .map((c) => c.company_db),
    );

    const pending = ((docs || []) as PendingDoc[]).filter(
      (d) => !!d.current_approver && !testDbs.has(d.company_db || ""),
    );
    stats.docs = pending.length;

    // Aprovador atual pode vir como e-mail ou como user code do SAP.
    const byApprover = new Map<string, PendingDoc[]>();
    for (const d of pending) {
      // O campo pode conter vários aprovadores paralelos separados por "/".
      const parts = String(d.current_approver)
        .split("/")
        .map((v) => normalizeKey(v))
        .filter((v) => v && v !== "administrador");
      for (const key of parts) {
        const list = byApprover.get(key) || [];
        list.push(d);
        byApprover.set(key, list);
      }
    }
    stats.approvers = byApprover.size;

    // Resolve e-mail dos aprovadores identificados por user code.
    const codes = Array.from(byApprover.keys()).filter((k) => !isEmail(k));
    const emailByCode = new Map<string, { email: string; name: string | null }>();
    if (codes.length > 0) {
      const { data: dir } = await admin
        .from("sap_user_directory")
        .select("user_key, sap_user_code, display_name, is_active")
        .limit(5000);
      const dirRows = ((dir || []) as Array<{ user_key: string | null; sap_user_code: string | null; display_name: string | null; is_active: boolean | null }>)
        .filter((r) => r.is_active !== false);
      const keys = dirRows.map((r) => r.user_key).filter(Boolean) as string[];
      const { data: mails } = keys.length
        ? await admin.from("sap_user_emails").select("user_key, email, is_primary").in("user_key", keys)
        : { data: [] as Array<{ user_key: string; email: string; is_primary: boolean | null }> };
      const mailByKey = new Map<string, string>();
      for (const m of ((mails || []) as Array<{ user_key: string; email: string; is_primary: boolean | null }>)) {
        if (!m.email || !isEmail(m.email)) continue;
        const existing = mailByKey.get(m.user_key);
        if (!existing || m.is_primary) mailByKey.set(m.user_key, m.email.trim().toLowerCase());
      }
      for (const row of dirRows) {
        const email = row.user_key ? mailByKey.get(row.user_key) : undefined;
        if (!email) continue;
        const aliases: Array<string | null> = [row.sap_user_code, row.display_name, row.user_key];
        const dn = String(row.display_name || "").trim();
        if (dn.includes(" ")) {
          const p = dn.split(/\s+/);
          aliases.push(`${p[0]} ${p[p.length - 1]}`);
        }
        for (const alias of aliases) {
          const code = normalizeKey(String(alias || ""));
          if (code && !emailByCode.has(code)) emailByCode.set(code, { email, name: row.display_name });
        }
      }
    }

    for (const [key, list] of byApprover.entries()) {
      const resolved = isEmail(key)
        ? { email: key, name: null as string | null }
        : emailByCode.get(key) || null;
      if (!resolved) {
        stats.skipped_no_email++;
        continue;
      }
      if (dryRun) continue;

      const sorted = [...list].sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
      const displayName = resolved.name || (isEmail(key) ? key.split("@")[0] : key);
      const subject = `[ERP Flow] ${sorted.length} documento(s) aguardando sua aprovação`;
      try {
        const { error: mailErr } = await admin.functions.invoke("send-smtp-email", {
          body: {
            to: [resolved.email],
            subject,
            html: buildHtml(displayName, sorted),
            text: `${subject}\n${APP_URL}/aprovacoes`,
          },
        });
        if (mailErr) throw mailErr;
        stats.sent++;
      } catch (e) {
        stats.errors++;
        console.warn("[approval-daily-digest] falha ao enviar:", e instanceof Error ? e.message : String(e));
      }
    }

    return new Response(JSON.stringify({ ok: true, dryRun, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), ...stats }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
