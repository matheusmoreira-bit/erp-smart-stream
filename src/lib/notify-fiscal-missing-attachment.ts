// Notifica o time fiscal sempre que uma despesa ou pedido de venda é
// integrado ao ERP SEM anexo. Como não há arquivo para reencaminhar,
// enviamos um e-mail resumido com os metadados do documento (fornecedor,
// datas, itens, totais, centro de custo/projeto) para que o time possa
// solicitar o anexo ao usuário depois.
//
// Best-effort: falhas de envio nunca devem quebrar o fluxo de criação —
// o chamador captura e apenas registra no console.

import { supabase } from "@/integrations/supabase/client";

const FISCAL_EMAIL = "fiscal@anagaming.com.br";
const EXTRA_MISSING_ATTACHMENT_RECIPIENTS = ["leonardo.oliveira@anagaming.com.br"];

export interface MissingAttachmentItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cost_center?: string;
  project?: string;
}

export interface MissingAttachmentPayload {
  docType: "expenses" | "sales" | "purchase";
  supplierName: string;
  supplierCode?: string;
  currency?: string;
  docDate?: string;
  dueDate?: string;
  costCenter?: string;
  project?: string;
  remarks?: string;
  origin?: string;
  companyDb?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  items: MissingAttachmentItem[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMoney(n: number, currency: string): string {
  const c = (currency || "BRL").toUpperCase();
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: c }).format(n || 0);
  } catch {
    return `${c} ${(n || 0).toFixed(2)}`;
  }
}

export async function notifyFiscalMissingAttachment(payload: MissingAttachmentPayload): Promise<void> {
  const label = payload.docType === "sales" ? "Pedido de Venda" : "Despesa";
  const currency = payload.currency || "BRL";
  const total = payload.items.reduce((acc, it) => acc + (Number(it.line_total) || 0), 0);

  const subject = `[SEM ANEXO] ${label} integrada ao ERP — ${payload.supplierName}`;

  const lines: string[] = [
    `${label} integrada ao ERP SEM anexo do documento original.`,
    "",
    `Fornecedor/Cliente: ${payload.supplierName}${payload.supplierCode ? ` (${payload.supplierCode})` : ""}`,
    payload.docDate ? `Data do documento: ${payload.docDate}` : null,
    payload.dueDate ? `Vencimento: ${payload.dueDate}` : null,
    `Moeda: ${currency}`,
    `Total: ${fmtMoney(total, currency)}`,
    payload.costCenter ? `Centro de custo (cabeçalho): ${payload.costCenter}` : null,
    payload.project ? `Projeto (cabeçalho): ${payload.project}` : null,
    payload.origin ? `Origem: ${payload.origin}` : null,
    payload.companyDb ? `Base SAP: ${payload.companyDb}` : null,
    payload.requesterName || payload.requesterEmail
      ? `Solicitante: ${[payload.requesterName, payload.requesterEmail].filter(Boolean).join(" · ")}`
      : null,
    payload.remarks ? `Observações: ${payload.remarks}` : null,
    "",
    "Itens:",
    ...payload.items.map(
      (it, i) =>
        `  ${i + 1}. ${it.description || "(sem descrição)"} — ${it.quantity} × ${fmtMoney(
          it.unit_price,
          currency,
        )} = ${fmtMoney(it.line_total, currency)}${it.cost_center ? ` [CC ${it.cost_center}]` : ""}${
          it.project ? ` [Proj ${it.project}]` : ""
        }`,
    ),
    "",
    "AÇÃO: solicite ao usuário o anexo do documento original para complementar o lançamento.",
  ].filter(Boolean) as string[];

  const text = lines.join("\n");

  const itemsRows = payload.items
    .map(
      (it, i) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${i + 1}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(it.description || "(sem descrição)")}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${it.quantity}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(fmtMoney(it.unit_price, currency))}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(fmtMoney(it.line_total, currency))}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(it.cost_center || "")}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(it.project || "")}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
      <p style="background:#fff3cd;border:1px solid #ffe69c;padding:10px 12px;border-radius:6px;margin:0 0 12px">
        <strong>⚠️ ${label} integrada ao ERP SEM anexo do documento original.</strong><br>
        Solicite ao usuário o envio do documento para complementar o lançamento.
      </p>
      <table style="border-collapse:collapse;margin-bottom:12px">
        <tbody>
          <tr><td style="padding:4px 10px;color:#666">Fornecedor/Cliente</td><td style="padding:4px 10px"><strong>${escapeHtml(payload.supplierName)}</strong>${payload.supplierCode ? ` (${escapeHtml(payload.supplierCode)})` : ""}</td></tr>
          ${payload.docDate ? `<tr><td style="padding:4px 10px;color:#666">Data do documento</td><td style="padding:4px 10px">${escapeHtml(payload.docDate)}</td></tr>` : ""}
          ${payload.dueDate ? `<tr><td style="padding:4px 10px;color:#666">Vencimento</td><td style="padding:4px 10px">${escapeHtml(payload.dueDate)}</td></tr>` : ""}
          <tr><td style="padding:4px 10px;color:#666">Moeda</td><td style="padding:4px 10px">${escapeHtml(currency)}</td></tr>
          <tr><td style="padding:4px 10px;color:#666">Total</td><td style="padding:4px 10px"><strong>${escapeHtml(fmtMoney(total, currency))}</strong></td></tr>
          ${payload.costCenter ? `<tr><td style="padding:4px 10px;color:#666">Centro de custo</td><td style="padding:4px 10px">${escapeHtml(payload.costCenter)}</td></tr>` : ""}
          ${payload.project ? `<tr><td style="padding:4px 10px;color:#666">Projeto</td><td style="padding:4px 10px">${escapeHtml(payload.project)}</td></tr>` : ""}
          ${payload.origin ? `<tr><td style="padding:4px 10px;color:#666">Origem</td><td style="padding:4px 10px">${escapeHtml(payload.origin)}</td></tr>` : ""}
          ${payload.companyDb ? `<tr><td style="padding:4px 10px;color:#666">Base SAP</td><td style="padding:4px 10px">${escapeHtml(payload.companyDb)}</td></tr>` : ""}
          ${payload.requesterName || payload.requesterEmail ? `<tr><td style="padding:4px 10px;color:#666">Solicitante</td><td style="padding:4px 10px">${escapeHtml([payload.requesterName, payload.requesterEmail].filter(Boolean).join(" · "))}</td></tr>` : ""}
          ${payload.remarks ? `<tr><td style="padding:4px 10px;color:#666;vertical-align:top">Observações</td><td style="padding:4px 10px;white-space:pre-wrap">${escapeHtml(payload.remarks)}</td></tr>` : ""}
        </tbody>
      </table>
      <h4 style="margin:0 0 6px">Itens</h4>
      <table style="border-collapse:collapse;width:100%;border:1px solid #eee">
        <thead>
          <tr style="background:#f7f7f7">
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">#</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">Descrição</th>
            <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">Qtd</th>
            <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">Vl. Unit.</th>
            <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">Vl. Total</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">CC</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">Projeto</th>
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
      </table>
    </div>
  `;

  const cc =
    payload.requesterEmail && payload.requesterEmail.toLowerCase() !== FISCAL_EMAIL
      ? [payload.requesterEmail]
      : undefined;

  const { error } = await supabase.functions.invoke("send-smtp-email", {
    body: {
      to: [FISCAL_EMAIL],
      cc,
      replyTo: payload.requesterEmail || undefined,
      subject,
      html,
      text,
    },
  });
  if (error) throw error;
}
