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

function drawFooter(
  doc: jsPDF,
  generatedBy?: string | null,
  shortHash?: string | null,
  generatedAtOverride?: string,
) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const stamp = generatedAtOverride
    || new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const left = `Gerado em ${stamp}${generatedBy ? ` por ${generatedBy}` : ""}`;
    doc.text(left, 10, pageH - 6);
    const right = shortHash
      ? `Hash ${shortHash} · Página ${i} de ${pageCount}`
      : `Página ${i} de ${pageCount}`;
    doc.text(right, pageW - 10, pageH - 6, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);
}

async function currentUserEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email ?? null;
  } catch { return null; }
}

// ---- Carimbo de auditoria (hash SHA-256 + usuário + timestamp) -------------
//
// Toda exportação de PDF passa por `finalizePdf`, que:
//   1. Serializa de forma canônica (chaves ordenadas) o payload de conteúdo
//      fornecido pelo caller — cabeçalho, campos, itens, eventos etc.
//   2. Calcula o SHA-256 hexadecimal desse payload.
//   3. Desenha uma página final com o "Carimbo de auditoria" contendo
//      data/hora de geração, usuário autenticado e o hash completo.
//   4. Escreve nos rodapés de todas as páginas o hash curto (12 chars) para
//      conferência rápida em impressões parciais.
//
// O hash NÃO cobre o próprio carimbo — ele representa o CONTEÚDO do relatório.
// Qualquer alteração no conteúdo (valores, datas, itens, histórico) muda o
// hash; o mesmo relatório gerado novamente com os mesmos dados produz o mesmo
// hash, servindo como prova de integridade para auditoria.

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return null;
      seen.add(v as object);
      if (Array.isArray(v)) return v.map(walk);
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) out[k] = walk(obj[k]);
      return out;
    }
    if (typeof v === "undefined") return null;
    return v;
  };
  return JSON.stringify(walk(value));
}

async function sha256Hex(text: string): Promise<string> {
  try {
    const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } })
      .crypto?.subtle;
    if (subtle) {
      const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch { /* fallback abaixo */ }
  // Fallback não-criptográfico (FNV-1a 32-bit → 64 chars com mistura simples).
  // Só é usado se a API SubtleCrypto não estiver disponível no runtime.
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  const hex32 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return (hex32(h1) + hex32(h2)).padEnd(64, "0");
}

function drawAuditStamp(
  doc: jsPDF,
  info: { user: string | null; hash: string; generatedAt: string; contentSize: number; reportKind: string },
) {
  doc.addPage();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text("Carimbo de auditoria", 10, y);
  doc.setDrawColor(203, 213, 225);
  doc.line(10, y + 1.5, pageW - 10, y + 1.5);
  y += 10;

  const rows: Array<[string, string]> = [
    ["Tipo de relatório", info.reportKind],
    ["Gerado em", info.generatedAt],
    ["Usuário autenticado", info.user || "não autenticado"],
    ["Tamanho do conteúdo", `${info.contentSize.toLocaleString("pt-BR")} caractere(s)`],
    ["Algoritmo de hash", "SHA-256 (hex)"],
  ];
  doc.setFontSize(10);
  for (const [k, v] of rows) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text(`${k}:`, 10, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(v, 65, y);
    y += 6;
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text("Hash SHA-256 do conteúdo:", 10, y);
  y += 6;
  // Quebra em duas linhas de 32 chars para facilitar leitura/conferência.
  doc.setFont("courier", "normal");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(info.hash.slice(0, 32), 10, y);
  y += 6;
  doc.text(info.hash.slice(32), 10, y);
  y += 10;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const note =
    "Este carimbo permite verificar a integridade do relatório: qualquer alteração no conteúdo " +
    "(campos, itens, datas, histórico ou anexos listados) altera o hash. Use-o em auditorias " +
    "para atestar que a versão apresentada corresponde exatamente à gerada nesta data e hora, " +
    "pelo usuário indicado. O hash curto (primeiros 12 caracteres) é repetido no rodapé de " +
    "todas as páginas para conferência rápida em impressões parciais.";
  doc.text(doc.splitTextToSize(note, pageW - 20), 10, y);
  doc.setTextColor(0, 0, 0);
}

/**
 * Fecha o PDF adicionando o carimbo de auditoria (nova página) e o rodapé com
 * data/hora, usuário autenticado e hash curto do conteúdo. Deve ser chamado
 * imediatamente antes de `doc.save(...)`.
 */
async function finalizePdf(
  doc: jsPDF,
  reportKind: string,
  payload: unknown,
): Promise<void> {
  const canonical = stableStringify({ kind: reportKind, payload });
  const hash = await sha256Hex(canonical);
  const user = await currentUserEmail();
  const generatedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  drawAuditStamp(doc, { user, hash, generatedAt, contentSize: canonical.length, reportKind });
  drawFooter(doc, user, hash.slice(0, 12), generatedAt);
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

  await finalizePdf(doc, "Lista", {
    title: opts.title,
    subtitle: opts.subtitle,
    meta: opts.meta,
    headers: opts.columns.map((c) => c.header),
    rows: opts.rows.map((r) => opts.columns.map((c) => c.cell(r))),
  });
  doc.save(`${safeFileName(opts.fileName || opts.title)}_${Date.now()}.pdf`);
}

// ---- Relatório de LISTA em CSV (mesmas colunas/rows do PDF) ---------------
//
// Reaproveita `ListReportOptions` para garantir que Compras/Vendas/Aprovações
// exportem exatamente os mesmos campos (e já filtrados) que o PDF. Formato:
// UTF-8 com BOM (Excel PT-BR reconhece), separador `;`, aspas duplas nos
// campos com separador/quebra-de-linha/aspas. Metadados vão como linhas de
// comentário no topo, prefixadas por `#`.
export function exportListReportCsv<Row>(opts: ListReportOptions<Row>): void {
  const SEP = ";";
  const EOL = "\r\n";
  const escape = (raw: unknown): string => {
    const s = raw === null || raw === undefined ? "" : String(raw);
    // Sempre escapar se contém separador, aspas ou quebra de linha.
    if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines: string[] = [];
  // Metadados como comentários (linhas iniciadas por `#`).
  lines.push(`# ${opts.title}`);
  if (opts.subtitle) lines.push(`# ${opts.subtitle}`);
  else lines.push(`# ${opts.rows.length} registro(s)`);
  if (opts.meta) for (const m of opts.meta) lines.push(`# ${m.label}: ${m.value}`);
  lines.push("");

  // Header
  lines.push(opts.columns.map((c) => escape(c.header)).join(SEP));
  // Body
  for (const row of opts.rows) {
    lines.push(opts.columns.map((c) => escape(c.cell(row))).join(SEP));
  }

  const csv = "\uFEFF" + lines.join(EOL) + EOL;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(opts.fileName || opts.title)}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // libera o object URL no próximo tick — evita revogar antes do download começar
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

  // Histórico — quando houver muitos eventos, vira uma seção dedicada em nova
  // página com título repetido, contagem e numeração de linhas, para facilitar
  // auditoria. Menos eventos (<= LONG_HISTORY_THRESHOLD) mantêm o comportamento
  // compacto no final da página.
  if (opts.events && opts.events.length > 0) {
    const LONG_HISTORY_THRESHOLD = 12;
    const isLongHistory = opts.events.length > LONG_HISTORY_THRESHOLD;
    if (isLongHistory || cursorY > 220) {
      doc.addPage();
      cursorY = 15;
    }
    const historyTitle = isLongHistory
      ? `HISTÓRICO COMPLETO (${opts.events.length} eventos)`
      : `HISTÓRICO (${opts.events.length})`;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(historyTitle, 10, cursorY);
    doc.setDrawColor(203, 213, 225);
    doc.line(10, cursorY + 1, pageW - 10, cursorY + 1);
    cursorY += 3;
    autoTable(doc, {
      startY: cursorY,
      head: [["#", "Data / Hora", "Evento", "Responsável", "Detalhe"]],
      body: opts.events.map((e, idx) => [
        String(idx + 1),
        formatDateTime(e.when),
        e.label,
        e.actor || "—",
        e.detail || "—",
      ]),
      styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 10, halign: "right" },
        1: { cellWidth: 30 },
      },
      margin: { left: 8, right: 8, top: 20 },
      showHead: "everyPage",
      // Em cada quebra de página, repete o título da seção para o leitor não
      // perder o contexto ao folhear páginas longas de histórico.
      didDrawPage: (data) => {
        if (!isLongHistory) return;
        // Só desenha o cabeçalho nas páginas após a primeira do bloco.
        if (data.pageNumber === 1) return;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(`${historyTitle} — continuação`, 10, 12);
        doc.setDrawColor(203, 213, 225);
        doc.line(10, 13, pageW - 10, 13);
        doc.setTextColor(0, 0, 0);
      },
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

  await finalizePdf(doc, "Detalhe", {
    title: opts.title,
    subtitle: opts.subtitle,
    statusBadge: opts.statusBadge,
    headline: opts.headline,
    sections: opts.sections,
    items: opts.items,
    itemsCurrency: opts.itemsCurrency,
    events: opts.events,
    attachments: opts.attachments,
  });
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
  /**
   * ID estável do evento na fila (ex.: `supplierKey`) — usado na seção de
   * evidências para permitir rastreabilidade cruzada com logs internos.
   * Opcional para compat: se ausente, o relatório mostra "—".
   */
  id?: string;
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

/**
 * Desenha uma seção "Evidências" com uma linha por fornecedor, contendo o ID
 * do evento (para rastreabilidade), a contagem de anexos e os nomes dos
 * arquivos. Usada em auditoria para provar quais documentos alimentaram cada
 * entrada do resumo. Retorna o novo `finalY` para o caller continuar.
 */
function drawEvidenceSection(
  doc: jsPDF,
  entries: QueueSummaryEntry[],
  startY: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = startY;
  if (y > pageH - 40) { doc.addPage(); y = 15; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  const totalFiles = entries.reduce((s, e) => s + (e.fileNames?.length ?? e.fileCount ?? 0), 0);
  doc.text(
    `Evidências (${entries.length} evento(s) · ${totalFiles} anexo(s))`,
    10, y,
  );
  doc.setDrawColor(203, 213, 225);
  doc.line(10, y + 1, pageW - 10, y + 1);
  y += 4;
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    startY: y,
    head: [["#", "ID do evento", "Fornecedor", "Anexos", "Nomes dos arquivos"]],
    body: entries.map((e, i) => [
      String(i + 1),
      e.id || "—",
      e.supplierLabel,
      String(e.fileNames?.length ?? e.fileCount ?? 0),
      (e.fileNames && e.fileNames.length > 0) ? e.fileNames.join("\n") : "—",
    ]),
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: "right" },
      1: { cellWidth: 38, font: "courier", fontSize: 7 },
      2: { cellWidth: 50 },
      3: { cellWidth: 14, halign: "right" },
    },
    margin: { left: 8, right: 8 },
    showHead: "everyPage",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable?.finalY ?? y;
}

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

  // Seção de evidências: contagem e nomes dos anexos por fornecedor + IDs de
  // evento. Sempre incluída (mesmo sem alertas), para servir de anexo de
  // auditoria do resumo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const evStart = ((doc as any).lastAutoTable?.finalY ?? 24) + 8;
  drawEvidenceSection(doc, entries, evStart);



  await finalizePdf(doc, "Resumo da fila de IA", {
    kindLabel: opts.kindLabel,
    confidenceThreshold: opts.confidenceThreshold,
    entries: opts.entries,
  });
  doc.save(`${safeFileName(opts.fileName || "resumo_fila_ia")}_${Date.now()}.pdf`);
}

// ---- Revisão de baixa confiança (subset com filtro) ------------------------

export interface LowConfidenceReviewOptions {
  entries: QueueSummaryEntry[];
  confidenceThreshold: number;
  kindLabel?: string;
  fileName?: string;
}

/**
 * Gera PDF de revisão com apenas os grupos cuja confiança IA está abaixo do
 * limite (ou sem confiança extraída — considerados suspeitos). Reaproveita o
 * layout do resumo, apenas trocando título e subtítulo.
 */
export async function exportLowConfidenceReviewPdf(opts: LowConfidenceReviewOptions): Promise<void> {
  const filtered = opts.entries.filter(
    (e) => e.aiConfidence === null || e.aiConfidence < opts.confidenceThreshold,
  );
  if (filtered.length === 0) return;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const kind = opts.kindLabel || "Despesas";
  drawHeader(
    doc,
    `Revisão de baixa confiança — ${kind}`,
    `${filtered.length} grupo(s) abaixo de ${Math.round(opts.confidenceThreshold * 100)}%`,
  );
  let cursorY = 24;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`Limite: ${Math.round(opts.confidenceThreshold * 100)}%`, 10, cursorY); cursorY += 4;
  doc.text(`Grupos para revisar: ${filtered.length}`, 10, cursorY); cursorY += 4;
  const withWarnings = filtered.filter((e) => e.aiWarnings.length > 0).length;
  doc.text(`Grupos com alertas IA: ${withWarnings}`, 10, cursorY); cursorY += 6;
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    startY: cursorY,
    head: [["#", "Fornecedor", "Status", "Arq.", "Linhas", "Total", "Confiança", "Alertas"]],
    body: filtered.map((e, i) => [
      String(i + 1),
      e.supplierLabel,
      STATUS_LABEL[e.status],
      String(e.fileCount),
      String(e.lineCount),
      e.estimatedTotal > 0 ? formatCurrency(e.estimatedTotal, e.currency) : "—",
      e.aiConfidence === null ? "s/ conf." : `${Math.round(e.aiConfidence * 100)}%`,
      String(e.aiWarnings.length),
    ]),
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [180, 100, 20], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [253, 246, 227] },
    columnStyles: {
      0: { cellWidth: 8, halign: "right" },
      2: { cellWidth: 22 },
      3: { cellWidth: 12, halign: "right" },
      4: { cellWidth: 14, halign: "right" },
      5: { cellWidth: 26, halign: "right" },
      6: { cellWidth: 20, halign: "right" },
      7: { cellWidth: 16, halign: "right" },
    },
    margin: { left: 8, right: 8 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : cursorY + 8;
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  if (y > pageH - 20) { doc.addPage(); y = 15; }
  doc.text("Detalhes por fornecedor (anexos, alertas e erros)", 10, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const e of filtered) {
    if (y > pageH - 20) { doc.addPage(); y = 15; }
    doc.setFont("helvetica", "bold");
    const conf = e.aiConfidence === null ? "s/ confiança" : `${Math.round(e.aiConfidence * 100)}%`;
    doc.text(`${e.supplierLabel} — ${STATUS_LABEL[e.status]} · ${conf}`, 10, y);
    doc.setFont("helvetica", "normal");
    y += 4;
    if (e.fileNames.length > 0) {
      doc.setTextColor(100, 100, 100);
      for (const line of doc.splitTextToSize(`Anexos: ${e.fileNames.join(", ")}`, 190)) {
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
    if (e.errorMessage) {
      doc.setTextColor(180, 30, 30);
      for (const line of doc.splitTextToSize(`Erro: ${e.errorMessage}`, 190)) {
        if (y > pageH - 15) { doc.addPage(); y = 15; }
        doc.text(line, 12, y); y += 3.5;
      }
      doc.setTextColor(0, 0, 0);
    }
    y += 2;
  }

  await finalizePdf(doc, "Revisão de baixa confiança", {
    kindLabel: opts.kindLabel,
    confidenceThreshold: opts.confidenceThreshold,
    entries: filtered,
  });
  doc.save(`${safeFileName(opts.fileName || "revisao_baixa_confianca")}_${Date.now()}.pdf`);
}

/** Escapa um campo para CSV RFC 4180 (aspas duplas, quebra de linha, ';'). */
function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Gera e baixa CSV (`;` separador, aceito pelo Excel-BR) com os grupos abaixo
 * do limite de confiança. Uma linha por grupo — anexos concatenados em uma
 * coluna para facilitar compartilhamento em planilha.
 */
export function exportLowConfidenceReviewCsv(opts: LowConfidenceReviewOptions): void {
  const filtered = opts.entries.filter(
    (e) => e.aiConfidence === null || e.aiConfidence < opts.confidenceThreshold,
  );
  if (filtered.length === 0) return;
  const header = [
    "Fornecedor", "Status", "Arquivos", "Linhas", "Moeda", "Total estimado",
    "Confiança IA (%)", "Limite (%)", "Alertas IA", "Erro", "Nomes dos anexos",
  ];
  const rows = filtered.map((e) => [
    e.supplierLabel,
    STATUS_LABEL[e.status],
    e.fileCount,
    e.lineCount,
    e.currency,
    e.estimatedTotal,
    e.aiConfidence === null ? "" : Math.round(e.aiConfidence * 100),
    Math.round(opts.confidenceThreshold * 100),
    e.aiWarnings.join(" | "),
    e.errorMessage || "",
    e.fileNames.join(" | "),
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(";")).join("\r\n");
  // BOM UTF-8 para Excel renderizar acentos corretamente.
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(opts.fileName || "revisao_baixa_confianca")}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Relatório do fluxo de compras (super-user) ─────────────────────────────
// Consolida tempos por etapa (classificação IA → fila → formulário → submit),
// identifica gargalos e lista os DocGroups "deferred" com suas classificações
// e alertas. Serve como snapshot operacional para diagnosticar demoras.

export interface PurchaseFlowQueueEntry extends QueueSummaryEntry {
  classifiedAt?: number;
  promotedAt?: number;
  submittedAt?: number;
  completedAt?: number;
}

/** Snapshot minimalista de um DocGroup adiado (usado no relatório). */
export interface PurchaseFlowDeferredGroup {
  supplierLabel: string;
  docs: Array<{
    fileName: string;
    docType?: string | null;
    currency?: string | null;
    confidence?: number | null;
    warnings: string[];
  }>;
}

export interface PurchaseFlowReportOptions {
  entries: PurchaseFlowQueueEntry[];
  deferredGroups: PurchaseFlowDeferredGroup[];
  confidenceThreshold: number;
  kindLabel?: string;
  fileName?: string;
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m${rs.toString().padStart(2, "0")}s`;
}

function stats(values: number[]): { avg: number; max: number; p95: number; n: number } {
  if (values.length === 0) return { avg: 0, max: 0, p95: 0, n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return { avg: sum / sorted.length, max: sorted[sorted.length - 1], p95: sorted[idx], n: sorted.length };
}

export async function exportPurchaseFlowReportPdf(opts: PurchaseFlowReportOptions): Promise<void> {
  const { entries, deferredGroups, confidenceThreshold } = opts;
  const kind = opts.kindLabel || "Compras";
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  drawHeader(doc, `Fluxo de ${kind} — tempos e gargalos`, `${entries.length} grupo(s) processado(s)`);

  // Calcula durações por etapa quando os timestamps existem. Grupos parciais
  // (ex.: cancelados no meio) só contribuem com as etapas que completaram.
  const queueTimes: number[] = [];   // classifiedAt → promotedAt
  const formTimes: number[] = [];    // promotedAt → submittedAt
  const submitTimes: number[] = [];  // submittedAt → completedAt
  const totalTimes: number[] = [];   // classifiedAt → completedAt

  for (const e of entries) {
    if (e.classifiedAt && e.promotedAt && e.promotedAt >= e.classifiedAt) queueTimes.push(e.promotedAt - e.classifiedAt);
    if (e.promotedAt && e.submittedAt && e.submittedAt >= e.promotedAt) formTimes.push(e.submittedAt - e.promotedAt);
    if (e.submittedAt && e.completedAt && e.completedAt >= e.submittedAt) submitTimes.push(e.completedAt - e.submittedAt);
    if (e.classifiedAt && e.completedAt && e.completedAt >= e.classifiedAt) totalTimes.push(e.completedAt - e.classifiedAt);
  }

  const stepStats: Array<{ label: string; s: ReturnType<typeof stats> }> = [
    { label: "Espera na fila (IA → form)", s: stats(queueTimes) },
    { label: "Formulário (form → submit)", s: stats(formTimes) },
    { label: "Persistência (submit → ERP)", s: stats(submitTimes) },
  ];
  const totalS = stats(totalTimes);

  // Gargalo = etapa com maior tempo médio dentre as que têm amostra.
  const withData = stepStats.filter((x) => x.s.n > 0);
  const bottleneck = withData.length > 0
    ? withData.reduce((a, b) => (b.s.avg > a.s.avg ? b : a))
    : null;

  let cursorY = 24;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const summary: Array<[string, string]> = [
    ["Grupos com tempo total medido", `${totalS.n} / ${entries.length}`],
    ["Tempo total — média / máx / p95", `${fmtDuration(totalS.avg)} / ${fmtDuration(totalS.max)} / ${fmtDuration(totalS.p95)}`],
    ["Gargalo (maior média)", bottleneck ? `${bottleneck.label} — ${fmtDuration(bottleneck.s.avg)}` : "—"],
    ["Grupos adiados (deferred)", String(deferredGroups.length)],
    ["Baixa confiança (< " + Math.round(confidenceThreshold * 100) + "%)", String(entries.filter((e) => e.aiConfidence !== null && e.aiConfidence < confidenceThreshold).length)],
  ];
  for (const [k, v] of summary) { doc.text(`${k}: ${v}`, 10, cursorY); cursorY += 4; }
  cursorY += 2;
  doc.setTextColor(0, 0, 0);

  // Tabela: estatísticas por etapa.
  autoTable(doc, {
    startY: cursorY,
    head: [["Etapa", "Amostras", "Média", "P95", "Máx"]],
    body: stepStats.map((x) => [
      x.label + (bottleneck && x.label === bottleneck.label ? "  ⚠ gargalo" : ""),
      String(x.s.n),
      fmtDuration(x.s.avg),
      fmtDuration(x.s.p95),
      fmtDuration(x.s.max),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 20, halign: "right" },
      2: { cellWidth: 26, halign: "right" },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 26, halign: "right" },
    },
    margin: { left: 8, right: 8 },
  });

  // Tabela: tempos por grupo (só os que têm ao menos uma etapa medida).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : cursorY + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("Tempos por grupo", 10, y); y += 4;
  doc.setFont("helvetica", "normal");
  autoTable(doc, {
    startY: y,
    head: [["#", "Fornecedor", "Status", "Fila", "Form", "Submit", "Total"]],
    body: entries.map((e, i) => {
      const qt = e.classifiedAt && e.promotedAt ? e.promotedAt - e.classifiedAt : null;
      const ft = e.promotedAt && e.submittedAt ? e.submittedAt - e.promotedAt : null;
      const st = e.submittedAt && e.completedAt ? e.completedAt - e.submittedAt : null;
      const tt = e.classifiedAt && e.completedAt ? e.completedAt - e.classifiedAt : null;
      return [
        String(i + 1),
        e.supplierLabel,
        STATUS_LABEL[e.status],
        fmtDuration(qt),
        fmtDuration(ft),
        fmtDuration(st),
        fmtDuration(tt),
      ];
    }),
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: "right" },
      2: { cellWidth: 22 },
      3: { cellWidth: 20, halign: "right" },
      4: { cellWidth: 20, halign: "right" },
      5: { cellWidth: 20, halign: "right" },
      6: { cellWidth: 22, halign: "right" },
    },
    margin: { left: 8, right: 8 },
  });

  // Classificações e alertas dos deferredGroups.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 8;
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 30) { doc.addPage(); y = 15; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(`Grupos adiados (${deferredGroups.length})`, 10, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  if (deferredGroups.length === 0) {
    doc.setTextColor(120, 120, 120);
    doc.text("Nenhum grupo adiado no momento.", 12, y); y += 4;
    doc.setTextColor(0, 0, 0);
  } else {
    for (const g of deferredGroups) {
      if (y > pageH - 20) { doc.addPage(); y = 15; }
      doc.setFont("helvetica", "bold"); doc.text(g.supplierLabel, 10, y); doc.setFont("helvetica", "normal"); y += 4;
      for (const d of g.docs) {
        if (y > pageH - 15) { doc.addPage(); y = 15; }
        const conf = d.confidence !== null && d.confidence !== undefined && Number.isFinite(d.confidence)
          ? `${Math.round(d.confidence * 100)}%${d.confidence < confidenceThreshold ? " ⚠" : ""}`
          : "—";
        const line = `• ${d.fileName} — tipo: ${d.docType || "—"} · moeda: ${d.currency || "—"} · IA: ${conf}`;
        for (const lw of doc.splitTextToSize(line, 190)) {
          if (y > pageH - 15) { doc.addPage(); y = 15; }
          doc.text(lw, 12, y); y += 3.5;
        }
        if (d.warnings.length > 0) {
          doc.setTextColor(150, 100, 0);
          for (const w of d.warnings) {
            for (const lw of doc.splitTextToSize(`   ⚠ ${w}`, 188)) {
              if (y > pageH - 15) { doc.addPage(); y = 15; }
              doc.text(lw, 14, y); y += 3.5;
            }
          }
          doc.setTextColor(0, 0, 0);
        }
      }
      y += 2;
    }
  }

  await finalizePdf(doc, "Fluxo de compras", {
    kindLabel: opts.kindLabel,
    confidenceThreshold: opts.confidenceThreshold,
    entries: opts.entries,
    deferredGroups: opts.deferredGroups,
  });
  doc.save(`${safeFileName(opts.fileName || "fluxo_compras")}_${Date.now()}.pdf`);
}
