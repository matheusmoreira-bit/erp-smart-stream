import { supabase } from "@/integrations/supabase/client";

export interface SupplierRequestAttachment {
  name?: string | null;
  url?: string | null;
  contentType?: string | null;
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
}

const TARGET_EMAIL = "compras@anagaming.com.br";

function escapeHtml(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function row(label: string, value: unknown): string {
  return `<tr><td style="padding:6px 10px;color:#666;font-size:12px;vertical-align:top;white-space:nowrap;">${label}</td><td style="padding:6px 10px;font-size:13px;color:#111;"><strong>${escapeHtml(value)}</strong></td></tr>`;
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

export async function requestSupplierRegistration(payload: SupplierRequestPayload): Promise<void> {
  let requesterEmail: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    requesterEmail = data.user?.email ?? null;
  } catch {
    requesterEmail = null;
  }

  const subjectName = payload.cardName || payload.federalTaxId || "novo fornecedor";
  const subject = `Solicitação de cadastro de fornecedor — ${subjectName}`;
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
      <h3 style="margin:18px 0 6px;font-size:14px;">Anexos (${attachments.length})</h3>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:#444;">
        ${attachments
          .map(
            (a) =>
              `<li><a href="${escapeHtml(a.url)}" style="color:#0a58ca;">${escapeHtml(a.filename)}</a></li>`,
          )
          .join("")}
      </ul>
      <p style="margin:6px 0 0;font-size:11px;color:#888;">Os arquivos também seguem como anexo deste e-mail quando o tamanho permite.</p>
    `
    : "";

  const extraRows = payload.extra
    ? Object.entries(payload.extra)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => row(k, typeof v === "object" ? JSON.stringify(v) : v))
        .join("")
    : "";

  const html = `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.45;">
      <h2 style="margin:0 0 8px;">Solicitação de cadastro de fornecedor</h2>
      <p style="margin:0 0 12px;color:#444;font-size:13px;">
        Solicitante: <strong>${escapeHtml(payload.requesterName || requesterEmail || "—")}</strong>
        ${requesterEmail ? ` &lt;${escapeHtml(requesterEmail)}&gt;` : ""}
        ${payload.context ? ` · Contexto: <strong>${escapeHtml(payload.context)}</strong>` : ""}
        ${payload.companyDb ? ` · Base: <strong>${escapeHtml(payload.companyDb)}</strong>` : ""}
      </p>

      <h3 style="margin:14px 0 6px;font-size:14px;">Dados do fornecedor</h3>
      <table style="border-collapse:collapse;border:1px solid #eee;width:100%;max-width:680px;">
        ${row("Razão Social / Nome", payload.cardName)}
        ${row("CNPJ / CPF / TaxID", payload.federalTaxId)}
        ${row("E-mail", payload.email)}
        ${row("Telefone 1", payload.phone1)}
        ${row("Telefone 2", payload.phone2)}
        ${row("Moeda", payload.currency)}
        ${row("Endereço completo", composeAddress(addr))}
        ${row("Logradouro", addr.street)}
        ${row("Número", addr.building)}
        ${row("Bairro", addr.block)}
        ${row("Cidade", addr.city)}
        ${row("UF", addr.state)}
        ${row("CEP", addr.zip)}
        ${row("País", addr.country)}
      </table>

      ${tx ? `
        <h3 style="margin:18px 0 6px;font-size:14px;">Transação relacionada</h3>
        <table style="border-collapse:collapse;border:1px solid #eee;width:100%;max-width:680px;">
          ${row("ID da transação", tx.id)}
          ${row("Data", tx.date)}
          ${row("Descrição", tx.description)}
          ${row("Valor", fmtCurrency(tx.amount, tx.currency))}
          ${row("Conta / Cartão", tx.accountName || tx.accountAlias)}
        </table>
      ` : ""}

      ${extraRows ? `
        <h3 style="margin:18px 0 6px;font-size:14px;">Informações adicionais</h3>
        <table style="border-collapse:collapse;border:1px solid #eee;width:100%;max-width:680px;">
          ${extraRows}
        </table>
      ` : ""}

      ${attachmentsHtml}

      <p style="margin-top:18px;font-size:12px;color:#888;">
        Esta solicitação foi gerada automaticamente pelo ERP Flow. Responda diretamente ao solicitante para alinhar dados pendentes.
      </p>
    </div>
  `;

  const text = [
    `Solicitação de cadastro de fornecedor: ${subjectName}`,
    `Solicitante: ${requesterEmail || payload.requesterName || "—"}`,
    payload.context ? `Contexto: ${payload.context}` : null,
    payload.companyDb ? `Base: ${payload.companyDb}` : null,
    payload.federalTaxId ? `CNPJ/TaxID: ${payload.federalTaxId}` : null,
    payload.email ? `E-mail: ${payload.email}` : null,
    payload.phone1 ? `Telefone: ${payload.phone1}` : null,
    `Endereço: ${composeAddress(addr)}`,
    attachments.length ? `Anexos: ${attachments.length}` : null,
  ].filter(Boolean).join("\n");

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
}
