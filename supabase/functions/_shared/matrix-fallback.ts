// Fallback global da matriz de regras de aprovação.
//
// Regra (todas as empresas): quando NENHUMA regra de aprovação é encontrada
// para o documento, o aprovador passa a ser Matheus Moreira — nunca um admin
// genérico. Além disso, disparamos um alerta por e-mail avisando que a matriz
// está com lacuna (CC/projeto/faixa sem alçada).

export const MATRIX_FALLBACK_APPROVER = {
  name: "Matheus Moreira",
  email: "matheus.moreira@anagaming.com.br",
} as const;

/** Destinatários do alerta de falha na matriz (secret APPROVAL_MATRIX_ALERT_EMAILS). */
export function matrixAlertRecipients(): string[] {
  const raw = Deno.env.get("APPROVAL_MATRIX_ALERT_EMAILS") || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export interface MatrixGapInfo {
  companyDb: string;
  docType?: string | null;
  expenseId?: string | null;
  costCenter?: string | null;
  project?: string | null;
  totalAmount?: number | null;
  currency?: string | null;
  requester?: string | null;
  reason?: string | null;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml(info: MatrixGapInfo): string {
  const rows: Array<[string, unknown]> = [
    ["Empresa", info.companyDb],
    ["Documento", info.expenseId],
    ["Tipo", info.docType],
    ["Centro de custo", info.costCenter],
    ["Projeto", info.project],
    ["Valor", info.totalAmount != null ? `${info.currency || "BRL"} ${Number(info.totalAmount).toFixed(2)}` : null],
    ["Solicitante", info.requester],
    ["Motivo", info.reason || "Nenhuma regra ativa casou com os critérios do documento"],
    ["Aprovador aplicado", MATRIX_FALLBACK_APPROVER.name],
  ];
  const body = rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px">${esc(k)}</td>` +
      `<td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">${esc(v)}</td></tr>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 8px;font-size:18px">Falha na matriz de regras de aprovação</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#334155">Um documento não encontrou regra de aprovação e foi direcionado ao aprovador de contingência global.</p>
    <table style="border-collapse:collapse;margin-bottom:16px">${body}</table>
    <p style="margin-top:24px;font-size:12px;color:#94a3b8">Mensagem automática do ERP Flow.</p>
  </div>`;
}

/** Envia o alerta de lacuna na matriz (best-effort, nunca lança). */
export async function notifyMatrixGap(info: MatrixGapInfo): Promise<void> {
  try {
    const to = matrixAlertRecipients();
    if (to.length === 0) {
      console.warn("[matrix-fallback] APPROVAL_MATRIX_ALERT_EMAILS não configurado — alerta não enviado");
      return;
    }
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({
        to,
        subject: `[ERP Flow] Falha na matriz de aprovação — ${info.companyDb}`,
        html: buildHtml(info),
      }),
    });
    if (!res.ok) {
      console.warn("[matrix-fallback] e-mail falhou", res.status, (await res.text().catch(() => "")).slice(0, 200));
    }
  } catch (e) {
    console.warn("[matrix-fallback] erro:", e instanceof Error ? e.message : String(e));
  }
}
