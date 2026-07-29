// Notificações do fluxo de vendas (marcos do ciclo Pedido → NFS-e → Baixa).
//
// Marcos cobertos:
//   approval_pending → aprovador designado do pedido de venda
//   approved         → time de vendas/faturamento (watchers)
//   nfse_issued      → watchers
//   nfse_emailed     → watchers
//   nfse_settled     → watchers
//
// Regras:
//   - Nunca lança exceção: notificação é best-effort e não pode derrubar
//     a operação de negócio (aprovação, emissão, baixa).
//   - Sempre grava notificação in-app (`public.notifications`) e tenta e-mail
//     via `send-smtp-email`.
// deno-lint-ignore-file no-explicit-any

export type SalesMilestone =
  | "approval_pending"
  | "approved"
  | "nfse_issued"
  | "nfse_emailed"
  | "nfse_settled";

/** Destinatários fixos dos marcos pós-aprovação do fluxo de vendas. */
export const SALES_WATCHER_EMAILS = ["larissa.manzalli@cactusgaming.net"];

const CATEGORY = "sales";

const MILESTONE_TITLES: Record<SalesMilestone, string> = {
  approval_pending: "Pedido de venda aguardando sua aprovação",
  approved: "Pedido de venda aprovado",
  nfse_issued: "NFS-e emitida",
  nfse_emailed: "NFS-e enviada ao cliente",
  nfse_settled: "Baixa de NFS-e registrada",
};

export interface SalesNotifyDetail {
  label: string;
  value: string | number | null | undefined;
}

export interface SalesNotifyInput {
  milestone: SalesMilestone;
  companyDb?: string | null;
  /** Identificador único do evento (evita duplicidade em retries). */
  refId: string;
  /** Destinatários extras além dos watchers padrão (e-mail ou user code). */
  recipients?: Array<string | null | undefined>;
  /** Quando true, ignora os watchers fixos e usa apenas `recipients`. */
  recipientsOnly?: boolean;
  link?: string | null;
  summary?: string | null;
  details?: SalesNotifyDetail[];
}

function identifierFrom(recipient: string): string {
  const v = recipient.trim().toLowerCase();
  return v.includes("@") ? v.split("@")[0] : v;
}

function isEmail(recipient: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim());
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(title: string, summary: string | null, details: SalesNotifyDetail[], link?: string | null) {
  const rows = details
    .filter((d) => d.value !== null && d.value !== undefined && String(d.value).trim() !== "")
    .map(
      (d) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px">${esc(d.label)}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">${esc(d.value)}</td></tr>`,
    )
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 8px;font-size:18px">${esc(title)}</h2>
    ${summary ? `<p style="margin:0 0 16px;font-size:14px;color:#334155">${esc(summary)}</p>` : ""}
    ${rows ? `<table style="border-collapse:collapse;margin-bottom:16px">${rows}</table>` : ""}
    ${link ? `<p style="font-size:13px"><a href="${esc(link)}" style="color:#0ea5e9">Abrir no ERP Flow</a></p>` : ""}
    <p style="margin-top:24px;font-size:12px;color:#94a3b8">Mensagem automática do ERP Flow — fluxo de vendas.</p>
  </div>`;
}

async function sendEmail(to: string[], subject: string, html: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || to.length === 0) return;
  const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!res.ok) {
    console.warn("[sales-notify] email falhou", res.status, (await res.text().catch(() => "")).slice(0, 200));
  }
}

/**
 * Dispara a notificação de um marco do fluxo de vendas.
 * Best-effort: erros são apenas logados.
 */
export async function notifySalesMilestone(admin: any, input: SalesNotifyInput): Promise<void> {
  try {
    const title = MILESTONE_TITLES[input.milestone];
    const details = input.details ?? [];
    const summary = input.summary ?? null;

    const raw = [
      ...(input.recipients ?? []),
      ...(input.recipientsOnly ? [] : SALES_WATCHER_EMAILS),
    ]
      .map((r) => (r ? String(r).trim() : ""))
      .filter(Boolean)
      // Nomes completos (com espaço) não são identificadores válidos.
      .filter((r) => isEmail(r) || !/\s/.test(r));
    const unique = Array.from(new Set(raw.map((r) => r.toLowerCase())));
    if (unique.length === 0) return;

    // Dedupe: mesmo marco + mesma referência não notifica duas vezes.
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("category", CATEGORY)
      .contains("metadata", { milestone: input.milestone, ref_id: input.refId })
      .limit(1);
    if (existing && existing.length > 0) return;

    const bodyText = [summary, ...details
      .filter((d) => d.value !== null && d.value !== undefined && String(d.value).trim() !== "")
      .map((d) => `${d.label}: ${d.value}`)]
      .filter(Boolean)
      .join(" · ");

    const rows = unique.map((r) => ({
      user_identifier: identifierFrom(r),
      company_db: input.companyDb || null,
      title,
      body: bodyText || null,
      category: CATEGORY,
      link: input.link || null,
      metadata: { milestone: input.milestone, ref_id: input.refId },
    }));
    const { error } = await admin.from("notifications").insert(rows);
    if (error) console.warn("[sales-notify] insert falhou:", error.message);

    const emails = unique.filter(isEmail);
    await sendEmail(emails, `[ERP Flow] ${title}`, buildHtml(title, summary, details, input.link));
  } catch (e) {
    console.warn("[sales-notify] erro inesperado:", e instanceof Error ? e.message : String(e));
  }
}
