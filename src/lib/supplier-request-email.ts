import { supabase } from "@/integrations/supabase/client";

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
    block?: string | null;
    building?: string | null;
  };
  companyDb?: string | null;
  context?: string; // ex: "PagCorp", "Compras"
  transaction?: {
    description?: string;
    amount?: number;
    currency?: string;
    date?: string;
  };
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
  return `<tr><td style="padding:4px 8px;color:#666;font-size:12px;">${label}</td><td style="padding:4px 8px;font-size:13px;"><strong>${escapeHtml(value)}</strong></td></tr>`;
}

export async function requestSupplierRegistration(payload: SupplierRequestPayload): Promise<void> {
  // Resolve requester email from auth
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
  const html = `
    <div style="font-family:Arial,sans-serif;color:#111;">
      <h2 style="margin:0 0 8px;">Solicitação de cadastro de fornecedor</h2>
      <p style="margin:0 0 12px;color:#444;">
        Solicitante: <strong>${escapeHtml(payload.requesterName || requesterEmail || "—")}</strong>
        ${requesterEmail ? ` &lt;${escapeHtml(requesterEmail)}&gt;` : ""}
        ${payload.context ? ` · Contexto: <strong>${escapeHtml(payload.context)}</strong>` : ""}
        ${payload.companyDb ? ` · Base: <strong>${escapeHtml(payload.companyDb)}</strong>` : ""}
      </p>
      <table style="border-collapse:collapse;border:1px solid #eee;width:100%;max-width:640px;">
        ${row("Razão Social", payload.cardName)}
        ${row("CNPJ / TaxID", payload.federalTaxId)}
        ${row("E-mail", payload.email)}
        ${row("Telefone 1", payload.phone1)}
        ${row("Telefone 2", payload.phone2)}
        ${row("Endereço", addr.street)}
        ${row("CEP", addr.zip)}
        ${row("Cidade", addr.city)}
        ${row("UF", addr.state)}
        ${row("Bairro", addr.block)}
        ${row("Número", addr.building)}
      </table>
      ${payload.transaction ? `
        <h3 style="margin:16px 0 6px;font-size:14px;">Transação relacionada</h3>
        <table style="border-collapse:collapse;border:1px solid #eee;width:100%;max-width:640px;">
          ${row("Descrição", payload.transaction.description)}
          ${row("Valor", payload.transaction.amount !== undefined ? `${payload.transaction.currency || "BRL"} ${Number(payload.transaction.amount).toFixed(2)}` : "—")}
          ${row("Data", payload.transaction.date)}
        </table>
      ` : ""}
      <p style="margin-top:16px;font-size:12px;color:#888;">
        Esta solicitação foi gerada automaticamente pelo ERP Flow. Responda diretamente ao solicitante para alinhar dados pendentes.
      </p>
    </div>
  `;

  const recipients = [TARGET_EMAIL];
  if (requesterEmail && requesterEmail.toLowerCase() !== TARGET_EMAIL) {
    recipients.push(requesterEmail);
  }

  const { error } = await supabase.functions.invoke("send-smtp-email", {
    body: {
      to: recipients,
      subject,
      html,
      text: `Solicitação de cadastro de fornecedor: ${subjectName}. Solicitante: ${requesterEmail || "—"}.`,
    },
  });
  if (error) throw error;
}
