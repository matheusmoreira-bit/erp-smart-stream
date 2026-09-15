// Notificação de "Pedido de compra pago".
//
// Dispara quando o ciclo do pedido chega a pago (título liquidado no ERP).
// Destinatários: fornecedor, solicitante e aprovadores que participaram da
// cadeia. Usa o mesmo layout de e-mail dos marcos de pedido de compra
// (synapse-po-notify) e é idempotente por (empresa, pedido, destinatário)
// via `po_notification_sent`.
//
// Best-effort: nunca lança — notificação não pode quebrar a sincronização.
// deno-lint-ignore-file no-explicit-any

const MILESTONE = "paid_flow";

export interface PaidExpenseRow {
  id: string;
  company_db: string | null;
  doc_type?: string | null;
  sap_doc_entry?: number | null;
  sap_doc_num?: number | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  requester_email?: string | null;
  requester_name?: string | null;
  current_approver?: string | null;
  original_approver?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  doc_date?: string | null;
}

type Audience = "supplier" | "requester" | "approver";

const EXPENSE_FIELDS =
  "id, company_db, doc_type, sap_doc_entry, sap_doc_num, supplier_code, supplier_name, " +
  "requester_email, requester_name, current_approver, original_approver, total_amount, currency, doc_date";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmail(v: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());
}

function normEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function money(value: unknown, currency?: string | null): string {
  const n = Number(value) || 0;
  const cur = (currency || "BRL").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

function appUrl(): string {
  return (Deno.env.get("APP_PUBLIC_URL") || "https://erp-flow.cactuscorporation.com").replace(/\/+$/, "");
}

const INTRO: Record<Audience, (row: PaidExpenseRow) => string> = {
  supplier: () => "O pagamento referente ao pedido de compra abaixo foi liquidado.",
  requester: () => "O título referente ao seu pedido de compra foi liquidado/pago.",
  approver: () => "O pedido de compra aprovado por você foi liquidado/pago.",
};

/** Mesmo layout dos marcos de pedido de compra (synapse-po-notify). */
function renderHtml(row: PaidExpenseRow, audience: Audience, greetingName: string | null): string {
  const docLabel = row.sap_doc_num ? `#${row.sap_doc_num}` : `#${String(row.id).slice(0, 8).toUpperCase()}`;
  const link = `${appUrl()}/compras?doc=${encodeURIComponent(row.id)}`;
  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:#0f172a;padding:20px 24px;color:#fff">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7">ERP Flow</div>
      <div style="font-size:20px;font-weight:600;margin-top:4px">Pedido de compra pago</div>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5">Olá${greetingName ? ` ${esc(greetingName)}` : ""},</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.5">${esc(INTRO[audience](row))}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 0;color:#6b7280">Empresa</td><td style="padding:6px 0;text-align:right">${esc(row.company_db || "-")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Pedido</td><td style="padding:6px 0;text-align:right">${esc(docLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Data</td><td style="padding:6px 0;text-align:right">${esc(row.doc_date || "-")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Fornecedor</td><td style="padding:6px 0;text-align:right">${esc(row.supplier_name || row.supplier_code || "-")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Solicitante</td><td style="padding:6px 0;text-align:right">${esc(row.requester_name || row.requester_email || "-")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Total</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(money(row.total_amount, row.currency))}</td></tr>
      </table>
      ${audience === "supplier" ? "" : `<p style="margin:20px 0 0;font-size:13px"><a href="${esc(link)}" style="color:#0ea5e9">Abrir no ERP Flow</a></p>`}
      <p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.5">Notificação automática — não responda a este email.</p>
    </div>
  </div>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return { ok: false, error: "ambiente sem credenciais de envio" };
  try {
    const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ to, subject, html }),
    });
    if (!res.ok) {
      return { ok: false, error: `${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}` };
    }
    const body = await res.json().catch(() => null);
    if (body && body.ok === false) return { ok: false, error: String(body.error || "envio recusado") };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** E-mail do fornecedor no cadastro da empresa (SAP) com fallback pelo cadastro local. */
async function supplierEmail(sb: any, row: PaidExpenseRow): Promise<{ email: string | null; name: string | null }> {
  const code = (row.supplier_code || "").trim();
  if (!code || !row.company_db) return { email: null, name: null };
  try {
    const { data } = await sb
      .from("suppliers")
      .select("email, card_name, federal_tax_id")
      .eq("company_db", row.company_db)
      .eq("card_code", code)
      .maybeSingle();
    if (data?.email && isEmail(data.email)) {
      return { email: normEmail(data.email), name: data.card_name || row.supplier_name || null };
    }
    const taxId = String(data?.federal_tax_id || "").replace(/\D/g, "");
    if (taxId.length >= 11) {
      const { data: local } = await sb
        .from("fornecedores")
        .select("email, razao_social")
        .eq(taxId.length === 11 ? "cpf" : "cnpj", taxId)
        .maybeSingle();
      if (local?.email && isEmail(local.email)) {
        return { email: normEmail(local.email), name: local.razao_social || row.supplier_name || null };
      }
    }
  } catch (e) {
    console.warn("[expense-paid-notify] fornecedor:", e instanceof Error ? e.message : String(e));
  }
  return { email: null, name: null };
}

async function approverRecipients(sb: any, row: PaidExpenseRow): Promise<Array<{ email: string; name: string | null }>> {
  const out = new Map<string, { email: string; name: string | null }>();
  try {
    const { data } = await sb
      .from("expense_approval_log")
      .select("approver_email, approver_name, decision")
      .eq("expense_id", row.id);
    for (const r of (data || []) as Array<{ approver_email?: string; approver_name?: string; decision?: string }>) {
      const decision = String(r.decision || "").toLowerCase();
      if (decision && !["approved", "aprovado", "approve"].includes(decision)) continue;
      const email = normEmail(r.approver_email);
      if (isEmail(email)) out.set(email, { email, name: r.approver_name || null });
    }
  } catch (e) {
    console.warn("[expense-paid-notify] aprovadores:", e instanceof Error ? e.message : String(e));
  }
  for (const candidate of [row.current_approver, row.original_approver]) {
    const email = normEmail(candidate);
    if (isEmail(email) && !out.has(email)) out.set(email, { email, name: null });
  }
  return [...out.values()];
}

async function alreadySent(sb: any, row: PaidExpenseRow, email: string): Promise<boolean> {
  try {
    const { data } = await sb
      .from("po_notification_sent")
      .select("id")
      .eq("company_db", row.company_db)
      .eq("po_doc_entry", row.sap_doc_entry ?? -1)
      .eq("milestone", MILESTONE)
      .eq("recipient_email", email)
      .limit(1);
    return !!(data && data.length);
  } catch {
    return false;
  }
}

async function record(sb: any, row: PaidExpenseRow, email: string, subject: string, html: string, result: { ok: boolean; error?: string }) {
  try {
    const { error } = await sb.from("po_notification_sent").insert({
      company_db: row.company_db,
      po_doc_entry: row.sap_doc_entry ?? -1,
      po_doc_num: row.sap_doc_num ?? null,
      milestone: MILESTONE,
      recipient_email: email,
      email_subject: subject,
      email_html: html,
      status: result.ok ? "sent" : "error",
      error_message: result.ok ? null : (result.error || "falha no envio")?.slice(0, 500),
    });
  } catch (e) {
    console.warn("[expense-paid-notify] registro:", e instanceof Error ? e.message : String(e));
  }
}

async function notifyInApp(sb: any, row: PaidExpenseRow, email: string) {
  try {
    const identifier = email.includes("@") ? email.split("@")[0] : email;
    await sb.from("notifications").insert({
      user_identifier: identifier,
      company_db: row.company_db,
      title: "Pedido de compra pago",
      body: `${row.sap_doc_num ? `PC ${row.sap_doc_num} · ` : ""}${row.supplier_name || ""} · ${money(row.total_amount, row.currency)}`.trim(),
      category: "integration",
      link: `/compras?doc=${row.id}`,
      metadata: { ref_id: `paid:${row.id}:${email}`, expense_id: row.id },
    });
  } catch { /* silencioso */ }
}

/**
 * Envia a notificação de pedido pago para fornecedor, solicitante e aprovadores.
 * Aceita a linha da despesa já carregada ou apenas o id.
 */
export async function notifyExpensePaid(
  sb: any,
  input: PaidExpenseRow | { id: string },
): Promise<{ sent: number; skipped: number; errors: number }> {
  const summary = { sent: 0, skipped: 0, errors: 0 };
  try {
    let row = input as PaidExpenseRow;
    if (!("company_db" in input) || row.company_db === undefined) {
      const { data, error } = await sb.from("expenses").select(EXPENSE_FIELDS).eq("id", input.id).maybeSingle();
      if (error || !data) return summary;
      row = data as PaidExpenseRow;
    }
    if ((row.doc_type || "").toLowerCase() === "sales") return summary;

    const supplier = await supplierEmail(sb, row);
    const targets: Array<{ email: string; name: string | null; audience: Audience }> = [];

    if (supplier.email) targets.push({ email: supplier.email, name: supplier.name, audience: "supplier" });

    const requester = normEmail(row.requester_email);
    if (isEmail(requester)) targets.push({ email: requester, name: row.requester_name || null, audience: "requester" });

    for (const approver of await approverRecipients(sb, row)) {
      if (targets.some((t) => t.email === approver.email)) continue;
      targets.push({ ...approver, audience: "approver" });
    }

    const docLabel = row.sap_doc_num ? `PC #${row.sap_doc_num}` : `PC ${String(row.id).slice(0, 8).toUpperCase()}`;
    const subject = `[${row.company_db || "ERP Flow"}] Pedido de compra pago — ${docLabel}`;

    for (const target of targets) {
      if (await alreadySent(sb, row, target.email)) {
        summary.skipped++;
        continue;
      }
      const html = renderHtml(row, target.audience, target.name);
      const result = await sendEmail(target.email, subject, html);
      await record(sb, row, target.email, subject, html, result);
      if (result.ok) {
        summary.sent++;
        if (target.audience !== "supplier") await notifyInApp(sb, row, target.email);
      } else {
        summary.errors++;
        console.warn(`[expense-paid-notify] falha para ${target.email}: ${result.error}`);
      }
    }
  } catch (e) {
    console.warn("[expense-paid-notify] erro inesperado:", e instanceof Error ? e.message : String(e));
  }
  return summary;
}
