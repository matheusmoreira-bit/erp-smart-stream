import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";

export interface SupplierRequestAttachment {
  name?: string | null;
  url?: string | null;
  contentType?: string | null;
}

export type RegistrationPaymentMethod = "pix" | "ted" | "doc" | "boleto" | "outro";
export type RegistrationMode = "erpflow" | "sap_manual";

export interface RegistrationBankDetails {
  pixKey?: string | null;
  pixKeyType?: string | null;
  bank?: string | null;
  agency?: string | null;
  account?: string | null;
  accountType?: string | null;
  holderName?: string | null;
  holderTaxId?: string | null;
  other?: string | null;
}

export interface SupplierRequestPayload {
  cardName?: string | null;
  federalTaxId?: string | null;
  email?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  address?: {
    street?: string | null;
    zip?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    block?: string | null;
    building?: string | null;
  };
  currency?: string | null;
  companyDb?: string | null;
  context?: string;
  transaction?: {
    id?: string | number | null;
    description?: string | null;
    amount?: number | null;
    currency?: string | null;
    date?: string | null;
    accountAlias?: string | null;
    accountName?: string | null;
  };
  attachments?: SupplierRequestAttachment[];
  /** Catch-all for any extra raw fields (e.g. AI extraction dump) */
  extra?: Record<string, unknown>;
  requesterName?: string | null;
  /** Ticket data (chamado) */
  requestId?: string | null;
  requestType?: "supplier" | "item";
  paymentMethod?: RegistrationPaymentMethod | null;
  bankDetails?: RegistrationBankDetails | null;
  registrationMode?: RegistrationMode | null;
  notes?: string | null;
  dueAt?: string | null;
}

const TARGET_EMAILS = ["samara.souza@anagaming.com.br", "compras@anagaming.com.br"];

export const PAYMENT_METHOD_LABELS: Record<RegistrationPaymentMethod, string> = {
  pix: "PIX",
  ted: "TED",
  doc: "DOC",
  boleto: "Boleto",
  outro: "Outro",
};

export const REGISTRATION_MODE_LABELS: Record<RegistrationMode, string> = {
  erpflow: "Cadastro com dados bancários via ERP Flow",
  sap_manual: "Cadastro manual no SAP (pelo time responsável)",
};

function escapeHtml(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ────────────────────────────────────────────────────────────────
 * Email design tokens (inline styles — clientes de e-mail ignoram CSS)
 * ─────────────────────────────────────────────────────────────── */
const C = {
  bg: "#f4f5f7",
  card: "#ffffff",
  border: "#e4e7ec",
  brand: "#0f172a",
  accent: "#2563eb",
  text: "#101828",
  muted: "#667085",
};

function row(label: string, value: unknown): string {
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid ${C.border};color:${C.muted};font-size:12px;line-height:1.4;width:38%;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:10px 14px;border-bottom:1px solid ${C.border};color:${C.text};font-size:13px;line-height:1.4;font-weight:600;">${escapeHtml(value)}</td>
  </tr>`;
}

function section(title: string, rows: string): string {
  if (!rows.trim()) return "";
  return `
    <tr><td style="padding:22px 0 8px;">
      <span style="display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};font-weight:700;">${escapeHtml(title)}</span>
    </td></tr>
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;border:1px solid ${C.border};border-radius:10px;overflow:hidden;background:${C.card};">
        ${rows}
      </table>
    </td></tr>`;
}

function shell(title: string, subtitle: string, body: string, footer?: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
        <tr><td style="background:${C.brand};border-radius:12px 12px 0 0;padding:20px 22px;">
          <div style="color:#ffffff;font-size:17px;font-weight:700;line-height:1.3;">${escapeHtml(title)}</div>
          <div style="color:#c7d2fe;font-size:12px;margin-top:4px;line-height:1.5;">${subtitle}</div>
        </td></tr>
        <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:0;border-radius:0 0 12px 12px;padding:6px 22px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
        </td></tr>
        <tr><td style="padding:14px 6px;color:${C.muted};font-size:11px;line-height:1.6;">
          ${footer || "Mensagem gerada automaticamente pelo ERP Flow."}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function fmtCurrency(amount?: number | null, currency?: string | null): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return "—";
  const cur = currency && /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(Number(amount));
  } catch {
    return `${cur} ${Number(amount).toFixed(2)}`;
  }
}

function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function composeAddress(addr: SupplierRequestPayload["address"]): string {
  if (!addr) return "—";
  const parts = [
    addr.street,
    addr.building,
    addr.block,
    addr.city && addr.state ? `${addr.city}/${addr.state}` : addr.city || addr.state,
    addr.zip,
    addr.country,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function bankRows(method?: RegistrationPaymentMethod | null, bank?: RegistrationBankDetails | null): string {
  if (!method && !bank) return "";
  const b = bank || {};
  const rows = [row("Forma de pagamento", method ? PAYMENT_METHOD_LABELS[method] : null)];
  if (method === "pix") {
    rows.push(row("Tipo de chave PIX", b.pixKeyType));
    rows.push(row("Chave PIX", b.pixKey));
  }
  if (method === "ted" || method === "doc") {
    rows.push(row("Banco", b.bank));
    rows.push(row("Agência", b.agency));
    rows.push(row("Conta", b.account));
    rows.push(row("Tipo de conta", b.accountType));
  }
  if (b.holderName || b.holderTaxId) {
    rows.push(row("Titular", b.holderName));
    rows.push(row("CNPJ/CPF do titular", b.holderTaxId));
  }
  if (b.other) rows.push(row("Observação bancária", b.other));
  return rows.join("");
}

export async function requestSupplierRegistration(payload: SupplierRequestPayload): Promise<void> {
  let requesterEmail: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    requesterEmail = data.user?.email ?? null;
  } catch {
    requesterEmail = null;
  }

  const isItem = payload.requestType === "item";
  const kind = isItem ? "item" : "fornecedor";
  const subjectName = payload.cardName || payload.federalTaxId || `novo ${kind}`;
  const ticket = payload.requestId ? payload.requestId.slice(0, 8).toUpperCase() : null;
  const subject = `[Chamado${ticket ? ` ${ticket}` : ""}] Solicitação de cadastro de ${kind} — ${subjectName}`;
  const addr = payload.address || {};
  const tx = payload.transaction;

  const attachments = (payload.attachments || [])
    .filter((a) => a && a.url)
    .map((a) => ({
      url: a.url!,
      filename: a.name || a.url!.split("/").pop()?.split("?")[0] || "anexo",
      contentType: a.contentType || undefined,
    }));

  const attachmentsHtml = attachments.length
    ? `
      <tr><td style="padding:22px 0 8px;">
        <span style="display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};font-weight:700;">Anexos (${attachments.length})</span>
      </td></tr>
      <tr><td style="border:1px solid ${C.border};border-radius:10px;padding:12px 14px;">
        ${attachments
          .map(
            (a) =>
              `<div style="margin:0 0 6px;font-size:13px;"><a href="${escapeHtml(a.url)}" style="color:${C.accent};text-decoration:none;">${escapeHtml(a.filename)}</a></div>`,
          )
          .join("")}
        <div style="margin-top:8px;font-size:11px;color:${C.muted};">Os arquivos também seguem anexados a este e-mail quando o tamanho permite.</div>
      </td></tr>`
    : "";

  const extraRows = payload.extra
    ? Object.entries(payload.extra)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => row(k, typeof v === "object" ? JSON.stringify(v) : v))
        .join("")
    : "";

  const subtitle = [
    `Solicitante: <strong style="color:#ffffff;">${escapeHtml(payload.requesterName || requesterEmail || "—")}</strong>`,
    payload.companyDb ? `Base: ${escapeHtml(payload.companyDb)}` : null,
    ticket ? `Chamado #${ticket}` : null,
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  const slaBanner = payload.dueAt
    ? `<tr><td style="padding:16px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
          <tr><td style="padding:12px 14px;font-size:12px;color:#1e40af;line-height:1.5;">
            <strong>SLA de atendimento: 48 horas úteis</strong><br />Prazo previsto: ${escapeHtml(fmtDateTime(payload.dueAt))}
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const html = shell(
    `Solicitação de cadastro de ${kind}`,
    subtitle,
    `
      ${slaBanner}
      ${section(`Dados do ${kind}`, [
        row("Razão Social / Nome", payload.cardName),
        isItem ? "" : row("CNPJ / CPF / TaxID", payload.federalTaxId),
        row("E-mail", payload.email),
        row("Telefone 1", payload.phone1),
        row("Telefone 2", payload.phone2),
        row("Moeda", payload.currency),
        isItem ? "" : row("Endereço", composeAddress(addr)),
        payload.context ? row("Origem da solicitação", payload.context) : "",
        payload.registrationMode ? row("Forma de cadastro", REGISTRATION_MODE_LABELS[payload.registrationMode]) : "",
      ].join(""))}
      ${section("Pagamento e dados bancários", bankRows(payload.paymentMethod, payload.bankDetails))}
      ${payload.notes ? section("Observações do solicitante", row("Observações", payload.notes)) : ""}
      ${tx ? section("Transação relacionada", [
        row("ID da transação", tx.id),
        row("Data", tx.date),
        row("Descrição", tx.description),
        row("Valor", fmtCurrency(tx.amount, tx.currency)),
        row("Conta / Cartão", tx.accountName || tx.accountAlias),
      ].join("")) : ""}
      ${extraRows ? section("Informações adicionais", extraRows) : ""}
      ${attachmentsHtml}
    `,
    "Acompanhe e conclua esta solicitação em ERP Flow → Cadastros → Solicitações de cadastro.",
  );

  const text = [
    `Solicitação de cadastro de ${kind}: ${subjectName}`,
    ticket ? `Chamado: #${ticket}` : null,
    `Solicitante: ${requesterEmail || payload.requesterName || "—"}`,
    payload.context ? `Contexto: ${payload.context}` : null,
    payload.companyDb ? `Base: ${payload.companyDb}` : null,
    payload.federalTaxId ? `CNPJ/TaxID: ${payload.federalTaxId}` : null,
    payload.email ? `E-mail: ${payload.email}` : null,
    payload.phone1 ? `Telefone: ${payload.phone1}` : null,
    payload.paymentMethod ? `Forma de pagamento: ${PAYMENT_METHOD_LABELS[payload.paymentMethod]}` : null,
    payload.registrationMode ? `Forma de cadastro: ${REGISTRATION_MODE_LABELS[payload.registrationMode]}` : null,
    isItem ? null : `Endereço: ${composeAddress(addr)}`,
    payload.dueAt ? `SLA (48h úteis): ${fmtDateTime(payload.dueAt)}` : null,
    attachments.length ? `Anexos: ${attachments.length}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const cc = requesterEmail && requesterEmail.toLowerCase() !== TARGET_EMAIL ? [requesterEmail] : undefined;

  const { error } = await supabase.functions.invoke("send-smtp-email", {
    body: {
      to: [TARGET_EMAIL],
      cc,
      replyTo: requesterEmail || undefined,
      subject,
      html,
      text,
      attachments,
    },
  });
  if (error) throw error;

  // Fluxo paralelo: avisa o time responsável de que há uma nova ação solicitada.
  await createNotification({
    user_identifier: TARGET_EMAIL,
    title: "Nova solicitação de cadastro aguardando atendimento",
    body: `${payload.cardName || "Solicitação de cadastro"} · Solicitante: ${requesterEmail || "—"}`,
    category: "action",
    company_db: payload.companyDb ?? undefined,
    link: "/solicitacoes",
    metadata: { action_key: "registration", kind: "requested" },
  });
}


/**
 * Notifica o solicitante quando o chamado é concluído (fornecedor/item cadastrado)
 * ou quando muda de status de forma relevante.
 */
export async function sendRegistrationStatusEmail(params: {
  to: string;
  requestId: string;
  requestType: "supplier" | "item";
  title: string;
  status: string;
  statusLabel: string;
  sapCardCode?: string | null;
  resolutionNote?: string | null;
  handledBy?: string | null;
}): Promise<void> {
  const kind = params.requestType === "item" ? "item" : "fornecedor";
  const ticket = params.requestId.slice(0, 8).toUpperCase();
  const done = params.status === "concluido";
  const subject = done
    ? `[Chamado ${ticket}] Cadastro de ${kind} concluído — ${params.title}`
    : `[Chamado ${ticket}] Atualização da solicitação — ${params.title}`;

  const html = shell(
    done ? `Cadastro de ${kind} concluído` : "Atualização da sua solicitação",
    `Chamado #${ticket} &nbsp;·&nbsp; ${escapeHtml(params.title)}`,
    `
      ${section("Resumo", [
        row("Status", params.statusLabel),
        row(`${kind === "item" ? "Item" : "Fornecedor"}`, params.title),
        params.sapCardCode ? row("Código no ERP", params.sapCardCode) : "",
        params.handledBy ? row("Atendido por", params.handledBy) : "",
        params.resolutionNote ? row("Observações", params.resolutionNote) : "",
      ].join(""))}
      <tr><td style="padding:18px 0 0;font-size:13px;color:${C.text};line-height:1.6;">
        ${done
          ? `O cadastro já está disponível no ERP Flow e pode ser utilizado nos seus documentos.`
          : `Sua solicitação foi atualizada pelo time responsável.`}
      </td></tr>
    `,
    "Você recebeu este e-mail porque abriu uma solicitação de cadastro no ERP Flow.",
  );

  const text = [
    done ? `Cadastro de ${kind} concluído` : "Atualização da sua solicitação",
    `Chamado: #${ticket}`,
    `${kind}: ${params.title}`,
    `Status: ${params.statusLabel}`,
    params.sapCardCode ? `Código no ERP: ${params.sapCardCode}` : null,
    params.resolutionNote ? `Observações: ${params.resolutionNote}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Fluxo paralelo: avisa o solicitante em app sobre o desfecho do chamado.
  await createNotification({
    user_identifier: params.to,
    title: done ? `Cadastro de ${kind} concluído` : "Atualização da sua solicitação",
    body: [`Chamado #${ticket}`, params.title, `Status: ${params.statusLabel}`, params.sapCardCode ? `Código no ERP: ${params.sapCardCode}` : null]
      .filter(Boolean)
      .join(" · "),
    category: "action",
    link: "/solicitacoes",
    metadata: { action_key: "registration", kind: "completed", request_id: params.requestId },
  });

  const { error } = await supabase.functions.invoke("send-smtp-email", {
    body: { to: [params.to], subject, html, text },
  });
  if (error) throw error;
}

