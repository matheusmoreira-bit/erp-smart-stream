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
import { getChannelSettings } from "./notification-channels.ts";


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
  /** Explica POR QUE este destinatário é o aprovador atual (trilha de auditoria). */
  resolution?: ApproverResolution | null;
}

/** Origem/justificativa da resolução do aprovador atual. */
export interface ApproverResolution {
  /** matrix_rule | next_level | manual_reassign | sla_escalation | substitute | self_approval_escalation | default_fallback */
  source: string;
  reason?: string | null;
  ruleId?: string | null;
  ruleName?: string | null;
  matrixVersion?: string | null;
  costCenter?: string | null;
  project?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Registra na trilha de auditoria quem recebeu a notificação de um documento
 * e por qual regra/matriz essa pessoa foi resolvida como aprovador atual.
 * Best-effort: nunca interrompe o envio.
 */
export async function logNotificationAudit(admin: any, entry: {
  expenseId?: string | null;
  companyDb?: string | null;
  docType?: string | null;
  channel: string;
  recipient: string;
  recipientName?: string | null;
  recipientRole?: string;
  levelOrder?: number | null;
  eventKey?: string;
  status?: string;
  amount?: number | null;
  currency?: string | null;
  resolution?: ApproverResolution | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const r = entry.resolution || null;
    await admin.from("notification_audit_log").insert({
      expense_id: entry.expenseId || null,
      company_db: entry.companyDb || null,
      doc_type: entry.docType || null,
      channel: entry.channel,
      recipient: String(entry.recipient || "").trim().toLowerCase(),
      recipient_name: entry.recipientName || null,
      recipient_role: entry.recipientRole || "approver",
      level_order: entry.levelOrder ?? null,
      event_key: entry.eventKey || "approval_pending",
      status: entry.status || "sent",
      amount: entry.amount ?? null,
      currency: entry.currency || null,
      resolution_source: r?.source || null,
      resolution_reason: r?.reason || null,
      rule_id: r?.ruleId || null,
      rule_name: r?.ruleName || null,
      matrix_version: r?.matrixVersion || null,
      cost_center: r?.costCenter || null,
      project: r?.project || null,
      metadata: { ...(entry.metadata || {}), ...(r?.metadata || {}) },
    });
  } catch (e) {
    console.warn("[approval-notify] audit log falhou:", e instanceof Error ? e.message : String(e));
  }
}


function buildEmailHtml(title: string, subtitle: string, details: ApprovalNotifyDetail[], approveUrl: string | null, appUrl: string) {
  const rows = details
    .filter((d) => d.value !== null && d.value !== undefined && String(d.value).trim() !== "")
    .map(
      (d, i) =>
        `<tr>` +
        `<td style="padding:10px 12px;background:${i % 2 ? "#ffffff" : "#f8fafc"};color:#64748b;font-size:13px;` +
        `border-bottom:1px solid #eef2f7;white-space:nowrap;vertical-align:top">${esc(d.label)}</td>` +
        `<td style="padding:10px 12px;background:${i % 2 ? "#ffffff" : "#f8fafc"};color:#0f172a;font-size:14px;` +
        `font-weight:600;border-bottom:1px solid #eef2f7">${esc(d.value)}</td>` +
        `</tr>`,
    )
    .join("");
  const btn = (label: string, href: string, bg: string, color: string, border: string) =>
    `<a href="${esc(href)}" style="display:block;width:100%;box-sizing:border-box;text-align:center;padding:14px 12px;margin:0 0 10px;` +
    `background:${bg};color:${color};border:1px solid ${border};border-radius:10px;font-size:15px;font-weight:700;` +
    `text-decoration:none;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">${esc(label)}</a>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(subtitle)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
  <tr><td style="background:#0f172a;padding:14px 20px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:.4px">ERP FLOW</td></tr>
  <tr><td style="padding:22px 20px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h1 style="margin:0 0 6px;font-size:19px;line-height:1.35;color:#0f172a;font-weight:700">${esc(title)}</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#475569">${esc(subtitle)}</p>
  </td></tr>
  ${rows ? `<tr><td style="padding:0 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eef2f7;border-radius:10px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">${rows}</table></td></tr>` : ""}
  <tr><td style="padding:0 20px 4px">
    ${approveUrl ? btn("Aprovar", `${approveUrl}?a=approve`, "#0f766e", "#ffffff", "#0f766e") : ""}
    ${approveUrl ? btn("Reprovar", `${approveUrl}?a=reject`, "#ffffff", "#b91c1c", "#fecaca") : ""}
    ${btn("Abrir no ERP Flow", appUrl, "#f8fafc", "#0f172a", "#e2e8f0")}
  </td></tr>
  <tr><td style="padding:8px 20px 22px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;color:#94a3b8;line-height:1.6;border-top:1px solid #f1f5f9">
    O link de decis&atilde;o &eacute; pessoal, de uso &uacute;nico e expira em 72 horas.<br>
    Mensagem autom&aacute;tica do ERP Flow.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
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
    url: opts.appUrl,
  });
  blocks.push({ type: "actions", elements });
  await slackCall("chat.postMessage", { channel, text: opts.title, blocks, unfurl_links: false });
}

/**
 * Notifica o aprovador designado de um documento pendente nos canais ativos.
 * Best-effort — nunca interrompe a operação de negócio.
 */
/** Nome amigável da empresa (fallback: o próprio company_db). */
async function resolveCompanyName(admin: any, companyDb?: string | null): Promise<string | null> {
  const db = (companyDb || "").trim();
  if (!db) return null;
  try {
    const { data } = await admin
      .from("companies")
      .select("display_name")
      .eq("company_db", db)
      .maybeSingle();
    return (data?.display_name as string | undefined)?.trim() || db;
  } catch {
    return db;
  }
}

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
    const companyName = await resolveCompanyName(admin, input.companyDb);
    const baseTitle = isSales
      ? "Pedido de venda aguardando sua aprovação"
      : "Documento aguardando sua aprovação";
    const title = companyName ? `${companyName} — ${baseTitle}` : baseTitle;
    const subtitle = `${input.requesterName || "Um solicitante"} enviou um documento para sua alçada${
      input.levelOrder ? ` (nível ${input.levelOrder})` : ""
    }.`;
    const details: ApprovalNotifyDetail[] = input.details ?? [
      { label: isSales ? "Cliente" : "Fornecedor", value: input.supplierName },
      { label: "Valor", value: amount },
      { label: "Empresa", value: companyName || input.companyDb },
      { label: "Solicitante", value: input.requesterName },
    ];

    // Base comum da trilha de auditoria
    const auditBase = {
      expenseId: input.expenseId,
      companyDb: input.companyDb,
      docType: input.docType ?? null,
      recipient: email || identifier,
      recipientName: input.approverName ?? null,
      recipientRole: "approver",
      levelOrder: input.levelOrder ?? null,
      eventKey: "approval_pending",
      amount: input.totalAmount ?? null,
      currency: input.currency ?? null,
      resolution: input.resolution ?? null,
    };

    // Canais habilitados para esta empresa / tipo de evento
    const baseChannels = await getChannelSettings(admin, input.companyDb, "approval_pending");

    const refId = `${input.expenseId}:${input.levelOrder ?? 0}`;
    const docLink = `/aprovacoes?doc=${encodeURIComponent(`internal:${input.expenseId}`)}`;
    const bodyText = [subtitle, ...details.filter((d) => d.value).map((d) => `${d.label}: ${d.value}`)].join(" · ");
    const appUrl = appPublicUrl();

    /** Entrega a notificação para um destinatário (titular ou substituto). */
    const deliver = async (rcpt: {
      email: string;
      name?: string | null;
      role: "approver" | "substitute";
      ref: string;
      title: string;
      subtitle: string;
      body: string;
      /** Sobrepõe os canais da empresa (usado pelas preferências do substituto). */
      channelOverride?: { in_app: boolean; email: boolean; push: boolean; slack: boolean };
    }) => {
      const channels = rcpt.channelOverride
        ? {
            in_app: baseChannels.in_app && rcpt.channelOverride.in_app,
            email: baseChannels.email && rcpt.channelOverride.email,
            push: baseChannels.push && rcpt.channelOverride.push,
            slack: baseChannels.slack && rcpt.channelOverride.slack,
          }
        : baseChannels;
      const rcptEmail = (rcpt.email || "").trim().toLowerCase();
      const rcptIdentifier = rcptEmail && isEmail(rcptEmail)
        ? rcptEmail.split("@")[0]
        : (rcpt.name || "").trim().toLowerCase() || rcptEmail;
      if (!rcptEmail && !rcptIdentifier) return;

      const audit = {
        ...auditBase,
        recipient: rcptEmail || rcptIdentifier,
        recipientName: rcpt.name ?? null,
        recipientRole: rcpt.role,
      };

      // In-app (dedupe por documento + nível + destinatário)
      const { data: existing } = await admin
        .from("notifications")
        .select("id")
        .eq("category", "approval")
        .contains("metadata", { ref_id: rcpt.ref })
        .limit(1);
      if (existing && existing.length > 0) {
        await logNotificationAudit(admin, { ...audit, channel: "in_app", status: "skipped_duplicate" });
        return;
      }

      if (channels.in_app) {
        await admin.from("notifications").insert({
          user_identifier: rcptIdentifier,
          company_db: input.companyDb || null,
          title: rcpt.title,
          body: rcpt.body,
          category: "approval",
          link: docLink,
          metadata: {
            ref_id: rcpt.ref,
            expense_id: input.expenseId,
            level_order: input.levelOrder ?? null,
            ...(rcpt.role === "substitute"
              ? { substitute_for: (input.approverEmail || input.approverName || "").toLowerCase() }
              : {}),
          },
        });
        await logNotificationAudit(admin, { ...audit, channel: "in_app" });
      } else {
        await logNotificationAudit(admin, { ...audit, channel: "in_app", status: "skipped_channel_disabled" });
      }

      if (channels.push) {
        await pushToRecipient(admin, rcptIdentifier, { title: rcpt.title, body: rcpt.body, url: docLink, tag: rcpt.ref });
        await logNotificationAudit(admin, { ...audit, channel: "push" });
      } else {
        await logNotificationAudit(admin, { ...audit, channel: "push", status: "skipped_channel_disabled" });
      }

      if (!channels.email && !channels.slack) return;
      if (!rcptEmail || !isEmail(rcptEmail)) {
        await logNotificationAudit(admin, { ...audit, channel: "email", status: "skipped_no_email" });
        return;
      }

      const token = await issueApprovalToken(admin, {
        expenseId: input.expenseId,
        approverEmail: rcptEmail,
        approverName: rcpt.name,
        levelOrder: input.levelOrder,
        channel: "email",
      });
      const approveUrl = token ? `${appUrl}/aprovar/${token}` : null;

      if (channels.email) {
        await sendEmail(
          [rcptEmail],
          `[ERP Flow] ${rcpt.title}`,
          buildEmailHtml(rcpt.title, rcpt.subtitle, details, approveUrl, `${appUrl}${docLink}`),
        );
        await logNotificationAudit(admin, { ...audit, channel: "email" });
      } else {
        await logNotificationAudit(admin, { ...audit, channel: "email", status: "skipped_channel_disabled" });
      }

      if (channels.slack) {
        await sendSlackApproval({
          email: rcptEmail, title: rcpt.title, subtitle: rcpt.subtitle, details, approveUrl, appUrl: `${appUrl}${docLink}`,
        });
        if (slackEnabled()) await logNotificationAudit(admin, { ...audit, channel: "slack" });
      } else {
        await logNotificationAudit(admin, { ...audit, channel: "slack", status: "skipped_channel_disabled" });
      }
    };

    // 1) Aprovador titular
    await deliver({
      email,
      name: input.approverName,
      role: "approver",
      ref: refId,
      title,
      subtitle,
      body: bodyText,
    });

    // 2) Substitutos vigentes do titular — recebem a mesma solicitação, com
    //    aviso de que estão respondendo em nome do aprovador oficial.
    for (const sub of await activeSubstitutesFor(admin, {
      officialEmail: email,
      officialName: input.approverName,
      companyDb: input.companyDb,
    })) {
      const prefs = await substitutePrefs(admin, sub.email, sub.name);
      if (!prefs.enabled) {
        console.log("[approval-notify] substituto optou por não receber avisos:", sub.email);
        continue;
      }
      if (prefs.min_amount > 0 && Number(input.totalAmount || 0) < prefs.min_amount) {
        console.log("[approval-notify] valor abaixo do mínimo configurado pelo substituto:", sub.email);
        continue;
      }
      const officialLabel = input.approverName || email || "o aprovador titular";
      const subTitle = `${title} (em nome de ${officialLabel})`;
      const subSubtitle = `${subtitle} Você está como aprovador substituto de ${officialLabel}.`;
      await deliver({
        email: sub.email,
        name: sub.name,
        role: "substitute",
        ref: `${refId}:sub:${(sub.email || sub.name || "").toLowerCase()}`,
        title: subTitle,
        subtitle: subSubtitle,
        body: [subSubtitle, ...details.filter((d) => d.value).map((d) => `${d.label}: ${d.value}`)].join(" · "),
        channelOverride: {
          in_app: prefs.in_app,
          email: prefs.email,
          push: prefs.push,
          slack: prefs.slack,
        },
      });
    }
  } catch (e) {
    console.warn("[approval-notify] erro inesperado:", e instanceof Error ? e.message : String(e));
  }
}


/** Preferências de notificação por substituição (padrão: tudo ligado). */
const SUBSTITUTE_PREF_DEFAULT = {
  enabled: true, in_app: true, email: true, push: true, slack: true, min_amount: 0,
};

async function substitutePrefs(
  admin: any,
  email?: string | null,
  name?: string | null,
): Promise<typeof SUBSTITUTE_PREF_DEFAULT> {
  const raw = String(email || name || "").trim().toLowerCase();
  const identifier = raw.includes("@") ? raw.split("@")[0] : raw;
  if (!identifier) return SUBSTITUTE_PREF_DEFAULT;
  try {
    const { data } = await admin
      .from("substitute_notification_preferences")
      .select("enabled,in_app,email,push,slack,min_amount")
      .eq("user_identifier", identifier)
      .maybeSingle();
    if (!data) return SUBSTITUTE_PREF_DEFAULT;
    return {
      enabled: data.enabled !== false,
      in_app: data.in_app !== false,
      email: data.email !== false,
      push: data.push !== false,
      slack: data.slack !== false,
      min_amount: Number(data.min_amount || 0),
    };
  } catch {
    return SUBSTITUTE_PREF_DEFAULT;
  }
}

/**
 * Substitutos com delegação VIGENTE (janela ativa e não revogada) para o
 * aprovador titular informado. O escopo por empresa é respeitado quando o
 * grant tem `company_db` (nulo = todas as empresas).
 */
async function activeSubstitutesFor(admin: any, params: {
  officialEmail?: string | null;
  officialName?: string | null;
  companyDb?: string | null;
}): Promise<Array<{ email: string; name: string | null }>> {
  const out: Array<{ email: string; name: string | null }> = [];
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const prefix = (v: string) => (v.includes("@") ? v.split("@")[0] : v);
  const keys = new Set(
    [norm(params.officialEmail), norm(params.officialName)]
      .filter(Boolean)
      .flatMap((v) => [v, prefix(v)]),
  );
  if (keys.size === 0) return out;
  try {
    const nowIso = new Date().toISOString();
    const { data } = await admin
      .from("approver_substitutes")
      .select("company_db, official_email, official_name, substitute_email, substitute_name")
      .is("revoked_at", null)
      .lte("starts_at", nowIso)
      .gte("ends_at", nowIso);
    const seen = new Set<string>();
    for (const r of (data || []) as any[]) {
      if (r.company_db && params.companyDb && norm(r.company_db) !== norm(params.companyDb)) continue;
      const offKeys = [norm(r.official_email), norm(r.official_name)]
        .filter(Boolean)
        .flatMap((v) => [v, prefix(v)]);
      if (!offKeys.some((k) => keys.has(k))) continue;
      const subEmail = norm(r.substitute_email);
      const dedupe = subEmail || norm(r.substitute_name);
      if (!dedupe || seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ email: subEmail, name: r.substitute_name || null });
    }
  } catch (e) {
    console.warn("[approval-notify] substitutos:", e instanceof Error ? e.message : String(e));
  }
  return out;
}
