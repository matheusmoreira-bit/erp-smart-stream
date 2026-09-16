// Notificação de "Nova despesa criada" — fluxo exclusivo da Cactus Tecnologia.
//
// Ao criar uma despesa (compras) na base SBO_CACTUS, envia e-mail para a lista
// fixa de destinatários com um resumo da despesa no corpo e o relatório em PDF
// (mesmo conteúdo do PDF exportado na tela de despesa) em anexo.
//
// Best-effort: nunca lança — notificação não pode quebrar a criação.
// deno-lint-ignore-file no-explicit-any

export const CACTUS_TECNOLOGIA_DB = "SBO_CACTUS";

export const CACTUS_NEW_EXPENSE_RECIPIENTS = [
  "thiago.andrade@cactusgaming.net",
  "eduardo.kiefer@cactusgaming.net",
  "robson.luiz@cactusgaming.net",
];

interface ExpenseRow {
  id: string;
  company_db: string | null;
  doc_type?: string | null;
  status?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  current_approver?: string | null;
  cost_center?: string | null;
  project?: string | null;
  remarks?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  doc_date?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  origin?: string | null;
}

interface ItemRow {
  item_code?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
  cost_center?: string | null;
  project?: string | null;
}

const EXPENSE_FIELDS =
  "id, company_db, doc_type, status, supplier_code, supplier_name, requester_name, requester_email, " +
  "current_approver, cost_center, project, remarks, total_amount, currency, doc_date, due_date, created_at, origin";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

/** Datas puras (YYYY-MM-DD) não podem passar por fuso — formatamos direto. */
function formatDate(value?: string | null): string {
  const s = String(value || "").trim();
  if (!s) return "—";
  const pure = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (pure) return `${pure[3]}/${pure[2]}/${pure[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function appUrl(): string {
  return (Deno.env.get("APP_PUBLIC_URL") || "https://erp-flow.cactuscorporation.com").replace(/\/+$/, "");
}

function docLabel(row: ExpenseRow): string {
  return `#${String(row.id).slice(0, 8).toUpperCase()}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Remove acentos — as fontes padrão do jsPDF não têm glifos Unicode completos. */
function ascii(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
}

/** Gera o relatório da despesa em PDF (base64). Retorna null se falhar. */
async function buildExpensePdfBase64(row: ExpenseRow, items: ItemRow[]): Promise<string | null> {
  try {
    const { jsPDF } = await import("https://esm.sh/jspdf@2.5.2");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 16;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(ascii(`Despesa — ${row.supplier_name || row.supplier_code || "—"}`), 10, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(ascii(`${docLabel(row)} · Cactus Tecnologia`), 10, y);
    doc.setTextColor(0, 0, 0);
    y += 8;

    doc.setFillColor(241, 245, 249);
    doc.rect(8, y, pageW - 16, 12, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(ascii(row.status || "—"), 12, y + 8);
    doc.text(ascii(money(row.total_amount, row.currency)), pageW - 12, y + 8, { align: "right" });
    y += 18;

    const fields: Array<[string, string]> = [
      ["Fornecedor", `${row.supplier_name || "—"}${row.supplier_code ? ` (${row.supplier_code})` : ""}`],
      ["Solicitante", `${row.requester_name || "—"}${row.requester_email ? ` <${row.requester_email}>` : ""}`],
      ["Moeda", row.currency || "BRL"],
      ["Aprovador atual", row.current_approver || "—"],
      ["Data do documento", formatDate(row.doc_date)],
      ["Vencimento", formatDate(row.due_date)],
      ["Centro de custo", row.cost_center || "—"],
      ["Projeto", row.project || "—"],
      ["Empresa", row.company_db || "—"],
      ["Origem", row.origin || "manual"],
    ];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("CABECALHO", 10, y);
    doc.setDrawColor(203, 213, 225);
    doc.line(10, y + 1, pageW - 10, y + 1);
    y += 6;
    for (const [label, value] of fields) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(ascii(label), 10, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(ascii(value).slice(0, 90), 55, y);
      doc.setTextColor(0, 0, 0);
      y += 6;
      if (y > 270) { doc.addPage(); y = 16; }
    }

    if (row.remarks) {
      y += 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("OBSERVACOES", 10, y);
      doc.line(10, y + 1, pageW - 10, y + 1);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      for (const line of doc.splitTextToSize(ascii(row.remarks), pageW - 20)) {
        doc.text(line, 10, y);
        y += 5;
        if (y > 275) { doc.addPage(); y = 16; }
      }
    }

    if (items.length > 0) {
      y += 4;
      if (y > 250) { doc.addPage(); y = 16; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("ITENS", 10, y);
      doc.line(10, y + 1, pageW - 10, y + 1);
      y += 6;
      doc.setFontSize(8);
      doc.text("Codigo", 10, y);
      doc.text("Descricao", 35, y);
      doc.text("Qtd", 130, y, { align: "right" });
      doc.text("Unitario", 158, y, { align: "right" });
      doc.text("Total", pageW - 10, y, { align: "right" });
      y += 5;
      doc.setFont("helvetica", "normal");
      for (const it of items) {
        doc.text(ascii(it.item_code || "—").slice(0, 14), 10, y);
        doc.text(ascii(it.description || "—").slice(0, 52), 35, y);
        doc.text(String(Number(it.quantity) || 0), 130, y, { align: "right" });
        doc.text(ascii(money(it.unit_price, row.currency)), 158, y, { align: "right" });
        doc.text(ascii(money(it.line_total, row.currency)), pageW - 10, y, { align: "right" });
        y += 5;
        if (y > 280) { doc.addPage(); y = 16; }
      }
      y += 2;
      doc.setFont("helvetica", "bold");
      doc.text(ascii(`Total: ${money(row.total_amount, row.currency)}`), pageW - 10, y, { align: "right" });
    }

    const pages = doc.getNumberOfPages();
    const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(ascii(`Gerado em ${stamp} · ERP Flow`), 10, doc.internal.pageSize.getHeight() - 6);
      doc.text(`Pagina ${i} de ${pages}`, pageW - 10, doc.internal.pageSize.getHeight() - 6, { align: "right" });
    }

    return bytesToBase64(new Uint8Array(doc.output("arraybuffer") as ArrayBuffer));
  } catch (e) {
    console.warn("[expense-created-notify] falha ao gerar PDF:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

function renderHtml(row: ExpenseRow, hasPdf: boolean): string {
  const link = `${appUrl()}/compras?doc=${encodeURIComponent(row.id)}`;
  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:#0f172a;padding:20px 24px;color:#fff">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7">ERP Flow · Cactus Tecnologia</div>
      <div style="font-size:20px;font-weight:600;margin-top:4px">Nova despesa criada</div>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 20px;font-size:14px;line-height:1.5">
        Uma nova despesa foi criada na Cactus Tecnologia. O relatório completo ${hasPdf ? "segue em anexo (PDF)" : "está disponível no ERP Flow"}.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 0;color:#6b7280">Documento</td><td style="padding:6px 0;text-align:right">${esc(docLabel(row))}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Fornecedor</td><td style="padding:6px 0;text-align:right">${esc(row.supplier_name || row.supplier_code || "-")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Valor</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(money(row.total_amount, row.currency))}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Vencimento</td><td style="padding:6px 0;text-align:right">${esc(formatDate(row.due_date))}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Solicitante</td><td style="padding:6px 0;text-align:right">${esc(row.requester_name || row.requester_email || "-")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Centro de custo</td><td style="padding:6px 0;text-align:right">${esc(row.cost_center || "-")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Status</td><td style="padding:6px 0;text-align:right">${esc(row.status || "-")}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px"><a href="${esc(link)}" style="color:#0ea5e9">Abrir no ERP Flow</a></p>
      <p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.5">Notificação automática — não responda a este email.</p>
    </div>
  </div>
</body></html>`;
}

function buildSubject(row: ExpenseRow): string {
  return [
    "SAP",
    "Cactus Tecnologia",
    "Nova Despesa",
    row.supplier_name || row.supplier_code || "Fornecedor",
    money(row.total_amount, row.currency),
    formatDate(row.due_date),
  ].join(" - ");
}

async function alreadyNotified(sb: any, refId: string): Promise<boolean> {
  try {
    const { data } = await sb
      .from("notifications")
      .select("id")
      .eq("category", "expense_created")
      .contains("metadata", { ref_id: refId })
      .limit(1);
    return !!(data && data.length);
  } catch {
    return false;
  }
}

async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  attachments: Array<{ filename: string; contentType: string; content: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || to.length === 0) return { ok: false, error: "ambiente sem credenciais de envio" };
  try {
    const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ to, subject, html, attachments }),
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Envia o e-mail de nova despesa da Cactus Tecnologia (corpo resumido + PDF).
 * Ignora silenciosamente outras empresas e documentos de venda.
 */
export async function notifyCactusExpenseCreated(
  sb: any,
  input: { id: string } | ExpenseRow,
): Promise<{ sent: number; skipped: number; errors: number }> {
  const summary = { sent: 0, skipped: 0, errors: 0 };
  try {
    let row = input as ExpenseRow;
    if (!("company_db" in input) || row.company_db === undefined) {
      const { data, error } = await sb.from("expenses").select(EXPENSE_FIELDS).eq("id", input.id).maybeSingle();
      if (error || !data) return summary;
      row = data as ExpenseRow;
    }
    if ((row.company_db || "") !== CACTUS_TECNOLOGIA_DB) return summary;
    if ((row.doc_type || "").toLowerCase() === "sales") return summary;

    const refId = `expense_created:${row.id}`;
    if (await alreadyNotified(sb, refId)) {
      summary.skipped = CACTUS_NEW_EXPENSE_RECIPIENTS.length;
      return summary;
    }

    const { data: itemRows } = await sb
      .from("expense_items")
      .select("item_code, description, quantity, unit_price, line_total, cost_center, project")
      .eq("expense_id", row.id);

    const pdf = await buildExpensePdfBase64(row, (itemRows || []) as ItemRow[]);
    const subject = buildSubject(row);
    const html = renderHtml(row, !!pdf);
    const attachments = pdf
      ? [{
        filename: `Despesa_${String(row.id).slice(0, 8).toUpperCase()}.pdf`,
        contentType: "application/pdf",
        content: pdf,
      }]
      : [];

    const result = await sendEmail(CACTUS_NEW_EXPENSE_RECIPIENTS, subject, html, attachments);
    if (!result.ok) {
      summary.errors = CACTUS_NEW_EXPENSE_RECIPIENTS.length;
      console.warn("[expense-created-notify] falha no envio:", result.error);
      return summary;
    }
    summary.sent = CACTUS_NEW_EXPENSE_RECIPIENTS.length;

    for (const email of CACTUS_NEW_EXPENSE_RECIPIENTS) {
      try {
        await sb.from("notifications").insert({
          user_identifier: email.split("@")[0],
          company_db: row.company_db,
          title: "Nova despesa criada",
          body: `${row.supplier_name || "-"} · ${money(row.total_amount, row.currency)} · vence ${formatDate(row.due_date)}`,
          category: "expense_created",
          link: `/compras?doc=${row.id}`,
          metadata: { ref_id: refId, expense_id: row.id },
        });
      } catch { /* silencioso */ }
    }
  } catch (e) {
    console.warn("[expense-created-notify] erro inesperado:", e instanceof Error ? e.message : String(e));
  }
  return summary;
}
