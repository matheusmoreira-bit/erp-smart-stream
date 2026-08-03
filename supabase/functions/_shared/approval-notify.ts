// Notificação de aprovação multicanal (in-app + e-mail mobile-first + Slack).
//
// Regras:
//   - Best-effort: nunca lança exceção para o fluxo de negócio.
//   - O link de ação é um token de uso único, com validade curta, armazenado
//     apenas como hash (SHA-256) em `public.approval_action_tokens`.
//   - O token vai no PATH da página pública (/aprovar/:token) e a decisão é
//     enviada por POST — nunca em query string com o segredo.
// deno-lint-ignore-file no-explicit-any

import { pushToRecipient } from "./web-push.ts";

const DEFAULT_TTL_HOURS = 72;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

export function appPublicUrl(): string {
  return (Deno.env.get("APP_PUBLIC_URL") || "https://erp-flow.cactuscorporation.com").replace(/\/+$/, "");
}

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

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface IssueTokenInput {
  expenseId: string;
  approverEmail: string;
  approverName?: string | null;
  levelOrder?: number | null;
  channel?: "email" | "slack";
  ttlHours?: number;
}

/** Cria um token de uso único e devolve o valor em claro (guardado só como hash). */
export async function issueApprovalToken(admin: any, input: IssueTokenInput): Promise<string | null> {
  try {
    const token = randomToken();
    const hash = await sha256Hex(token);
    const ttl = input.ttlHours ?? DEFAULT_TTL_HOURS;
    const { error } = await admin.from("approval_action_tokens").insert({
      expense_id: input.expenseId,
      approver_email: input.approverEmail.trim().toLowerCase(),
      approver_name: input.approverName || null,
      level_order: input.levelOrder ?? null,
      channel: input.channel || "email",
      token_hash: hash,
      expires_at: new Date(Date.now() + ttl * 3600_000).toISOString(),
    });
    if (error) {
      console.warn("[approval-notify] falha ao criar token:", error.message);
      return null;
    }
    return token;
  } catch (e) {
    console.warn("[approval-notify] erro ao criar token:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export interface ApprovalNotifyDetail { label: string; value: string | number | null | undefined }

export interface ApprovalNotifyInput {
  expenseId: string;
  companyDb?: string | null;
  approverEmail?: string | null;
  approverName?: string | null;
  levelOrder?: number | null;
  requesterName?: string | null;
  supplierName?: string | null;
  totalAmount?: number | null;
  currency?: string | null;
  docType?: string | null;
  details?: ApprovalNotifyDetail[];
}

function buildEmailHtml(title: string, subtitle: string, details: ApprovalNotifyDetail[], approveUrl: string | null, appUrl: string) {
  const rows = details
    .filter((d) => d.value !== null && d.value !== undefined && String(d.value).trim() !== "")
    .map(
      (d) =>
        `<tr><td style="padding:8px 12px 8px 0;color:#64748b;font-size:14px;white-space:nowrap">${esc(d.label)}</td>` +
        `<td style="padding:8px 0;color:#0f172a;font-size:15px;font-weight:600">${esc(d.value)}</td></tr>`,
    )
    .join("");
  const btn = (label: string, href: string, bg: string, color: string, border: string) =>
    `<a href="${esc(href)}" style="display:block;width:100%;box-sizing:border-box;text-align:center;padding:16px 12px;margin:0 0 12px;` +
    `background:${bg};color:${color};border:1px solid ${border};border-radius:10px;font-size:16px;font-weight:700;text-decoration:none">${esc(label)}</a>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#ffffff;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 20px">
  <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3">${esc(title)}</h1>
  <p style="margin:0 0 18px;font-size:15px;color:#334155">${esc(subtitle)}</p>
  ${rows ? `<table style="border-collapse:collapse;width:100%;margin-bottom:22px">${rows}</table>` : ""}
  ${approveUrl ? btn("Aprovar", `${approveUrl}?a=approve`, "#0f766e", "#ffffff", "#0f766e") : ""}
  ${approveUrl ? btn("Reprovar", `${approveUrl}?a=reject`, "#ffffff", "#b91c1c", "#fecaca") : ""}
  ${btn("Abrir no ERP Flow", `${appUrl}/aprovacoes?tab=pending`, "#f1f5f9", "#0f172a", "#e2e8f0")}
  <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.5">
    O link de decisão é pessoal, de uso único e expira em 72 horas.<br>
    Mensagem automática do ERP Flow.
  </p>
</div></body></html>`;
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
      console.warn("[approval-notify] email falhou", res.status, (await res.text().catch(() => "")).slice(0, 200));
    }
  } catch (e) {
    console.warn("[approval-notify] email erro:", e instanceof Error ? e.message : String(e));
  }
}

// ── Slack ────────────────────────────────────────────────────────────────
// Usa o connector gateway da Lovable (workspace corporativo único).
// Enquanto a conexão Slack não estiver vinculada ao projeto, `SLACK_API_KEY`
// não existe e o envio é ignorado silenciosamente (log apenas).
export function slackEnabled(): boolean {
  return !!Deno.env.get("SLACK_API_KEY") && !!Deno.env.get("LOVABLE_API_KEY");
}

async function slackCall(method: string, body: Record<string, unknown>): Promise<any | null> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const slackKey = Deno.env.get("SLACK_API_KEY");
  if (!lovableKey || !slackKey) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": slackKey,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok || !data?.ok) {
      console.warn(`[approval-notify] slack ${method} falhou [${res.status}]:`, text.slice(0, 300));
      return null;
    }
    return data;
  } catch (e) {
    console.warn("[approval-notify] slack erro:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function resolveSlackChannel(email: string): Promise<string | null> {
  const user = await slackCall("users.lookupByEmail", { email });
  const id = user?.user?.id;
  if (id) return id;
  const fallback = Deno.env.get("SLACK_APPROVALS_CHANNEL");
  return fallback || null;
}

/** Envia (best-effort) o cartão de aprovação no Slack com botões de link. */
export async function sendSlackApproval(opts: {
  email: string;
  title: string;
  subtitle: string;
  details: ApprovalNotifyDetail[];
  approveUrl: string | null;
  appUrl: string;
}): Promise<void> {
  if (!slackEnabled()) return;
  const channel = await resolveSlackChannel(opts.email);
  if (!channel) return;
  const fields = opts.details
    .filter((d) => d.value !== null && d.value !== undefined && String(d.value).trim() !== "")
    .slice(0, 8)
    .map((d) => ({ type: "mrkdwn", text: `*${d.label}*\n${d.value}` }));
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: opts.title.slice(0, 150), emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: opts.subtitle } },
  ];
  if (fields.length) blocks.push({ type: "section", fields });
  const elements: any[] = [];
  if (opts.approveUrl) {
    elements.push({
      type: "button", style: "primary",
      text: { type: "plain_text", text: "Aprovar", emoji: true },
      url: `${opts.approveUrl}?a=approve`,
    });
    elements.push({
      type: "button", style: "danger",
      text: { type: "plain_text", text: "Reprovar", emoji: true },
      url: `${opts.approveUrl}?a=reject`,
    });
  }
  elements.push({
    type: "button",
    text: { type: "plain_text", text: "Abrir no ERP Flow", emoji: true },
    url: `${opts.appUrl}/aprovacoes?tab=pending`,
  });
  blocks.push({ type: "actions", elements });
  await slackCall("chat.postMessage", { channel, text: opts.title, blocks, unfurl_links: false });
}

/**
 * Notifica o aprovador designado de um documento pendente nos canais ativos.
 * Best-effort — nunca interrompe a operação de negócio.
 */
export async function notifyApprovalPending(admin: any, input: ApprovalNotifyInput): Promise<void> {
  try {
    const email = (input.approverEmail || "").trim().toLowerCase();
    const identifier = email && isEmail(email)
      ? email.split("@")[0]
      : (input.approverName || "").trim().toLowerCase();
    if (!email && !identifier) return;

    const amount = typeof input.totalAmount === "number"
      ? `${input.currency || "BRL"} ${Number(input.totalAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
      : null;
    const isSales = String(input.docType) === "sales";
    const title = isSales
      ? "Pedido de venda aguardando sua aprovação"
      : "Documento aguardando sua aprovação";
    const subtitle = `${input.requesterName || "Um solicitante"} enviou um documento para sua alçada${
      input.levelOrder ? ` (nível ${input.levelOrder})` : ""
    }.`;
    const details: ApprovalNotifyDetail[] = input.details ?? [
      { label: isSales ? "Cliente" : "Fornecedor", value: input.supplierName },
      { label: "Valor", value: amount },
      { label: "Empresa", value: input.companyDb },
      { label: "Solicitante", value: input.requesterName },
    ];

    // In-app (dedupe por documento + nível)
    const refId = `${input.expenseId}:${input.levelOrder ?? 0}`;
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("category", "approval")
      .contains("metadata", { ref_id: refId })
      .limit(1);
    if (existing && existing.length > 0) return;

    await admin.from("notifications").insert({
      user_identifier: identifier,
      company_db: input.companyDb || null,
      title,
      body: [subtitle, ...details.filter((d) => d.value).map((d) => `${d.label}: ${d.value}`)].join(" · "),
      category: "approval",
      link: "/aprovacoes?tab=pending",
      metadata: { ref_id: refId, expense_id: input.expenseId, level_order: input.levelOrder ?? null },
    });

    // Push nativo no celular (best-effort, paralelo a e-mail/Slack).
    await pushToRecipient(admin, identifier, {
      title,
      body: [subtitle, ...details.filter((d) => d.value).map((d) => `${d.label}: ${d.value}`)].join(" · "),
      url: "/aprovacoes?tab=pending",
      tag: refId,
    });

    if (!email || !isEmail(email)) return;

    const appUrl = appPublicUrl();
    const token = await issueApprovalToken(admin, {
      expenseId: input.expenseId,
      approverEmail: email,
      approverName: input.approverName,
      levelOrder: input.levelOrder,
      channel: "email",
    });
    const approveUrl = token ? `${appUrl}/aprovar/${token}` : null;

    await sendEmail([email], `[ERP Flow] ${title}`, buildEmailHtml(title, subtitle, details, approveUrl, appUrl));
    await sendSlackApproval({ email, title, subtitle, details, approveUrl, appUrl });
  } catch (e) {
    console.warn("[approval-notify] erro inesperado:", e instanceof Error ? e.message : String(e));
  }
}
