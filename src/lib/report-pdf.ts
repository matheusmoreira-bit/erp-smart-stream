/**
 * Exportação de relatórios em PDF.
 *
 * - `exportListReportPdf`: relatório tabular (uma linha por registro) para
 *   listagens (Aprovações, Compras, Vendas, Histórico...).
 * - `exportExpenseDetailPdf`: relatório de detalhe do pedido/despesa
 *   individual — cabeçalho, campos, itens, integração ERP, histórico de
 *   eventos e anexos (listagem de nomes; o download continua sendo pelo app).
 *
 * O layout foca em legibilidade em A4 retrato, tipografia sem serifa e
 * respeita o modo claro (o PDF é sempre gerado em fundo branco).
 */

import { jsPDF } from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";

// ---- utilidades comuns ------------------------------------------------------

function formatCurrency(value: number | null | undefined, currency: string = "BRL"): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(Number(value));
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch { return String(iso); }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
    });
  } catch { return String(iso); }
}

function safeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9-_]+/g, "_").slice(0, 80) || "relatorio";
}

function drawHeader(doc: jsPDF, title: string, subtitle?: string) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageW, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, 10, 11);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(subtitle, 10, 16);
  }
  doc.setTextColor(0, 0, 0);
}

function drawFooter(doc: jsPDF, generatedBy?: string | null) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const left = `Gerado em ${stamp}${generatedBy ? ` por ${generatedBy}` : ""}`;
    doc.text(left, 10, pageH - 6);
    doc.text(`Página ${i} de ${pageCount}`, pageW - 10, pageH - 6, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);
}

async function currentUserEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email ?? null;
  } catch { return null; }
}

// ---- Relatório de LISTA (tabular) ------------------------------------------

export interface ListReportColumn<Row> {
  header: string;
  /** Extrai o valor da célula como string já formatada. */
  cell: (row: Row) => string;
  /** Largura em unidades autoTable (aproximadamente mm). Opcional. */
  width?: number;
  align?: "left" | "right" | "center";
}

export interface ListReportOptions<Row> {
  title: string;
  subtitle?: string;
  columns: ListReportColumn<Row>[];
  rows: Row[];
  /** Metadados adicionais mostrados como bloco `chave: valor` no topo. */
  meta?: Array<{ label: string; value: string }>;
  /** Nome do arquivo (sem extensão). */
  fileName?: string;
}

export async function exportListReportPdf<Row>(opts: ListReportOptions<Row>): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  drawHeader(doc, opts.title, opts.subtitle || `${opts.rows.length} registro(s)`);

  let cursorY = 24;
  if (opts.meta && opts.meta.length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    for (const m of opts.meta) {
      doc.text(`${m.label}: ${m.value}`, 10, cursorY);
      cursorY += 4;
    }
    cursorY += 2;
    doc.setTextColor(0, 0, 0);
  }

  const head = [opts.columns.map((c) => c.header)];
  const body = opts.rows.map((r) => opts.columns.map((c) => c.cell(r)));
  const columnStyles: NonNullable<UserOptions["columnStyles"]> = {};
  opts.columns.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.width ?? "auto", halign: c.align ?? "left" };
  });

  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles,
    margin: { left: 8, right: 8 },
  });

  drawFooter(doc, await currentUserEmail());
  doc.save(`${safeFileName(opts.fileName || opts.title)}_${Date.now()}.pdf`);
}

// ---- Relatório de DETALHE (pedido / despesa individual) --------------------

export interface DetailAttachment {
  file_name: string;
  file_size?: number | null;
  mime_type?: string | null;
}

export interface DetailEvent {
  when: string;
  label: string;
  actor?: string | null;
  detail?: string | null;
}

export interface DetailField {
  label: string;
  value: string;
  /** Ocupa uma célula (padrão) ou a largura toda da grid de 2 colunas. */
  wide?: boolean;
}

export interface DetailSection {
  title: string;
  fields?: DetailField[];
  /** Bloco livre de texto (ex.: observações longas). */
  paragraph?: string;
}

export interface DetailItemsRow {
  code?: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cost_center?: string | null;
  project?: string | null;
}

export interface DetailReportOptions {
  title: string;
  subtitle?: string;
  statusBadge?: { label: string };
  headline?: string; // ex.: valor total formatado
  sections: DetailSection[];
  items?: DetailItemsRow[];
  itemsCurrency?: string;
  events?: DetailEvent[];
  attachments?: DetailAttachment[];
  fileName?: string;
}

export async function exportDetailReportPdf(opts: DetailReportOptions): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  drawHeader(doc, opts.title, opts.subtitle);

  const pageW = doc.internal.pageSize.getWidth();
  let cursorY = 24;

  // Banner com status + headline (valor total)
  if (opts.statusBadge || opts.headline) {
    doc.setFillColor(241, 245, 249);
    doc.rect(8, cursorY, pageW - 16, 12, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    if (opts.statusBadge) {
      doc.setTextColor(30, 41, 59);
      doc.text(opts.statusBadge.label, 12, cursorY + 8);
    }
    if (opts.headline) {
      doc.setTextColor(15, 23, 42);
      doc.text(opts.headline, pageW - 12, cursorY + 8, { align: "right" });
    }
    doc.setTextColor(0, 0, 0);
    cursorY += 16;
  }

  // Seções (grid 2 colunas)
  const renderSection = (s: DetailSection) => {
    if (cursorY > 260) { doc.addPage(); cursorY = 15; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(s.title.toUpperCase(), 10, cursorY);
    doc.setDrawColor(203, 213, 225);
    doc.line(10, cursorY + 1, pageW - 10, cursorY + 1);
    cursorY += 5;
    doc.setTextColor(0, 0, 0);

    if (s.fields && s.fields.length > 0) {
      const col1X = 10;
      const col2X = pageW / 2 + 2;
      let col = 0;
      for (const f of s.fields) {
        const x = f.wide ? col1X : col === 0 ? col1X : col2X;
        if (f.wide && col === 1) {
          cursorY += 10; col = 0;
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(f.label, x, cursorY);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        const maxW = (f.wide ? pageW - 20 : pageW / 2 - 12);
        const lines = doc.splitTextToSize(f.value || "—", maxW);
        doc.text(lines, x, cursorY + 4);
        const consumed = 4 + (lines.length - 1) * 4 + 5;
        if (f.wide) {
          cursorY += consumed; col = 0;
        } else if (col === 0) {
          col = 1;
          // não avança Y — a próxima cell vai na col2
        } else {
          cursorY += Math.max(10, consumed);
          col = 0;
        }
        if (cursorY > 265) { doc.addPage(); cursorY = 15; col = 0; }
      }
      if (col === 1) cursorY += 10;
    }

    if (s.paragraph) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(s.paragraph, pageW - 20);
      doc.text(lines, 10, cursorY);
      cursorY += lines.length * 4 + 2;
    }
    cursorY += 3;
    doc.setTextColor(0, 0, 0);
  };

  for (const s of opts.sections) renderSection(s);

  // Itens (tabela)
  if (opts.items && opts.items.length > 0) {
    if (cursorY > 240) { doc.addPage(); cursorY = 15; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("ITENS", 10, cursorY);
    cursorY += 2;
    const cur = opts.itemsCurrency || "BRL";
    autoTable(doc, {
      startY: cursorY,
      head: [["Cód.", "Descrição", "Qtd", "V. Unit.", "Total", "C. Custo", "Projeto"]],
      body: opts.items.map((it) => [
        it.code || "—",
        it.description || "—",
        String(it.quantity ?? 0),
        formatCurrency(it.unit_price, cur),
        formatCurrency(it.line_total, cur),
        it.cost_center || "—",
        it.project || "—",
      ]),
      styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" },
      },
      margin: { left: 8, right: 8 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 6;
  }

  // Histórico
  if (opts.events && opts.events.length > 0) {
    if (cursorY > 240) { doc.addPage(); cursorY = 15; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("HISTÓRICO", 10, cursorY);
    cursorY += 2;
    autoTable(doc, {
      startY: cursorY,
      head: [["Data / Hora", "Evento", "Responsável", "Detalhe"]],
      body: opts.events.map((e) => [
        formatDateTime(e.when),
        e.label,
        e.actor || "—",
        e.detail || "—",
      ]),
      styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 30 } },
      margin: { left: 8, right: 8 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 6;
  }

  // Anexos
  if (opts.attachments && opts.attachments.length > 0) {
    if (cursorY > 250) { doc.addPage(); cursorY = 15; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("ANEXOS", 10, cursorY);
    cursorY += 2;
    autoTable(doc, {
      startY: cursorY,
      head: [["Arquivo", "Tipo", "Tamanho"]],
      body: opts.attachments.map((a) => [
        a.file_name,
        a.mime_type || "—",
        a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 8, right: 8 },
    });
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const y = (doc as any).lastAutoTable.finalY + 3;
    doc.text("Os arquivos anexos devem ser baixados diretamente pelo aplicativo (links protegidos).", 10, y);
  }

  drawFooter(doc, await currentUserEmail());
  doc.save(`${safeFileName(opts.fileName || opts.title)}_${Date.now()}.pdf`);
}

// ---- Adapter específico para Expense (compra/venda) ------------------------

// Tipos alinhados com src/hooks/useExpenses.ts sem criar dependência cíclica.
interface ExpenseLike {
  id: string;
  supplier_code?: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  cost_center?: string;
  project?: string;
  remarks?: string;
  status: string;
  requester_name: string;
  requester_email?: string;
  current_approver?: string;
  sap_doc_entry?: number;
  sap_doc_num?: number;
  sap_integration_error?: string | null;
  sap_purchase_order_status?: string | null;
  sap_attachment_status?: string | null;
  sap_integration_last_attempt_at?: string | null;
  origin?: string;
  created_by_email?: string;
  company_db?: string;
  doc_date?: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  items?: Array<{
    item_code?: string;
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    cost_center?: string;
    project?: string;
  }>;
  attachments?: Array<{ file_name: string; file_size?: number; mime_type?: string }>;
}

export async function exportExpenseDetailPdf(
  expense: ExpenseLike,
  opts: { statusLabel: string; mode?: "purchase" | "sales" } = { statusLabel: "" },
): Promise<void> {
  const isSales = opts.mode === "sales";
  const bpLabel = isSales ? "Cliente" : "Fornecedor";
  const kindLabel = isSales ? "Pedido de Venda" : "Despesa";

  // Busca eventos do histórico direto do banco (mesmo select do componente).
  const { data: logRows } = await supabase
    .from("expense_approval_log")
    .select("decision,approver_name,approver_email,level_order,remarks,decided_at")
    .eq("expense_id", expense.id)
    .order("decided_at", { ascending: true });

  const decisionLabel: Record<string, string> = {
    created: "Criado",
    submitted: "Enviado para aprovação",
    approved: "Aprovado",
    rejected: "Rejeitado",
    cancelled: "Cancelado",
    integrated: "Integrado ao ERP",
    integration_failed: "Falha na integração",
  };
  const events: DetailEvent[] = (logRows ?? []).map((r) => ({
    when: r.decided_at,
    label: decisionLabel[r.decision as string] ?? r.decision,
    actor: r.approver_name || r.approver_email || null,
    detail: [
      r.level_order ? `Nível ${r.level_order}` : null,
      r.remarks || null,
    ].filter(Boolean).join(" · ") || null,
  }));

  await exportDetailReportPdf({
    title: `${kindLabel} — ${expense.supplier_name}`,
    subtitle: `#${expense.id.slice(0, 8)}${expense.sap_doc_num ? ` · ERP ${expense.sap_doc_num}` : ""}`,
    statusBadge: { label: opts.statusLabel || expense.status },
    headline: formatCurrency(expense.total_amount, expense.currency),
    sections: [
      {
        title: "Cabeçalho",
        fields: [
          { label: bpLabel, value: expense.supplier_name + (expense.supplier_code ? ` (${expense.supplier_code})` : "") },
          { label: "Solicitante", value: `${expense.requester_name}${expense.requester_email ? ` <${expense.requester_email}>` : ""}` },
          { label: "Moeda", value: expense.currency || "—" },
          { label: "Aprovador atual", value: expense.current_approver || "—" },
          { label: "Data do documento", value: formatDate(expense.doc_date) },
          { label: "Vencimento", value: formatDate(expense.due_date) },
          { label: "C. Custo padrão", value: expense.cost_center || "—" },
          { label: "Projeto", value: expense.project || "—" },
          { label: "Empresa", value: expense.company_db || "—" },
          { label: "Origem", value: expense.origin || "manual" },
          { label: "Criado em", value: formatDateTime(expense.created_at) },
          { label: "Atualizado em", value: formatDateTime(expense.updated_at) },
        ],
      },
      ...(expense.remarks
        ? [{ title: "Observações", paragraph: expense.remarks }] as DetailSection[]
        : []),
      ...(expense.sap_doc_entry || expense.sap_doc_num || expense.sap_integration_error
        ? [{
            title: "Integração ERP",
            fields: [
              { label: "Documento ERP", value: expense.sap_doc_num ? `#${expense.sap_doc_num}${expense.sap_doc_entry ? ` (entry ${expense.sap_doc_entry})` : ""}` : "—" },
              { label: "Status PC", value: expense.sap_purchase_order_status || "—" },
              { label: "Status Anexo", value: expense.sap_attachment_status || "—" },
              { label: "Última tentativa", value: formatDateTime(expense.sap_integration_last_attempt_at) },
              ...(expense.sap_integration_error
                ? [{ label: "Erro", value: expense.sap_integration_error, wide: true } as DetailField]
                : []),
            ],
          }] as DetailSection[]
        : []),
    ],
    items: (expense.items ?? []).map((it) => ({
      code: it.item_code,
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_total: it.line_total,
      cost_center: it.cost_center,
      project: it.project,
    })),
    itemsCurrency: expense.currency,
    events,
    attachments: expense.attachments,
    fileName: `${kindLabel}_${expense.supplier_name}_${expense.id.slice(0, 8)}`,
  });
}

// ---- Resumo da fila de IA (auditoria do processamento por fornecedor) ------

export interface QueueSummaryEntry {
  supplierLabel: string;
  status: "pending" | "queued" | "success" | "failed" | "cancelled";
  fileCount: number;
  lineCount: number;
  estimatedTotal: number;
  currency: string;
  currencies: string[];
  aiConfidence: number | null;
  aiWarnings: string[];
  errorMessage?: string;
  fileNames: string[];
}

export interface QueueSummaryOptions {
  entries: QueueSummaryEntry[];
  /** Limite (0-1) usado para marcar linhas com baixa confiança. */
  confidenceThreshold: number;
  /** "Despesa" | "Pedido de venda" — usado apenas no título. */
  kindLabel?: string;
  fileName?: string;
}

const STATUS_LABEL: Record<QueueSummaryEntry["status"], string> = {
  success: "Criada",
  failed: "Falhou",
  cancelled: "Cancelada",
  pending: "Em andamento",
  queued: "Na fila",
};

export async function exportQueueSummaryPdf(opts: QueueSummaryOptions): Promise<void> {
  const { entries, confidenceThreshold } = opts;
  const kind = opts.kindLabel || "Despesas";
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  drawHeader(
    doc,
    `Resumo da fila de IA — ${kind}`,
    `${entries.length} fornecedor(es) processado(s)`,
  );

  const totals = {
    ok: entries.filter((e) => e.status === "success").length,
    failed: entries.filter((e) => e.status === "failed" || !!e.errorMessage).length,
    cancelled: entries.filter((e) => e.status === "cancelled").length,
    pending: entries.filter((e) => e.status === "pending" || e.status === "queued").length,
    lowConf: entries.filter(
      (e) => e.aiConfidence !== null && e.aiConfidence < confidenceThreshold,
    ).length,
    files: entries.reduce((s, e) => s + e.fileCount, 0),
    lines: entries.reduce((s, e) => s + e.lineCount, 0),
  };
  // Total geral agrupado por moeda (evita somar valores em moedas diferentes).
  const perCurrency = new Map<string, number>();
  for (const e of entries) {
    const cur = e.currency || "BRL";
    perCurrency.set(cur, (perCurrency.get(cur) ?? 0) + (e.estimatedTotal || 0));
  }
  const totalsText = Array.from(perCurrency.entries())
    .map(([cur, v]) => formatCurrency(v, cur))
    .join(" · ") || "—";

  let cursorY = 24;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const meta: Array<[string, string]> = [
    ["Concluídas", `${totals.ok} / ${entries.length}`],
    ["Falhas", String(totals.failed)],
    ["Canceladas", String(totals.cancelled)],
    ["Pendentes", String(totals.pending)],
    ["Baixa confiança", `${totals.lowConf} (< ${Math.round(confidenceThreshold * 100)}%)`],
    ["Arquivos / linhas", `${totals.files} / ${totals.lines}`],
    ["Total estimado", totalsText],
  ];
  for (const [k, v] of meta) {
    doc.text(`${k}: ${v}`, 10, cursorY);
    cursorY += 4;
  }
  cursorY += 2;
  doc.setTextColor(0, 0, 0);

  // Tabela principal por fornecedor.
  autoTable(doc, {
    startY: cursorY,
    head: [["#", "Fornecedor", "Status", "Arq.", "Linhas", "Total", "Confiança"]],
    body: entries.map((e, i) => {
      const conf =
        e.aiConfidence === null ? "—" : `${Math.round(e.aiConfidence * 100)}%`;
      const low =
        e.aiConfidence !== null && e.aiConfidence < confidenceThreshold ? " ⚠" : "";
      const total = e.estimatedTotal > 0 ? formatCurrency(e.estimatedTotal, e.currency) : "—";
      return [
        String(i + 1),
        e.supplierLabel + (e.currencies.length > 1 ? ` (moedas: ${e.currencies.join(", ")})` : ""),
        STATUS_LABEL[e.status],
        String(e.fileCount),
        String(e.lineCount),
        total,
        conf + low,
      ];
    }),
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: "right" },
      2: { cellWidth: 22 },
      3: { cellWidth: 12, halign: "right" },
      4: { cellWidth: 14, halign: "right" },
      5: { cellWidth: 28, halign: "right" },
      6: { cellWidth: 22, halign: "right" },
    },
    margin: { left: 8, right: 8 },
  });

  // Bloco de alertas / erros / arquivos por fornecedor (só para os que têm algo relevante).
  const relevant = entries.filter(
    (e) => e.aiWarnings.length > 0 || e.errorMessage || e.fileNames.length > 0,
  );
  if (relevant.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : cursorY + 8;
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Alertas e detalhes por fornecedor", 10, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const e of relevant) {
      if (y > pageH - 20) { doc.addPage(); y = 15; }
      doc.setFont("helvetica", "bold");
      doc.text(e.supplierLabel, 10, y);
      doc.setFont("helvetica", "normal");
      y += 4;
      if (e.errorMessage) {
        doc.setTextColor(180, 30, 30);
        for (const line of doc.splitTextToSize(`Erro: ${e.errorMessage}`, 190)) {
          if (y > pageH - 15) { doc.addPage(); y = 15; }
          doc.text(line, 12, y); y += 3.5;
        }
        doc.setTextColor(0, 0, 0);
      }
      for (const w of e.aiWarnings) {
        doc.setTextColor(150, 100, 0);
        for (const line of doc.splitTextToSize(`⚠ ${w}`, 190)) {
          if (y > pageH - 15) { doc.addPage(); y = 15; }
          doc.text(line, 12, y); y += 3.5;
        }
        doc.setTextColor(0, 0, 0);
      }
      if (e.fileNames.length > 0) {
        doc.setTextColor(100, 100, 100);
        for (const line of doc.splitTextToSize(`Arquivos: ${e.fileNames.join(", ")}`, 190)) {
          if (y > pageH - 15) { doc.addPage(); y = 15; }
          doc.text(line, 12, y); y += 3.5;
        }
        doc.setTextColor(0, 0, 0);
      }
      y += 2;
    }
  }

  drawFooter(doc, await currentUserEmail());
  doc.save(`${safeFileName(opts.fileName || "resumo_fila_ia")}_${Date.now()}.pdf`);
}
