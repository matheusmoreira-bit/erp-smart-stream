// Edge function: post an internal approved expense as a Purchase Order in SAP B1
// Endpoint: POST /functions/v1/expense-to-sap
// Body: { expense_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { requireUserOrSapSession } from "../_shared/auth.ts";
import { tryAcquireIntegrationLock, releaseIntegrationLock } from "../_shared/sap-fetch.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Status values used to track each integration stage on the expense row.
// Possible values:
//   "not_applicable" — stage skipped (e.g. no attachments, or feature disabled)
//   "pending"        — not yet attempted in this run
//   "success"        — stage completed without error
//   "failed"         — stage failed (see sap_integration_error)
type StageStatus = "not_applicable" | "pending" | "success" | "failed";

function buildSapCookies(sessionId: string, routeId?: string) {
  return `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
}

function truncateSapText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Fire-and-forget notification about ERP integration attempts.
// Sends to matheus.moreira@anagaming.com.br via the shared SMTP function.
async function notifyErpIntegration(params: {
  status: "success" | "error";
  source: "expense" | "pagcorp";
  entityId: string | number;
  companyDb?: string | null;
  docEntry?: number | null;
  docNum?: number | null;
  errorMessage?: string | null;
  requester?: string | null;
  supplier?: string | null;
  amount?: number | null;
  currency?: string | null;
}): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const ok = params.status === "success";
    const subject = ok
      ? `[ERP] Integração ${params.source} OK — ${params.companyDb || ""} · Doc ${params.docNum ?? params.docEntry ?? ""}`
      : `[ERP] Falha integração ${params.source} — ${params.companyDb || ""} · #${params.entityId}`;
    const rows: [string, string][] = [
      ["Origem", params.source],
      ["Empresa (DB)", params.companyDb || "-"],
      ["ID interno", String(params.entityId)],
      ["Solicitante", params.requester || "-"],
      ["Fornecedor", params.supplier || "-"],
      ["Valor", params.amount != null ? `${params.currency || "BRL"} ${Number(params.amount).toFixed(2)}` : "-"],
      ["SAP DocEntry", params.docEntry != null ? String(params.docEntry) : "-"],
      ["SAP DocNum", params.docNum != null ? String(params.docNum) : "-"],
      ["Status", ok ? "SUCESSO" : "ERRO"],
      ["Erro", params.errorMessage || "-"],
    ];
    const html = `<h2>${ok ? "Integração ao ERP concluída" : "Falha na integração ao ERP"}</h2>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
${rows.map(([k, v]) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;background:#f8f8f8"><b>${k}</b></td><td style="padding:4px 8px;border:1px solid #ddd">${String(v).replace(/</g, "&lt;")}</td></tr>`).join("")}
</table>`;
    // fire-and-forget
    fetch(`${supabaseUrl}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({
        to: "matheus.moreira@anagaming.com.br",
        subject,
        html,
        text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
      }),
    }).catch((e) => console.warn("notifyErpIntegration send failed:", e));
  } catch (e) {
    console.warn("notifyErpIntegration error:", e);
  }
}

// Fire-and-forget contingência: avisa via WhatsApp quando um pedido é
// integrado no SAP sem nenhum anexo, para lançamento manual do arquivo.
const CONTINGENCY_WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const CONTINGENCY_WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";
const CONTINGENCY_WHATSAPP_TO = "5531972665309";

async function notifyMissingAttachmentWhatsApp(params: {
  companyDb?: string | null;
  entityId: string | number;
  docEntry?: number | null;
  docNum?: number | null;
  requester?: string | null;
  supplier?: string | null;
  amount?: number | null;
  currency?: string | null;
  reason: "no_attachment_uploaded" | "integration_attachments_disabled";
  attachments?: Array<{ file_name: string; url: string }>;
}): Promise<void> {
  try {
    const cur = (params.currency || "BRL").trim();
    let amountStr = "-";
    if (params.amount != null) {
      try {
        amountStr = new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur })
          .format(Number(params.amount));
      } catch {
        amountStr = `${cur} ${Number(params.amount).toFixed(2)}`;
      }
    }
    const reasonLabel = params.reason === "integration_attachments_disabled"
      ? "Integração de anexos desligada para a empresa"
      : "Pedido aprovado sem nenhum anexo vinculado no SAP";
    const lines = [
      "🚨 *Contingência — Anexo pendente no SAP*",
      "",
      `*Empresa:* ${params.companyDb || "-"}`,
      `*SAP DocNum:* ${params.docNum ?? "-"}`,
      `*SAP DocEntry:* ${params.docEntry ?? "-"}`,
      `*Solicitante:* ${params.requester || "-"}`,
      `*Fornecedor:* ${params.supplier || "-"}`,
      `*Valor:* ${amountStr}`,
      `*ID interno:* ${params.entityId}`,
      `*Motivo:* ${reasonLabel}`,
    ];
    const atts = params.attachments || [];
    if (atts.length > 0) {
      lines.push("");
      lines.push(`*Anexo(s) para lançamento manual (${atts.length}):*`);
      for (const a of atts) {
        lines.push(`• ${a.file_name}`);
        lines.push(a.url);
      }
      lines.push("");
      lines.push("_Links válidos por 7 dias._ Favor lançar o anexo manualmente no pedido do SAP.");
    } else {
      lines.push("");
      lines.push("Nenhum anexo foi enviado no ERP Flow — o lançamento seguiu sem arquivo.");
    }
    const body = new URLSearchParams({
      to: CONTINGENCY_WHATSAPP_TO,
      message: lines.join("\n"),
    });
    fetch(CONTINGENCY_WHATSAPP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONTINGENCY_WHATSAPP_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }).catch((e) => console.warn("notifyMissingAttachmentWhatsApp send failed:", e));
  } catch (e) {
    console.warn("notifyMissingAttachmentWhatsApp error:", e);
  }
}

// Fire-and-forget: envia email da contingência (sem anexo) para o time
// fiscal e responsáveis (Leonardo). Inclui os links assinados dos anexos
// internos, quando existirem, para lançamento manual no ERP.
const MISSING_ATTACHMENT_EMAIL_TO = [
  "fiscal@anagaming.com.br",
  "leonardo.oliveira@anagaming.com.br",
];

async function notifyMissingAttachmentEmail(params: {
  supabase: ReturnType<typeof createClient>;
  companyDb?: string | null;
  entityId: string | number;
  docEntry?: number | null;
  docNum?: number | null;
  requester?: string | null;
  requesterEmail?: string | null;
  supplier?: string | null;
  amount?: number | null;
  currency?: string | null;
  reason: "no_attachment_uploaded" | "integration_attachments_disabled";
  attachments?: Array<{ file_name: string; url: string }>;
}): Promise<void> {
  try {
    const cur = (params.currency || "BRL").trim();
    let amountStr = "-";
    if (params.amount != null) {
      try {
        amountStr = new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur })
          .format(Number(params.amount));
      } catch {
        amountStr = `${cur} ${Number(params.amount).toFixed(2)}`;
      }
    }
    const reasonLabel = params.reason === "integration_attachments_disabled"
      ? "Integração de anexos desligada para a empresa"
      : "Pedido aprovado sem nenhum anexo vinculado no SAP";

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const atts = params.attachments || [];
    const attsHtml = atts.length > 0
      ? `<h4 style="margin:12px 0 6px">Anexos internos (${atts.length}) — links válidos por 7 dias</h4>
         <ul style="padding-left:18px;margin:0">${atts
           .map((a) => `<li><a href="${esc(a.url)}">${esc(a.file_name)}</a></li>`).join("")}</ul>`
      : `<p style="color:#a00;margin:8px 0">Nenhum anexo interno foi enviado no ERP Flow.</p>`;

    const subject = `[SEM ANEXO] Despesa integrada ao SAP — ${params.supplier || "-"} (DocNum ${params.docNum ?? "-"})`;

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p style="background:#fff3cd;border:1px solid #ffe69c;padding:10px 12px;border-radius:6px;margin:0 0 12px">
          <strong>⚠️ Contingência — Despesa integrada ao SAP sem anexo do documento original.</strong><br>
          ${esc(reasonLabel)}. Providencie o lançamento manual do anexo no pedido.
        </p>
        <table style="border-collapse:collapse">
          <tr><td style="padding:4px 10px;color:#666">Empresa</td><td style="padding:4px 10px">${esc(params.companyDb || "-")}</td></tr>
          <tr><td style="padding:4px 10px;color:#666">SAP DocNum</td><td style="padding:4px 10px">${params.docNum ?? "-"}</td></tr>
          <tr><td style="padding:4px 10px;color:#666">SAP DocEntry</td><td style="padding:4px 10px">${params.docEntry ?? "-"}</td></tr>
          <tr><td style="padding:4px 10px;color:#666">Fornecedor</td><td style="padding:4px 10px"><strong>${esc(params.supplier || "-")}</strong></td></tr>
          <tr><td style="padding:4px 10px;color:#666">Valor</td><td style="padding:4px 10px"><strong>${esc(amountStr)}</strong></td></tr>
          <tr><td style="padding:4px 10px;color:#666">Solicitante</td><td style="padding:4px 10px">${esc(params.requester || "-")}${params.requesterEmail ? ` &middot; ${esc(params.requesterEmail)}` : ""}</td></tr>
          <tr><td style="padding:4px 10px;color:#666">ID interno</td><td style="padding:4px 10px">${esc(String(params.entityId))}</td></tr>
        </table>
        ${attsHtml}
      </div>
    `;

    const textLines = [
      "Contingência — Despesa integrada ao SAP sem anexo do documento original.",
      reasonLabel,
      "",
      `Empresa: ${params.companyDb || "-"}`,
      `SAP DocNum: ${params.docNum ?? "-"} / DocEntry: ${params.docEntry ?? "-"}`,
      `Fornecedor: ${params.supplier || "-"}`,
      `Valor: ${amountStr}`,
      `Solicitante: ${params.requester || "-"}${params.requesterEmail ? ` (${params.requesterEmail})` : ""}`,
      `ID interno: ${params.entityId}`,
      "",
      atts.length > 0 ? `Anexos internos (links por 7 dias):` : "Nenhum anexo interno enviado no ERP Flow.",
      ...atts.map((a) => `- ${a.file_name}: ${a.url}`),
    ];

    const { error } = await params.supabase.functions.invoke("send-smtp-email", {
      body: {
        to: MISSING_ATTACHMENT_EMAIL_TO,
        replyTo: params.requesterEmail || undefined,
        subject,
        html,
        text: textLines.join("\n"),
      },
    });
    if (error) console.warn("notifyMissingAttachmentEmail send failed:", error);
  } catch (e) {
    console.warn("notifyMissingAttachmentEmail error:", e);
  }
}



// Gera URLs assinadas (7 dias) para os anexos internos da despesa, para
// que o admin possa baixar e lançar manualmente no SAP em caso de
// contingência.
async function getExpenseAttachmentLinks(
  supabase: ReturnType<typeof createClient>,
  expenseId: string,
): Promise<Array<{ file_name: string; url: string }>> {
  try {
    const { data: rows, error } = await supabase
      .from("expense_attachments")
      .select("file_name, file_path")
      .eq("expense_id", expenseId);
    if (error || !Array.isArray(rows) || rows.length === 0) return [];
    const bucket = "expense-attachments";
    const ttl = 60 * 60 * 24 * 7; // 7 dias
    const results: Array<{ file_name: string; url: string }> = [];
    for (const r of rows as Array<{ file_name: string; file_path: string }>) {
      if (!r?.file_path) continue;
      try {
        const { data, error: sErr } = await supabase
          .storage.from(bucket)
          .createSignedUrl(r.file_path, ttl);
        if (!sErr && data?.signedUrl) {
          results.push({ file_name: r.file_name || r.file_path.split("/").pop() || "anexo", url: data.signedUrl });
        }
      } catch (e) {
        console.warn("[contingency] signed URL failed for", r.file_path, e);
      }
    }
    return results;
  } catch (e) {
    console.warn("[contingency] getExpenseAttachmentLinks failed:", e);
    return [];
  }
}

async function getSapCredentials(
  supabase: ReturnType<typeof createClient>,
  companyDb?: string,
) {
  let query = supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap");
  if (companyDb) query = query.eq("company_db", companyDb);

  const { data, error } = await query;
  if (error) throw new Error(`Erro credenciais SAP: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais SAP não configuradas");

  const creds: Record<string, string> = {};
  for (const row of data) creds[row.credential_key] = row.credential_value;
  return creds;
}

function getSapBaseUrl(sapCreds: Record<string, string>) {
  let baseUrl = (sapCreds.service_layer_url || sapCreds.base_url || sapCreds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  return baseUrl;
}

async function postSapDocument(
  sapBaseUrl: string,
  cookies: string,
  payload: Record<string, unknown>,
  endpoint: string,
): Promise<{ docEntry: number; docNum: number; response: any }> {
  const res = await fetch(`${sapBaseUrl}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`SAP ${endpoint} failed [${res.status}]: ${msg}`);
  }
  return { docEntry: body.DocEntry, docNum: body.DocNum, response: body };
}

async function getSapDocumentAttachmentEntry(
  sapBaseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
): Promise<number | null> {
  const res = await fetch(`${sapBaseUrl}/${endpoint}(${docEntry})?$select=AttachmentEntry`, {
    method: "GET",
    headers: { Cookie: cookies },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`SAP ${endpoint} attachment check failed [${res.status}]: ${msg}`);
  }
  const value = Number(body?.AttachmentEntry);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function patchSapDocumentAttachmentEntry(
  sapBaseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
  attachmentEntry: number,
): Promise<void> {
  const res = await fetch(`${sapBaseUrl}/${endpoint}(${docEntry})`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({ AttachmentEntry: attachmentEntry }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`SAP ${endpoint} attachment link failed [${res.status}]: ${msg}`);
  }
}

async function ensureSapDocumentAttachmentLinked(
  sapBaseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
  attachmentEntry: number,
): Promise<void> {
  const current = await getSapDocumentAttachmentEntry(sapBaseUrl, cookies, endpoint, docEntry);
  if (current === attachmentEntry) return;

  await patchSapDocumentAttachmentEntry(sapBaseUrl, cookies, endpoint, docEntry, attachmentEntry);

  const updated = await getSapDocumentAttachmentEntry(sapBaseUrl, cookies, endpoint, docEntry);
  if (updated !== attachmentEntry) {
    throw new Error(`SAP não confirmou o vínculo do anexo ${attachmentEntry} no documento ${docEntry}`);
  }
}

// Upload attachments to SAP B1 Attachments2 endpoint. Returns AbsoluteEntry to link in document.
async function uploadAttachmentsToSap(
  sapBaseUrl: string,
  cookies: string,
  files: { name: string; blob: Blob }[],
): Promise<number | null> {
  if (files.length === 0) return null;
  const form = new FormData();
  for (const f of files) {
    // SAP B1 SL expects files appended as form parts; the field name is the filename
    form.append("files", f.blob, f.name);
  }
  const res = await fetch(`${sapBaseUrl}/Attachments2`, {
    method: "POST",
    headers: { Cookie: cookies },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`SAP Attachments2 failed [${res.status}]: ${msg}`);
  }
  return body.AbsoluteEntry ?? null;
}

// ─── Comprovante de aprovação (PDF) ──────────────────────────────────────────
// Gera um PDF simples com o resumo do pedido e o histórico de aprovações do
// ERP Flow. Enviado junto com os anexos do usuário para comprovar o fluxo
// interno de aprovação no documento do ERP.

function sanitizePdfText(input: unknown): string {
  const s = String(input ?? "");
  return s
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    // WinAnsi (Windows-1252) suporta 0x20-0xFF menos alguns; substituímos
    // qualquer coisa fora desse range por "?" para não quebrar o pdf-lib.
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

function formatPdfDate(iso: unknown): string {
  if (!iso) return "-";
  try {
    return new Date(String(iso)).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch { return "-"; }
}

function formatPdfDateTime(iso: unknown): string {
  if (!iso) return "-";
  try {
    return new Date(String(iso)).toLocaleString("pt-BR", {
      dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
    });
  } catch { return "-"; }
}

function formatPdfCurrency(value: unknown, currency: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const code = /^[A-Z]{3}$/.test(String(currency || "")) ? String(currency) : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(n);
  } catch {
    return `${code} ${n.toFixed(2)}`;
  }
}

async function buildApprovalReportPdf(
  supabase: ReturnType<typeof createClient>,
  expense: Record<string, any>,
  items: Array<Record<string, any>>,
): Promise<{ name: string; blob: Blob } | null> {
  try {
    // Histórico de aprovação — mesma fonte usada pelo componente/UI.
    const { data: logRows } = await supabase
      .from("expense_approval_log")
      .select("decision,approver_name,approver_email,level_order,remarks,decided_at")
      .eq("expense_id", expense.id)
      .order("decided_at", { ascending: true });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const A4 = { w: 595.28, h: 841.89 };
    const margin = 48;
    let page = pdf.addPage([A4.w, A4.h]);
    let y = A4.h - margin;
    const usableWidth = A4.w - margin * 2;

    const lineHeight = (size: number) => size + 4;

    const wrap = (text: string, size: number, f: typeof font): string[] => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let current = "";
      for (const w of words) {
        const candidate = current ? `${current} ${w}` : w;
        const width = f.widthOfTextAtSize(candidate, size);
        if (width > usableWidth && current) {
          lines.push(current);
          current = w;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : [""];
    };

    const draw = (
      text: string,
      opts: { size?: number; bold?: boolean; color?: [number, number, number]; extraGap?: number } = {},
    ) => {
      const size = opts.size ?? 10;
      const f = opts.bold ? bold : font;
      const color = opts.color ?? [0, 0, 0];
      const clean = sanitizePdfText(text);
      const lines = wrap(clean, size, f);
      for (const line of lines) {
        if (y < margin + size) {
          page = pdf.addPage([A4.w, A4.h]);
          y = A4.h - margin;
        }
        page.drawText(line, {
          x: margin,
          y,
          size,
          font: f,
          color: rgb(color[0], color[1], color[2]),
        });
        y -= lineHeight(size);
      }
      if (opts.extraGap) y -= opts.extraGap;
    };

    const rule = () => {
      if (y < margin + 12) { page = pdf.addPage([A4.w, A4.h]); y = A4.h - margin; }
      page.drawLine({
        start: { x: margin, y },
        end: { x: A4.w - margin, y },
        thickness: 0.6,
        color: rgb(0.75, 0.75, 0.75),
      });
      y -= 12;
    };

    // Cabeçalho
    draw("Comprovante de Aprovacao — ERP Flow", { size: 16, bold: true });
    draw(
      `Pedido ${String(expense.id || "").slice(0, 8)}${
        expense.sap_doc_num ? ` · ERP #${expense.sap_doc_num}` : ""
      }`,
      { size: 10, color: [0.35, 0.35, 0.35], extraGap: 6 },
    );
    rule();

    // Cabeçalho do documento
    draw("Cabecalho", { size: 12, bold: true, extraGap: 2 });
    const bpLabel = expense.doc_type === "sales" ? "Cliente" : "Fornecedor";
    const headerFields: Array<[string, string]> = [
      [bpLabel, `${expense.supplier_name || "-"}${expense.supplier_code ? ` (${expense.supplier_code})` : ""}`],
      ["Solicitante", `${expense.requester_name || "-"}${expense.requester_email ? ` <${expense.requester_email}>` : ""}`],
      ["Empresa", String(expense.company_db || "-")],
      ["Data do documento", formatPdfDate(expense.doc_date)],
      ["Vencimento", formatPdfDate(expense.due_date)],
      ["Centro de custo", String(expense.cost_center || "-")],
      ["Projeto", String(expense.project || "-")],
      ["Valor total", formatPdfCurrency(expense.total_amount, expense.currency)],
      ["Criado em", formatPdfDateTime(expense.created_at)],
    ];
    for (const [label, value] of headerFields) {
      draw(`${label}: ${value}`, { size: 10 });
    }
    if (expense.remarks) {
      draw(" ", { size: 4 });
      draw("Observacoes", { size: 10, bold: true });
      draw(String(expense.remarks), { size: 10 });
    }
    y -= 6;
    rule();

    // Itens (resumido)
    if (Array.isArray(items) && items.length > 0) {
      draw(`Itens (${items.length})`, { size: 12, bold: true, extraGap: 2 });
      for (const it of items) {
        const desc = String(it.description || it.item_code || "-");
        const qty = Number(it.quantity || 0);
        const unit = formatPdfCurrency(it.unit_price, expense.currency);
        const total = formatPdfCurrency(it.line_total, expense.currency);
        const cc = it.cost_center ? ` · CC ${it.cost_center}` : "";
        const proj = it.project ? ` · Projeto ${it.project}` : "";
        draw(`- ${desc}`, { size: 10, bold: true });
        draw(`  Qtde ${qty} · Unit. ${unit} · Total ${total}${cc}${proj}`, { size: 9, color: [0.3, 0.3, 0.3] });
      }
      y -= 6;
      rule();
    }

    // Histórico de aprovação
    draw("Historico de Aprovacao", { size: 12, bold: true, extraGap: 2 });
    const decisionLabel: Record<string, string> = {
      created: "Criado",
      submitted: "Enviado para aprovacao",
      approved: "Aprovado",
      rejected: "Rejeitado",
      cancelled: "Cancelado",
      integrated: "Integrado ao ERP",
      integration_failed: "Falha na integracao",
    };
    if (!logRows || logRows.length === 0) {
      draw("Sem registros no historico de aprovacao.", { size: 10, color: [0.4, 0.4, 0.4] });
    } else {
      for (const r of logRows as Array<Record<string, any>>) {
        const label = decisionLabel[String(r.decision)] || String(r.decision || "-");
        const when = formatPdfDateTime(r.decided_at);
        const who = r.approver_name || r.approver_email || "-";
        const nivel = r.level_order ? ` · Nivel ${r.level_order}` : "";
        draw(`- ${when} — ${label} — ${who}${nivel}`, { size: 10, bold: true });
        if (r.remarks) draw(`  Obs.: ${r.remarks}`, { size: 9, color: [0.3, 0.3, 0.3] });
      }
    }

    y -= 10;
    draw(
      `Gerado automaticamente pelo ERP Flow em ${formatPdfDateTime(new Date().toISOString())}.`,
      { size: 8, color: [0.5, 0.5, 0.5] },
    );

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const supplierSlug = String(expense.supplier_name || "pedido")
      .replace(/[^A-Za-z0-9-_]+/g, "_")
      .slice(0, 40) || "pedido";
    const idSlug = String(expense.id || "").slice(0, 8);
    return { name: `ERPFlow_Aprovacao_${supplierSlug}_${idSlug}.pdf`, blob };
  } catch (e) {
    console.warn("buildApprovalReportPdf failed:", e);
    return null;
  }
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Bypass user auth when called internally (background retry job) with
  // the service role key. Cron / retry workers don't have a Cloud JWT or
  // SAP session — they always integrate via the Apiuser (service account).
  const authHeader = req.headers.get("authorization") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const internalHeader = req.headers.get("x-internal-retry") === "1";
  const isServiceRoleCall = !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}` && internalHeader;

  if (!isServiceRoleCall) {
    try {
      await requireUserOrSapSession(req);
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: "Faça login no SAP pela tela antes de integrar." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }



  // Track stage status across the whole request so we can persist progress
  // even when later stages fail. These are flushed on success and on error.
  let attachmentStatus: StageStatus = "not_applicable";
  let purchaseOrderStatus: StageStatus = "pending";
  let attachmentLinkStatus: StageStatus = "not_applicable";
  let expenseId: string | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;
  let pagcorpLog: any = null;
  let pagcorpLogWritten = false;
  let expenseSnapshot: any = null;
  // Captured outside the try/catch so the error path can return the same
  // payload that was actually sent to SAP (used by the integration log UI).
  let lastSapPayload: Record<string, unknown> | null = null;
  let lastSapResponse: unknown = null;

  const persistStatus = async (extra: Record<string, unknown> = {}) => {
    if (!supabase || !expenseId) return;
    try {
      await supabase
        .from("expenses")
        .update({
          sap_attachment_status: attachmentStatus,
          sap_purchase_order_status: purchaseOrderStatus,
          sap_attachment_link_status: attachmentLinkStatus,
          sap_integration_last_attempt_at: new Date().toISOString(),
          ...extra,
        })
        .eq("id", expenseId);
    } catch (e) {
      console.warn("Falha ao persistir status de integração:", e);
    }
  };

  const writePagCorpLog = async (
    status: "success" | "error",
    errorMessage?: string,
    sapDocEntry?: number,
    sapDocNum?: number,
    sapPayload?: unknown,
    sapResponse?: unknown,
  ) => {
    if (!supabase || !pagcorpLog?.transaction || pagcorpLogWritten) return;
    const tx = pagcorpLog.transaction;
    try {
      await supabase.from("pagcorp_integration_log").insert({
        pagcorp_expense_id: Number(tx.id),
        pagcorp_data: {
          description: tx.description,
          amount: tx.amount,
          currency: tx.currency,
          date: tx.date,
          accountAlias: tx.accountAlias,
          accountCode: tx.accountCode,
          hasAccountability: tx.hasAccountability,
          accountabilityApproved: tx.accountabilityApproved,
          receipts: tx.receipts,
          internalExpenseId: expenseId,
        },
        integration_type: pagcorpLog.integrationType || "accountability",
        status,
        company_db: pagcorpLog.companyDb || null,
        integrated_by: pagcorpLog.integratedBy || null,
        sap_doc_entry: sapDocEntry || null,
        sap_doc_num: sapDocNum || null,
        error_message: errorMessage || null,
        sap_payload: sapPayload || null,
        sap_response: sapResponse || null,
      } as any);
      pagcorpLogWritten = true;
    } catch (e) {
      console.warn("Falha ao registrar log PagCorp na função:", e);
    }
  };

  try {
    const body = await req.json();
    expenseId = body.expense_id;
    pagcorpLog = body.pagcorp_log || null;
    if (!expenseId) throw new Error("expense_id obrigatório");

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Load expense + items
    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .select("*")
      .eq("id", expenseId)
      .single();
    if (expErr || !expense) throw new Error(`Despesa não encontrada: ${expErr?.message ?? ""}`);
    expenseSnapshot = expense;

    // Guard: somente despesas totalmente aprovadas podem ser integradas ao SAP.
    // Se uma tela/aba antiga tentar integrar enquanto ainda há nível pendente,
    // tratamos como no-op seguro. Isso evita mostrar erro ao aprovador e, mais
    // importante, impede qualquer criação de PO antes do fim da alçada.
    if (String((expense as any).status || "") === "pendente_aprovacao") {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: "pending_approval",
          message: "Documento ainda possui nível de aprovação pendente; integração SAP não executada.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Status válidos: "aprovado" (primeira integração) ou estados pós-PC (re-link de anexos).
    const allowedStatuses = new Set([
      "aprovado",
      "pc_lancado",
      "nf_entrada",
      "pagamento",
      "finalizado",
    ]);
    if (!allowedStatuses.has(String((expense as any).status || ""))) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Despesa não está aprovada (status atual: ${(expense as any).status}). A integração ao SAP só é permitida após a conclusão de todos os níveis de aprovação.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: items, error: itemsErr } = await supabase
      .from("expense_items")
      .select("*")
      .eq("expense_id", expenseId);
    if (itemsErr) throw new Error(`Erro ao carregar itens: ${itemsErr.message}`);
    if (!items || items.length === 0) throw new Error("Despesa sem itens — não é possível lançar no SAP");

    // Centro de custo é obrigatório em cada linha (cabeçalho como fallback).
    // Sem CC o SAP grava sem apropriação — bloqueamos antes de enviar.
    const headerCc = String((expense as any).cost_center || "").trim();
    const missingCcLines: number[] = [];
    (items as any[]).forEach((it, idx) => {
      const lineCc = String(it.cost_center || "").trim();
      if (!lineCc && !headerCc) missingCcLines.push(idx + 1);
    });
    if (missingCcLines.length > 0) {
      throw new Error(
        `Centro de custo é obrigatório. Linha(s) sem centro de custo: ${missingCcLines.join(", ")}.`,
      );
    }

    // Lock anti-duplicação: impede dois cliques simultâneos de criar 2 POs no SAP.
    // Pulado se já há sap_doc_entry (caso de re-link de anexos tratado abaixo).
    if (!expense.sap_doc_entry) {
      const acquired = await tryAcquireIntegrationLock(supabase, "expenses", expenseId);
      if (!acquired) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Esta despesa já está sendo integrada ao SAP por outro processo. Aguarde alguns minutos e tente novamente.",
            alreadyProcessing: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const isSales = (expense as any).doc_type === "sales";
    const sapEndpoint = isSales ? "Orders" : "PurchaseOrders";
    const bpLabel = isSales ? "Cliente" : "Fornecedor";

    if (!expense.supplier_code) {
      throw new Error(`${bpLabel} (CardCode) não informado`);
    }

    // 2. SAP session resolution.
    //    - Default (approval flow, background retries): log in with the
    //      configured Apiuser stored in system_credentials. The integration
    //      user has consistent branch/role assignments and doesn't depend on
    //      the approver being logged in when the last level is approved.
    //    - Only the manual "Reintegrar ao SAP" button (super-users) passes
    //      `use_service_account: false` and reuses the caller's SAP session.
    const sapCreds = await getSapCredentials(supabase, expense.company_db || undefined);
    const sapBaseUrl = getSapBaseUrl(sapCreds);
    const useServiceAccount = body.use_service_account !== false; // default true
    let sapCookies: string;
    if (useServiceAccount) {
      const svcUser = sapCreds.username || sapCreds.user_name || sapCreds.api_user || "";
      const svcPass = sapCreds.password || sapCreds.api_password || "";
      const svcCompanyDb = sapCreds.company_db || expense.company_db || "";
      if (!svcUser || !svcPass || !svcCompanyDb) {
        throw new Error("Credenciais de integração (Apiuser) não configuradas para esta empresa.");
      }
      const loginRes = await fetch(`${sapBaseUrl}/Login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ UserName: svcUser, Password: svcPass, CompanyDB: svcCompanyDb }),
      });
      if (!loginRes.ok) {
        const text = await loginRes.text().catch(() => "");
        throw new Error(`Falha no login SAP (Apiuser) [${loginRes.status}]: ${text.slice(0, 200)}`);
      }
      await loginRes.json().catch(() => ({}));
      const setCookie = loginRes.headers.get("set-cookie") || "";
      const sid = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
      const rid = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
      if (!sid) throw new Error("SAP não retornou B1SESSION no login do Apiuser.");
      sapCookies = buildSapCookies(sid, rid || "");
    } else {
      const sapSessionId = typeof body.sap_session_id === "string" ? body.sap_session_id.trim() : "";
      const sapRouteId = typeof body.sap_route_id === "string" ? body.sap_route_id.trim() : "";
      const sapCompanyDb = typeof body.sap_company_db === "string" ? body.sap_company_db.trim() : "";
      const sapExpiresAt = Number(body.sap_session_expires_at || 0);
      if (!sapSessionId) throw new Error("Faça login no SAP pela tela antes de reintegrar.");
      if (sapExpiresAt && Date.now() >= sapExpiresAt) throw new Error("Sessão SAP expirada. Faça login novamente pela tela.");
      if (sapCompanyDb && expense.company_db && sapCompanyDb !== expense.company_db) {
        throw new Error("Sessão SAP pertence a outra empresa. Faça login na empresa da despesa.");
      }
      sapCookies = buildSapCookies(sapSessionId, sapRouteId);
    }
    const sap = { baseUrl: sapBaseUrl, cookies: sapCookies };

    if (expense.sap_doc_entry) {
      const existingAttachmentEntry = Number(expense.sap_attachment_entry || 0);
      if (existingAttachmentEntry > 0) {
        attachmentStatus = "success";
        purchaseOrderStatus = "success";
        attachmentLinkStatus = "pending";
        await ensureSapDocumentAttachmentLinked(
          sap.baseUrl,
          sap.cookies,
          sapEndpoint,
          Number(expense.sap_doc_entry),
          existingAttachmentEntry,
        );
        attachmentLinkStatus = "success";
        await persistStatus({ sap_integration_error: null });
      }

      return new Response(
        JSON.stringify({
          success: true,
          alreadyIntegrated: true,
          docEntry: expense.sap_doc_entry,
          docNum: expense.sap_doc_num,
          attachmentEntry: existingAttachmentEntry || null,
          stages: {
            attachment: attachmentStatus,
            purchase_order: purchaseOrderStatus,
            attachment_link: attachmentLinkStatus,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Build Purchase Order payload
    const today = new Date().toISOString().slice(0, 10);

    // Parse custom fields (UDFs) from credentials: header / line scope
    let headerCustom: Record<string, unknown> = {};
    let lineCustom: Record<string, unknown> = {};
    if (sapCreds.custom_fields) {
      try {
        const parsed = JSON.parse(sapCreds.custom_fields);
        if (Array.isArray(parsed)) {
          for (const f of parsed) {
            if (!f?.name || typeof f.name !== "string") continue;
            const target = f.scope === "line" ? lineCustom : headerCustom;
            target[f.name] = f.value ?? "";
          }
        }
      } catch (e) {
        console.warn("Falha ao parsear custom_fields SAP:", e);
      }
    }

    // 3.1 Attachments stage — upload first and link via AttachmentEntry.
    // Reuse sap_attachment_entry if a previous attempt already uploaded them
    // to avoid duplicating attachments in SAP when retrying after a failure.
    let attachmentEntry: number | null = expense.sap_attachment_entry ?? null;
    const integrateAttachments = (sapCreds.integrate_attachments || "").toLowerCase() === "true";

    if (integrateAttachments) {
      if (attachmentEntry !== null) {
        // Already uploaded in a previous run — nothing to do at this stage.
        attachmentStatus = "success";
        console.log(`Reaproveitando anexo já enviado ao SAP — AbsoluteEntry=${attachmentEntry}`);
      } else {
        attachmentStatus = "pending";
        try {
          const { data: atts, error: attErr } = await supabase
            .from("expense_attachments")
            .select("file_path, file_name")
            .eq("expense_id", expenseId);
          if (attErr) console.warn("Erro ao listar anexos:", attErr.message);

          const files: { name: string; blob: Blob }[] = [];
          for (const a of atts || []) {
            const { data: blob, error: dlErr } = await supabase.storage
              .from("expense-attachments")
              .download(a.file_path);
            if (dlErr || !blob) {
              console.warn(`Falha ao baixar anexo ${a.file_path}:`, dlErr?.message);
              continue;
            }
            files.push({ name: a.file_name, blob });
          }

          if (files.length === 0) {
            // No attachments to upload — feature is enabled but nothing to send.
            attachmentStatus = "not_applicable";
          } else {
            attachmentEntry = await uploadAttachmentsToSap(sap.baseUrl, sap.cookies, files);
            console.log(`Anexos enviados ao SAP — AbsoluteEntry=${attachmentEntry}`);
            if (attachmentEntry !== null) {
              attachmentStatus = "success";
              // Persist the SAP attachment reference + status immediately so a
              // retry after a later failure won't re-upload.
              await supabase
                .from("expenses")
                .update({
                  sap_attachment_entry: attachmentEntry,
                  sap_attachment_status: attachmentStatus,
                })
                .eq("id", expenseId);
            } else {
              attachmentStatus = "failed";
              await persistStatus({
                sap_integration_error: "SAP retornou AbsoluteEntry nulo no upload de anexos",
              });
              throw new Error("SAP retornou AbsoluteEntry nulo no upload de anexos");
            }
          }
        } catch (e) {
          attachmentStatus = "failed";
          const msg = e instanceof Error ? e.message : String(e);
          await persistStatus({ sap_integration_error: `Falha no envio do anexo: ${msg}` });
          throw e;
        }
      }
    }

    // Branch resolution: company-configured default ALWAYS wins unless the
    // expense explicitly stored a different branch_id. We treat branch_id of
    // 0/1 from older form defaults as "not set" so the company default applies.
    const configuredBranch = Number(sapCreds.default_branch_id || "");
    const fallbackBranch = Number.isFinite(configuredBranch) && configuredBranch > 0 ? configuredBranch : 1;
    const expenseBranch = Number(expense.branch_id);
    const branchId = (Number.isFinite(expenseBranch) && expenseBranch > 1)
      ? expenseBranch
      : fallbackBranch;

    // If we have an attachment to link, mark the link stage as pending so it
    // shows up in audit even if the PO creation fails.
    if (attachmentEntry !== null) attachmentLinkStatus = "pending";

    // Normalize dates to YYYY-MM-DD for SAP. Fallback to today when absent.
    // The expense stores dates as ISO strings from a date input (already YYYY-MM-DD)
    // or as timestamptz — slice(0,10) works for both without timezone drift.
    const normalizeDate = (v: unknown): string => {
      if (!v) return today;
      const s = String(v);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : today;
    };
    const docDate = normalizeDate((expense as any).doc_date);
    const dueDate = normalizeDate((expense as any).due_date ?? (expense as any).doc_date);

    // Solicitante: usuário que criou a solicitação (login SAP, ex.: matheus.moreira).
    // Preferimos o prefixo do e-mail (created_by_email → requester_email); caímos
    // para requester_name quando não há e-mail.
    const requesterCode = (() => {
      const email = String((expense as any).created_by_email || (expense as any).requester_email || "").trim();
      if (email && email.includes("@")) return email.split("@")[0].toLowerCase();
      const name = String((expense as any).requester_name || "").trim();
      return name.toLowerCase();
    })();

    const sapPayload: Record<string, unknown> = {
      CardCode: expense.supplier_code,
      // DocDate = data de lançamento no SAP: sempre HOJE.
      // TaxDate = data do documento (emissão da NF), vem do formulário.
      // DocDueDate = data de vencimento, vem do formulário.
      DocDate: today,
      DocDueDate: dueDate,
      TaxDate: docDate,
      BPL_IDAssignedToInvoice: branchId,
      // Fallback: quando o SAP não tiver o UDF U_FGR_SOLICITANTE configurado,
      // o nome do solicitante fica preservado nas Observações (Comments).
      Comments: truncateSapText(
        (() => {
          const pcTx: any = (pagcorpLog as any)?.transaction || null;
          const holder = pcTx
            ? (pcTx.cardName || pcTx.accountAlias || pcTx.accountName || "").toString().trim()
            : "";
          const prefix = (expense as any).origin === "pagcorp" || pcTx
            ? `PagCorp${holder ? ` ${holder}` : ""}`
            : `${isSales ? "Pedido de venda" : "Despesa interna"} #${expense.id.slice(0, 8)}`;
          const solicitanteTag = requesterCode ? ` [Solicitante: ${requesterCode}]` : "";
          return `${prefix} — ${expense.requester_name}${solicitanteTag}${expense.remarks ? ` — ${expense.remarks}` : ""}`;
        })(),
        190,
      ),
      // Campo dedicado no SAP (UDF) — quando existir na base, permite filtrar
      // pelos pedidos criados por um usuário específico sem depender do texto.
      ...(requesterCode ? { U_FGR_SOLICITANTE: truncateSapText(requesterCode, 50) } : {}),
      ...(attachmentEntry !== null ? { AttachmentEntry: attachmentEntry } : {}),
      ...headerCustom,
      DocumentLines: items.map((it: any) => {
        const hasItem = !!it.item_code;
        const qty = Number(it.quantity) || 1;
        let unit = Number(it.unit_price) || 0;
        const lineTotal = Number(it.line_total) || 0;
        // Defense: if unit_price is 0/missing but we have a line_total, derive it.
        // SAP rejects/zeroes lines with UnitPrice=0, even when LineTotal is set.
        if (unit === 0 && lineTotal !== 0 && qty !== 0) {
          unit = lineTotal / qty;
        }
        const invoiceDesc = truncateSapText(it.description, 254);
        const line: Record<string, unknown> = {
          Quantity: qty,
          UnitPrice: unit,
          ...lineCustom,
        };
        if (hasItem) {
          // Mantém a descrição do item vinda do SAP (não sobrescreve com a da NF).
          // A descrição vinda da NF vai para o campo "Texto Livre" (FreeText).
          line.ItemCode = it.item_code;
          if (invoiceDesc) line.FreeText = invoiceDesc;
        } else {
          // Linha de serviço: sem ItemCode, a descrição é o próprio texto do item.
          line.LineType = "dDocument_Service";
          line.ItemDescription = truncateSapText(it.description, 100);
          if (invoiceDesc) line.FreeText = invoiceDesc;
        }
        if (it.cost_center || expense.cost_center) line.CostingCode = it.cost_center || expense.cost_center;
        // Open Gaming: se o projeto não vier preenchido na linha nem no cabeçalho,
        // aplica fallback fixo "OPEN GAMING" (política interna da empresa).
        const projectFallback = expense.company_db === "open_gaming_sa" ? "OPEN GAMING" : "";
        const resolvedProject = it.project || expense.project || projectFallback;
        if (resolvedProject) line.ProjectCode = resolvedProject;
        for (const k of Object.keys(line)) if (line[k] === undefined) delete line[k];
        return line;
      }),
    };
    lastSapPayload = sapPayload;

    // 4. Post to PurchaseOrders. The link stage succeeds in the same call as
    // the PO creation because SAP B1 binds AttachmentEntry into the document
    // header at insert time.
    let sapResult;
    try {
      sapResult = await postSapDocument(sap.baseUrl, sap.cookies, sapPayload, sapEndpoint);
      lastSapResponse = sapResult.response;
      purchaseOrderStatus = "success";
      if (attachmentEntry !== null) {
        await ensureSapDocumentAttachmentLinked(sap.baseUrl, sap.cookies, sapEndpoint, sapResult.docEntry, attachmentEntry);
        attachmentLinkStatus = "success";
      }
    } catch (e) {
      purchaseOrderStatus = "failed";
      // If the PO failed, the attachment was uploaded but never linked to a
      // document — surface that explicitly instead of leaving the stage as
      // "pending" forever.
      if (attachmentEntry !== null) attachmentLinkStatus = "failed";
      const msg = e instanceof Error ? e.message : String(e);
      await persistStatus({ sap_integration_error: `Falha ao criar Pedido de Compra: ${msg}` });
      throw e;
    }

    // 5. Update expense record (clear error + flush all stage statuses)
    await supabase
      .from("expenses")
      .update({
        status: "pc_lancado",
        sap_doc_entry: sapResult.docEntry,
        sap_doc_num: sapResult.docNum,
        sap_attachment_status: attachmentStatus,
        sap_purchase_order_status: purchaseOrderStatus,
        sap_attachment_link_status: attachmentLinkStatus,
        sap_integration_error: null,
        sap_integration_last_attempt_at: new Date().toISOString(),
      })
      .eq("id", expenseId);

    // 6. Audit
    await supabase.rpc("insert_audit_log", {
      p_action: "sap_document_created",
      p_entity_type: "expense",
      p_entity_id: expenseId,
      p_company_db: expense.company_db || null,
      p_details: {
        sap_endpoint: sapEndpoint,
        sap_doc_entry: sapResult.docEntry,
        sap_doc_num: sapResult.docNum,
        sap_attachment_entry: attachmentEntry,
        stage_status: {
          attachment: attachmentStatus,
          purchase_order: purchaseOrderStatus,
          attachment_link: attachmentLinkStatus,
        },
      },
    });

    await writePagCorpLog("success", undefined, sapResult.docEntry, sapResult.docNum, sapPayload, sapResult.response);

    await notifyErpIntegration({
      status: "success",
      source: "expense",
      entityId: expenseId || "",
      companyDb: expenseSnapshot?.company_db,
      docEntry: sapResult.docEntry,
      docNum: sapResult.docNum,
      requester: expenseSnapshot?.requester_name,
      supplier: expenseSnapshot?.supplier_name,
      amount: expenseSnapshot?.total_amount,
      currency: expenseSnapshot?.currency,
    });

    // Contingência: se o pedido foi integrado sem nenhum anexo vinculado
    // (integração de anexos desligada ou nenhum arquivo enviado), avisa via
    // WhatsApp para lançamento manual.
    if (attachmentEntry === null) {
      const attachmentLinks = expenseId
        ? await getExpenseAttachmentLinks(supabase, expenseId)
        : [];
      await notifyMissingAttachmentWhatsApp({
        companyDb: expenseSnapshot?.company_db,
        entityId: expenseId || "",
        docEntry: sapResult.docEntry,
        docNum: sapResult.docNum,
        requester: expenseSnapshot?.requester_name,
        supplier: expenseSnapshot?.supplier_name,
        amount: expenseSnapshot?.total_amount,
        currency: expenseSnapshot?.currency,
        reason: integrateAttachments ? "no_attachment_uploaded" : "integration_attachments_disabled",
        attachments: attachmentLinks,
      });
      await notifyMissingAttachmentEmail({
        supabase,
        companyDb: expenseSnapshot?.company_db,
        entityId: expenseId || "",
        docEntry: sapResult.docEntry,
        docNum: sapResult.docNum,
        requester: expenseSnapshot?.requester_name,
        requesterEmail: expenseSnapshot?.requester_email,
        supplier: expenseSnapshot?.supplier_name,
        amount: expenseSnapshot?.total_amount,
        currency: expenseSnapshot?.currency,
        reason: integrateAttachments ? "no_attachment_uploaded" : "integration_attachments_disabled",
        attachments: attachmentLinks,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        docEntry: sapResult.docEntry,
        docNum: sapResult.docNum,
        sapPayload,
        sapResponse: sapResult.response,
        pagcorpLogged: pagcorpLogWritten,
        stages: {
          attachment: attachmentStatus,
          purchase_order: purchaseOrderStatus,
          attachment_link: attachmentLinkStatus,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("expense-to-sap error:", msg);
    // Best-effort: persist whatever stage statuses we collected before the throw.
    await persistStatus({ sap_integration_error: msg });
    await writePagCorpLog("error", msg, undefined, undefined, lastSapPayload, lastSapResponse);
    await notifyErpIntegration({
      status: "error",
      source: "expense",
      entityId: expenseId || "",
      companyDb: expenseSnapshot?.company_db,
      errorMessage: msg,
      requester: expenseSnapshot?.requester_name,
      supplier: expenseSnapshot?.supplier_name,
      amount: expenseSnapshot?.total_amount,
      currency: expenseSnapshot?.currency,
    });
    return new Response(
      JSON.stringify({
        success: false,
        error: msg,
        sapPayload: lastSapPayload,
        sapResponse: lastSapResponse,
        pagcorpLogged: pagcorpLogWritten,
        stages: {
          attachment: attachmentStatus,
          purchase_order: purchaseOrderStatus,
          attachment_link: attachmentLinkStatus,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    // Libera o lock anti-duplicação (no-op se nunca foi adquirido).
    if (supabase && expenseId) {
      await releaseIntegrationLock(supabase, "expenses", expenseId);
    }
  }
});
