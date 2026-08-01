// Fluxo genérico e paralelo de notificações de AÇÃO.
//
//   notifyActionRequested  → avisa quem PRECISA agir (ex.: aprovador designado)
//   notifyActionCompleted  → avisa quem SOLICITOU, quando a ação foi concluída
//
// Regras:
//   - Best-effort: nunca lança exceção para o fluxo de negócio.
//   - Roda em paralelo aos fluxos existentes (approval-notify, sales-notify…):
//     usa categoria própria (`action`) e dedupe por `ref_id`, então não
//     interfere nem substitui nenhuma notificação atual.
// deno-lint-ignore-file no-explicit-any

export interface ActionNotifyDetail {
  label: string;
  value: string | number | null | undefined;
}

export interface ActionNotifyInput {
  /** Chave do fluxo: approval, registration, integration… */
  actionKey: string;
  /** Identificador único do evento (dedupe em retries). */
  refId: string;
  /** Destinatário: e-mail ou user code. */
  recipient?: string | null;
  recipientName?: string | null;
  companyDb?: string | null;
  title: string;
  summary?: string | null;
  details?: ActionNotifyDetail[];
  link?: string | null;
  /** Categoria da notificação in-app (default: "action"). */
  category?: string;
  /** Envia e-mail além do in-app (default: true). */
  email?: boolean;
}

const CATEGORY = "action";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function identifierFrom(v: string): string {
  const s = v.trim().toLowerCase();
  return s.includes("@") ? s.split("@")[0] : s;
}

function appUrl(): string {
  return (Deno.env.get("APP_PUBLIC_URL") || "https://erp-flow.cactuscorporation.com").replace(/\/+$/, "");
}

function buildHtml(title: string, summary: string | null, details: ActionNotifyDetail[], link: string | null) {
  const rows = details
    .filter((d) => d.value !== null && d.value !== undefined && String(d.value).trim() !== "")
    .map(
      (d) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px">${esc(d.label)}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">${esc(d.value)}</td></tr>`,
    )
    .join("");
  const href = link ? (link.startsWith("http") ? link : `${appUrl()}${link}`) : null;
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 8px;font-size:18px">${esc(title)}</h2>
    ${summary ? `<p style="margin:0 0 16px;font-size:14px;color:#334155">${esc(summary)}</p>` : ""}
    ${rows ? `<table style="border-collapse:collapse;margin-bottom:16px">${rows}</table>` : ""}
    ${href ? `<p style="font-size:13px"><a href="${esc(href)}" style="color:#0ea5e9">Abrir no ERP Flow</a></p>` : ""}
    <p style="margin-top:24px;font-size:12px;color:#94a3b8">Mensagem automática do ERP Flow.</p>
  </div>`;
}

async function sendEmail(to: string[], subject: string, html: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || to.length === 0) return;
  try {
    const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ to, subject, html }),
    });
    if (!res.ok) {
      console.warn("[action-notify] email falhou", res.status, (await res.text().catch(() => "")).slice(0, 200));
    }
  } catch (e) {
    console.warn("[action-notify] email erro:", e instanceof Error ? e.message : String(e));
  }
}

async function dispatch(admin: any, input: ActionNotifyInput, kind: "requested" | "completed"): Promise<void> {
  try {
    const recipient = (input.recipient || "").trim().toLowerCase();
    if (!recipient) return;

    const refId = `${kind}:${input.actionKey}:${input.refId}`;
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("category", input.category || CATEGORY)
      .contains("metadata", { ref_id: refId })
      .limit(1);
    if (existing && existing.length > 0) return;

    const details = input.details ?? [];
    const bodyParts = [
      input.summary,
      ...details.filter((d) => d.value !== null && d.value !== undefined && String(d.value).trim() !== "")
        .map((d) => `${d.label}: ${d.value}`),
    ].filter(Boolean);

    await admin.from("notifications").insert({
      user_identifier: identifierFrom(recipient),
      company_db: input.companyDb || null,
      title: input.title,
      body: bodyParts.join(" · ") || null,
      category: input.category || CATEGORY,
      link: input.link || null,
      metadata: { ref_id: refId, action_key: input.actionKey, kind },
    });

    if (input.email === false || !isEmail(recipient)) return;
    await sendEmail(
      [recipient],
      `[ERP Flow] ${input.title}`,
      buildHtml(input.title, input.summary ?? null, details, input.link ?? null),
    );
  } catch (e) {
    console.warn("[action-notify] erro inesperado:", e instanceof Error ? e.message : String(e));
  }
}

/** Avisa o usuário de que uma nova ação foi solicitada a ele. */
export function notifyActionRequested(admin: any, input: ActionNotifyInput): Promise<void> {
  return dispatch(admin, input, "requested");
}

/** Avisa o solicitante de que a ação pedida por ele foi concluída. */
export function notifyActionCompleted(admin: any, input: ActionNotifyInput): Promise<void> {
  return dispatch(admin, input, "completed");
}
