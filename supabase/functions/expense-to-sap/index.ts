import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
import { ensureCopyToTargetDocument } from "../_shared/sap-attach-copy.ts";
// Edge function: post an internal approved expense as a Purchase Order in SAP B1
// Endpoint: POST /functions/v1/expense-to-sap
// Body: { expense_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { requireUserOrSapSession } from "../_shared/auth.ts";
import { tryAcquireIntegrationLock, releaseIntegrationLock } from "../_shared/sap-fetch.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";
import { sanitizeSapFileName } from "../_shared/sap-filename.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { normalizeExpenseItems } from "../_shared/expense-items.ts";
import { callOmieApi, loadOmieCredentials } from "../_shared/omie-api.ts";
import { buildOmiePurchaseOrderPayload } from "../_shared/omie-purchase-order.ts";
import { buildOmieSalesOrderPayload } from "../_shared/omie-sales-order.ts";
import { isExpenseIntegrationCancelled } from "../_shared/expense-integration-cancel.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

async function resolveOmieSalesCurrentAccount(
  credentials: Awaited<ReturnType<typeof loadOmieCredentials>>,
): Promise<number> {
  const configured = Number(credentials.sales_current_account_code);
  if (Number.isFinite(configured) && configured > 0) return configured;

  const response = await callOmieApi<{
    ListarContasCorrentes?: Array<{ nCodCC?: number; descricao?: string; inativo?: string }>;
  }>(credentials, "geral/contacorrente/", "ListarContasCorrentes", {
    pagina: 1,
    registros_por_pagina: 100,
    apenas_importado_api: "N",
  });
  const active = (response.ListarContasCorrentes || []).filter((account) =>
    Number(account.nCodCC) > 0 && String(account.inativo || "N").toUpperCase() !== "S"
  );
  if (active.length === 1) return Number(active[0].nCodCC);
  if (active.length === 0) {
    throw new Error("Nenhuma conta corrente ativa foi encontrada no Omie para o Pedido de Venda.");
  }
  throw new Error(
    "Há mais de uma conta corrente ativa no Omie. Configure 'Conta corrente para vendas' nas credenciais da empresa.",
  );
}

function omieSalesOrderFacts(response: Record<string, unknown>): { id: number; number: number | null } {
  const header = response.cabecalho && typeof response.cabecalho === "object"
    ? response.cabecalho as Record<string, unknown>
    : {};
  const id = Number(response.codigo_pedido ?? header.codigo_pedido);
  const number = Number(response.numero_pedido ?? header.numero_pedido);
  return {
    id,
    number: Number.isFinite(number) && number > 0 ? number : null,
  };
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

function sapFlagNo(value: unknown): boolean {
  return String(value ?? "").toLowerCase() === "tno" || value === false;
}

function sapFlagYes(value: unknown): boolean {
  return String(value ?? "").toLowerCase() === "tyes" || value === true;
}

async function validatePurchaseItemsActive(
  sapBaseUrl: string,
  cookies: string,
  companyDb: string,
  items: Array<{ item_code?: string | null }>,
) {
  const codes = Array.from(
    new Set(
      (items || [])
        .map((it) => String(it?.item_code || "").trim())
        .filter(Boolean),
    ),
  );
  if (codes.length === 0) return;

  const invalid: string[] = [];
  for (const code of codes) {
    const escaped = code.replace(/'/g, "''");
    const res = await fetch(
      `${sapBaseUrl}/Items('${encodeURIComponent(escaped)}')?$select=ItemCode,ItemName,Valid,Frozen,ItemType,PurchaseItem`,
      { headers: { Cookie: cookies } },
    );
    if (!res.ok) {
      invalid.push(`${code} (não encontrado na empresa ${companyDb})`);
      continue;
    }
    const row = await res.json().catch(() => ({} as any));
    const inactive =
      sapFlagNo(row.Valid) ||
      sapFlagYes(row.Frozen) ||
      String(row.ItemType || "") === "itFixedAssets" ||
      sapFlagNo(row.PurchaseItem);
    if (inactive) invalid.push(`${code}${row.ItemName ? ` - ${row.ItemName}` : ""}`);
  }
  if (invalid.length > 0) {
    throw new Error(
      `Item inativo ou não liberado para compras no ERP (${companyDb}): ${invalid.join(", ")}. Selecione um item ativo para esta empresa.`,
    );
  }
}

/**
 * Atualiza (patch completo) um documento já existente no SAP.
 * O Service Layer substitui a coleção DocumentLines inteira quando ela é
 * enviada no corpo, então mandamos todas as linhas com LineNum sequencial —
 * garantindo que itens, valores, centros de custo e projetos fiquem idênticos
 * ao que foi aprovado no ERP Flow (sem divergência).
 */
async function patchSapDocument(
  sapBaseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
  payload: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${sapBaseUrl}/${endpoint}(${docEntry})`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
      Prefer: "return=representation",
      // Sem este header o Service Layer faz merge da coleção e pode manter
      // linhas antigas ou incompletas. O payload aprovado é a fonte da verdade.
      "B1S-ReplaceCollectionsOnPatch": "true",
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 204) return {};
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`SAP ${endpoint}(${docEntry}) update failed [${res.status}]: ${msg}`);
  }
  return body;
}

async function verifySapDocumentLines(
  sapBaseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
  expected: Array<Record<string, unknown>>,
): Promise<void> {
  const res = await fetch(`${sapBaseUrl}/${endpoint}(${docEntry})`, {
    headers: { Cookie: cookies },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PATCH executado, mas a conferência no SAP falhou [${res.status}].`);

  const actual = Array.isArray(body?.DocumentLines) ? body.DocumentLines : [];
  if (actual.length !== expected.length) {
    throw new Error(`SAP manteve ${actual.length} linha(s), mas a versão aprovada possui ${expected.length}.`);
  }

  const text = (value: unknown) => String(value ?? "").trim();
  const close = (a: unknown, b: unknown) => Math.abs(Number(a) - Number(b)) < 0.005;
  for (let index = 0; index < expected.length; index++) {
    const wanted = expected[index];
    const saved = actual[index] || {};
    const savedUnitPrice = saved.UnitPrice ?? saved.Price;
    if (
      text(saved.ItemCode) !== text(wanted.ItemCode) ||
      !close(saved.Quantity, wanted.Quantity) ||
      !close(savedUnitPrice, wanted.UnitPrice) ||
      text(saved.CostingCode) !== text(wanted.CostingCode) ||
      text(saved.ProjectCode) !== text(wanted.ProjectCode)
    ) {
      throw new Error(
        `SAP não confirmou item, quantidade, valor, projeto e centro de custo da linha ${index + 1}.`,
      );
    }
  }
}

/** Só é seguro atualizar documentos abertos e sem documento de destino. */
async function assertSapDocumentEditable(
  sapBaseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
): Promise<void> {
  const res = await fetch(
    `${sapBaseUrl}/${endpoint}(${docEntry})?$select=DocumentStatus,Cancelled,DocNum`,
    { headers: { Cookie: cookies } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`Não foi possível ler o documento no SAP [${res.status}]: ${msg}`);
  }
  if (String(body?.Cancelled || "") === "tYES") {
    throw new Error("Documento cancelado no SAP — não é possível atualizar.");
  }
  if (String(body?.DocumentStatus || "") !== "bost_Open") {
    throw new Error(
      "Documento já encerrado/copiado no SAP (NF de entrada ou recebimento lançado) — atualização não permitida.",
    );
  }
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
    // SAP B1 SL expects files appended as form parts; the field name is the filename.
    // SAP rejeita nomes com espaço/ponto no final ("File name cannot end with space string.").
    const safeName = sanitizeSapFileName(f.name, f.blob?.type);
    form.append("files", f.blob, safeName);
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
  const absoluteEntry: number | null = body.AbsoluteEntry ?? null;

  await ensureCopyToTargetDocument(sapBaseUrl, cookies, absoluteEntry, body, files.length);

  return absoluteEntry;
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
    const erpFlowCode = String(expense.id || "").slice(0, 8) || "sem-codigo";
    return { name: `ERPFlow_${erpFlowCode}_Aprovacao_${supplierSlug}.pdf`, blob };
  } catch (e) {
    console.warn("buildApprovalReportPdf failed:", e);
    return null;
  }
}



Deno.serve(withEdgeMetrics("expense-to-sap", async (req, _mctx) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
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
        JSON.stringify({ success: false, error: "Faça login no ERP Flow antes de integrar." }),
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
  // Payloads antigos ainda podem enviar skip_attachments, mas integração sem
  // anexo não é mais permitida; a flag passa pela trava antes do POST/PATCH.
  let skipAttachments = false;
  let expenseSnapshot: any = null;
  let expenseErpType = "sap";
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
    skipAttachments = body.skip_attachments === true;
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

    const { data: company } = await supabase
      .from("companies")
      .select("erp_type")
      .eq("company_db", expense.company_db)
      .maybeSingle();
    expenseErpType = String(company?.erp_type || "sap").toLowerCase();
    const integrationSystem = expenseErpType === "omie" ? "omie" : "sap_b1";
    const integrationPause = await getIntegrationPause(integrationSystem);
    if (integrationPause) return pauseResponse(integrationPause, corsHeaders);

    if (await isExpenseIntegrationCancelled(supabase, expenseId)) {
      return new Response(
        JSON.stringify({
          success: false,
          cancelled: true,
          error: "Integração cancelada manualmente no monitor. Reative com Disparar agora.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
          message: "Documento ainda possui nível de aprovação pendente; integração ERP não executada.",
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

    const { data: rawItems, error: itemsErr } = await supabase
      .from("expense_items")
      .select("*")
      .eq("expense_id", expenseId);
    if (itemsErr) throw new Error(`Erro ao carregar itens: ${itemsErr.message}`);
    if (!rawItems || rawItems.length === 0) throw new Error("Despesa sem itens — não é possível lançar no ERP");
    const isSalesDoc = String((expense as any).doc_type || "") === "sales";
    const items = normalizeExpenseItems(rawItems, { requireCostCenter: !isSalesDoc });

    // Centro de custo é obrigatório em cada linha (cabeçalho como fallback).
    // Sem CC o SAP grava sem apropriação — bloqueamos antes de enviar.
    // Exceção: pedidos de venda usam o CC padrão 1.1.1.1 como fallback.
    const headerCc = String((expense as any).cost_center || "").trim();
    const missingCcLines: number[] = [];
    (items as any[]).forEach((it, idx) => {
      const lineCc = String(it.cost_center || "").trim();
      if (!lineCc && !headerCc) missingCcLines.push(idx + 1);
    });
    if (missingCcLines.length > 0 && !isSalesDoc) {
      const allocationLabel = expenseErpType === "omie" ? "Categoria Omie" : "Centro de custo";
      throw new Error(
        `${allocationLabel}: preenchimento obrigatório. Linha(s) sem preenchimento: ${missingCcLines.join(", ")}.`,
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
            error: "Esta despesa já está sendo integrada ao ERP por outro processo. Aguarde alguns minutos e tente novamente.",
            alreadyProcessing: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // O cancelamento também é conferido depois do lock. Isso fecha a corrida
      // em que o operador cancela entre a leitura inicial e a aquisição do lock.
      if (await isExpenseIntegrationCancelled(supabase, expenseId)) {
        return new Response(
          JSON.stringify({
            success: false,
            cancelled: true,
            error: "Integração cancelada manualmente no monitor. Reative com Disparar agora.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const isSales = (expense as any).doc_type === "sales";
    const sapEndpoint = isSales ? "Orders" : "PurchaseOrders";
    const bpLabel = isSales ? "Cliente" : "Fornecedor";

    if (!expense.supplier_code) {
      throw new Error(`${bpLabel} (CardCode) não informado`);
    }

    if (expenseErpType === "omie") {
      if (expense.sap_doc_entry) {
        if (body.patch_document === true) {
          throw new Error(`Atualização de Pedido de ${isSales ? "Venda" : "Compra"} Omie já integrado ainda não está habilitada.`);
        }
        return new Response(
          JSON.stringify({
            success: true,
            alreadyIntegrated: true,
            docEntry: expense.sap_doc_entry,
            docNum: expense.sap_doc_num,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: localAttachments, error: localAttachmentsError } = await supabase
        .from("expense_attachments")
        .select("id")
        .eq("expense_id", expenseId)
        .limit(1);
      if (localAttachmentsError) {
        throw new Error(`Erro ao validar anexos do pedido: ${localAttachmentsError.message}`);
      }
      if (!localAttachments || localAttachments.length === 0) {
        attachmentStatus = "failed";
        throw new Error("Documento sem anexo interno. Anexe ao menos 1 arquivo antes de integrar à Omie.");
      }
      attachmentStatus = "success";
      attachmentLinkStatus = "not_applicable";

      let omiePayload:
        | ReturnType<typeof buildOmiePurchaseOrderPayload>
        | ReturnType<typeof buildOmieSalesOrderPayload>;
      let credentials: Awaited<ReturnType<typeof loadOmieCredentials>>;
      try {
        credentials = await loadOmieCredentials(supabase, String(expense.company_db || ""));
        if (isSales) {
          const currentAccount = await resolveOmieSalesCurrentAccount(credentials);
          omiePayload = buildOmieSalesOrderPayload(
            expense,
            items as any[],
            currentAccount,
            credentials.sales_stage_code || "10",
          );
        } else {
          omiePayload = buildOmiePurchaseOrderPayload(expense, items as any[]);
        }
      } catch (error) {
        purchaseOrderStatus = "failed";
        throw error;
      }
      const omieCallName = isSales ? "IncluirPedido" : "IncluirPedCompra";
      const omieEndpoint = isSales ? "produtos/pedido/" : "produtos/pedidocompra/";
      const requestPayload = {
        call: omieCallName,
        param: [omiePayload],
      };
      lastSapPayload = requestPayload;
      let omieResponse: Record<string, unknown>;
      let recoveredExistingOrder = false;
      try {
        omieResponse = await callOmieApi<Record<string, unknown>>(
          credentials,
          omieEndpoint,
          omieCallName,
          omiePayload,
        );
      } catch (error) {
        if (!isSales) {
          purchaseOrderStatus = "failed";
          throw error;
        }

        // O código de integração do pedido é estável. Se a Omie criou o pedido
        // mas a resposta se perdeu antes de persistirmos o vínculo, recuperamos
        // o documento existente em vez de tentar gerar uma duplicidade.
        try {
          const integrationCode = (omiePayload as ReturnType<typeof buildOmieSalesOrderPayload>)
            .cabecalho.codigo_pedido_integracao;
          omieResponse = await callOmieApi<Record<string, unknown>>(
            credentials,
            "produtos/pedido/",
            "ConsultarPedido",
            { codigo_pedido_integracao: integrationCode },
          );
          recoveredExistingOrder = true;
        } catch {
          purchaseOrderStatus = "failed";
          throw error;
        }
      }
      lastSapResponse = omieResponse;
      const salesFacts = isSales ? omieSalesOrderFacts(omieResponse) : null;
      const omieDocumentId = isSales ? Number(salesFacts?.id) : Number(omieResponse.nCodPed);
      const purchaseDocumentNumber = Number(omieResponse.cNumero);
      const omieDocumentNumber = isSales
        ? salesFacts?.number ?? null
        : Number.isFinite(purchaseDocumentNumber) && purchaseDocumentNumber > 0
          ? purchaseDocumentNumber
          : null;
      if (!Number.isFinite(omieDocumentId) || omieDocumentId <= 0) {
        purchaseOrderStatus = "failed";
        const statusDescription = String(
          omieResponse.cDescStatus || omieResponse.descricao_status || omieResponse.codigo_status || "",
        ).trim();
        throw new Error(
          statusDescription || `A Omie não retornou o código interno do Pedido de ${isSales ? "Venda" : "Compra"} criado.`,
        );
      }
      purchaseOrderStatus = "success";

      const { error: omiePersistError } = await supabase
        .from("expenses")
        .update({
          status: "pc_lancado",
          sap_doc_entry: omieDocumentId,
          sap_doc_num: omieDocumentNumber,
          sap_attachment_status: attachmentStatus,
          sap_purchase_order_status: purchaseOrderStatus,
          sap_attachment_link_status: attachmentLinkStatus,
          sap_integration_error: null,
          sap_integration_last_attempt_at: new Date().toISOString(),
        })
        .eq("id", expenseId);
      if (omiePersistError) {
        throw new Error(
          `Pedido de ${isSales ? "Venda" : "Compra"} ${omieDocumentId} criado na Omie, mas não foi possível salvar o vínculo local: ${omiePersistError.message}`,
        );
      }

      await supabase.rpc("insert_audit_log", {
        p_action: isSales
          ? (recoveredExistingOrder ? "omie_sales_order_recovered" : "omie_sales_order_created")
          : "omie_purchase_order_created",
        p_entity_type: "expense",
        p_entity_id: expenseId,
        p_company_db: expense.company_db || null,
        p_details: {
          erp_type: "omie",
          document_type: isSales ? "sales_order" : "purchase_order",
          recovered_existing_order: recoveredExistingOrder,
          omie_document_id: omieDocumentId,
          omie_document_number: omieDocumentNumber,
          stage_status: {
            attachment: attachmentStatus,
            purchase_order: purchaseOrderStatus,
            attachment_link: attachmentLinkStatus,
          },
        },
      });

      await writePagCorpLog(
        "success",
        undefined,
        omieDocumentId,
        omieDocumentNumber ?? undefined,
        requestPayload,
        omieResponse,
      );
      await notifyErpIntegration({
        status: "success",
        source: "expense",
        entityId: expenseId || "",
        companyDb: expense.company_db,
        docEntry: omieDocumentId,
        docNum: omieDocumentNumber,
        requester: expense.requester_name,
        supplier: expense.supplier_name,
        amount: expense.total_amount,
        currency: expense.currency,
      });

      return new Response(
        JSON.stringify({
          success: true,
          erpType: "omie",
          docEntry: omieDocumentId,
          docNum: omieDocumentNumber,
          sapPayload: requestPayload,
          sapResponse: omieResponse,
          stages: {
            attachment: attachmentStatus,
            purchase_order: purchaseOrderStatus,
            attachment_link: attachmentLinkStatus,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
    if (!isSales) {
      await validatePurchaseItemsActive(sap.baseUrl, sap.cookies, String(expense.company_db || ""), items as any[]);
    }

    // 2.5 SAFETY CHECK — o CardCode existente em SAP deve pertencer ao MESMO
    // fornecedor (mesmo CNPJ) esperado pelo ERP Flow. Se o cache local
    // "reservou" um CardCode que na verdade já existia em SAP para outro BP
    // (ex.: erro de criação com "Assign business partner to at least one branch"),
    // criar o PO com esse CardCode gera divergência silenciosa. Aborta.
    if (!expense.sap_doc_entry && expense.supplier_code) {
      const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D+/g, "");
      const { data: localSup } = await supabase
        .from("suppliers")
        .select("id, card_code, card_name, federal_tax_id, sap_sync_status, sap_sync_error")
        .eq("company_db", expense.company_db)
        .eq("card_code", expense.supplier_code)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const expectedTaxId = onlyDigits(localSup?.federal_tax_id);
      if (expectedTaxId) {
        const bpResp = await fetch(
          `${sap.baseUrl}/BusinessPartners('${encodeURIComponent(expense.supplier_code)}')?$select=CardCode,CardName,FederalTaxID`,
          { headers: { Cookie: sap.cookies } },
        );
        if (bpResp.ok) {
          const bp = await bpResp.json().catch(() => ({} as any));
          const sapTaxId = onlyDigits(bp?.FederalTaxID);
          if (sapTaxId && sapTaxId !== expectedTaxId) {
            const msg =
              `CardCode ${expense.supplier_code} no SAP pertence a "${bp?.CardName || "?"}"` +
              ` (CNPJ ${bp?.FederalTaxID || "?"}), mas o fornecedor esperado é` +
              ` "${localSup?.card_name || expense.supplier_name || "?"}"` +
              ` (CNPJ ${localSup?.federal_tax_id || "?"}). Cadastro divergente — recadastre o fornecedor no SAP.`;
            if (localSup?.id) {
              await supabase.from("suppliers").update({
                sap_sync_status: "error",
                sap_sync_error: msg.slice(0, 500),
                card_code: null,
              }).eq("id", localSup.id);
            }
            await persistStatus({ sap_integration_error: msg });
            throw new Error(msg);
          }
        }
      }
    }

    // Documento já existe no SAP. Se ele voltou para "aprovado" (foi editado no
    // ERP Flow e reaprovado) e ainda não tem NF de entrada lançada, fazemos o
    // PATCH completo do documento — itens, valores, centros de custo, projeto,
    // datas e observação — para não gerar divergência entre Flow e ERP.
    const isPatchMode = !!expense.sap_doc_entry
      && (body.patch_document === true || String((expense as any).status || "") === "aprovado");

    const ensureAttachmentEntryUploaded = async (): Promise<number> => {
      const existingAttachmentEntry = Number(expense.sap_attachment_entry || 0);
      if (existingAttachmentEntry > 0) {
        attachmentStatus = "success";
        console.log(`Reaproveitando anexo já enviado ao SAP — AbsoluteEntry=${existingAttachmentEntry}`);
        return existingAttachmentEntry;
      }

      const attachmentsEnabled = (sapCreds.integrate_attachments || "").toLowerCase() === "true";
      if (skipAttachments) {
        attachmentStatus = "failed";
        throw new Error("Documentos não podem ser integrados sem anexo.");
      }
      if (!attachmentsEnabled) {
        attachmentStatus = "failed";
        throw new Error("Integração de anexos está desativada para esta empresa. Ative anexos para criar documentos no SAP.");
      }

      attachmentStatus = "pending";
      try {
        const { data: atts, error: attErr } = await supabase
          .from("expense_attachments")
          .select("file_path, file_name")
          .eq("expense_id", expenseId);
        if (attErr) throw new Error(`Erro ao listar anexos: ${attErr.message}`);

        const storedAttachments = Array.isArray(atts) ? atts : [];
        if (storedAttachments.length === 0) {
          throw new Error("Documento sem anexo interno. Anexe ao menos 1 arquivo antes de integrar ao SAP.");
        }

        const files: { name: string; blob: Blob }[] = [];
        const failedDownloads: string[] = [];
        for (const a of storedAttachments) {
          const { data: blob, error: dlErr } = await supabase.storage
            .from("expense-attachments")
            .download(a.file_path);
          if (dlErr || !blob) {
            console.warn(`Falha ao baixar anexo ${a.file_path}:`, dlErr?.message);
            failedDownloads.push(a.file_name || a.file_path);
            continue;
          }
          files.push({ name: a.file_name, blob });
        }
        if (failedDownloads.length > 0) {
          throw new Error(`Falha ao baixar anexo(s) obrigatório(s): ${failedDownloads.join(", ")}`);
        }

        // Sempre incluir o "Comprovante de Aprovação (ERP Flow)" como anexo
        // adicional para deixar rastro do fluxo interno de aprovação dentro do
        // documento do ERP, além dos anexos enviados pelo usuário.
        const approvalPdf = await buildApprovalReportPdf(supabase, expense as any, items as any[]);
        if (approvalPdf) files.push(approvalPdf);

        const uploadedEntry = await uploadAttachmentsToSap(sap.baseUrl, sap.cookies, files);
        if (uploadedEntry === null) {
          throw new Error("SAP retornou AbsoluteEntry nulo no upload de anexos");
        }

        attachmentStatus = "success";
        await supabase
          .from("expenses")
          .update({
            sap_attachment_entry: uploadedEntry,
            sap_attachment_status: attachmentStatus,
          })
          .eq("id", expenseId);
        console.log(`Anexos enviados ao SAP — AbsoluteEntry=${uploadedEntry}`);
        return uploadedEntry;
      } catch (e) {
        attachmentStatus = "failed";
        const msg = e instanceof Error ? e.message : String(e);
        await persistStatus({ sap_integration_error: `Falha no envio do anexo: ${msg}` });
        throw e;
      }
    };

    if (expense.sap_doc_entry && !isPatchMode) {
      let existingAttachmentEntry = 0;
      try {
        existingAttachmentEntry = await ensureAttachmentEntryUploaded();
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
      } catch (e) {
        attachmentLinkStatus = "failed";
        const msg = e instanceof Error ? e.message : String(e);
        await persistStatus({ sap_integration_error: msg });
        throw e;
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

    if (isPatchMode) {
      // Guard-rails: NF de entrada lançada no Flow ou documento fechado no SAP.
      const { data: nfByExpense } = await supabase
        .from("nf_entrada_imports")
        .select("status, sap_invoice_draft_id")
        .eq("expense_id", expenseId);
      const patchEntry = Number(expense.sap_doc_entry || 0);
      const { data: nfBySap } = patchEntry > 0
        ? await supabase
          .from("nf_entrada_imports")
          .select("status, sap_invoice_draft_id")
          .eq("sap_company_db", String(expense.company_db || ""))
          .eq("sap_matched_po_doc_entry", patchEntry)
        : { data: [] };
      const nfRows = [...(nfByExpense || []), ...(nfBySap || [])];
      const nfPosted = (nfRows || []).some((r: any) =>
        r.sap_invoice_draft_id || ["awaiting_invoice", "completed"].includes(String(r.status))
      );
      if (nfPosted) {
        throw new Error("NF de entrada já lançada para este pedido — atualização no ERP não permitida.");
      }
      await assertSapDocumentEditable(sap.baseUrl, sap.cookies, sapEndpoint, Number(expense.sap_doc_entry));
    }


    // 3. Build Purchase Order payload
    const today = new Date().toISOString().slice(0, 10);

    // Parse custom fields (UDFs) from credentials: header / line scope
    const headerCustom: Record<string, unknown> = {};
    const lineCustom: Record<string, unknown> = {};
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
    // Documento SAP sem AttachmentEntry não é mais uma contingência válida:
    // o pedido só pode ser criado/atualizado depois que o anexo foi integrado.
    const attachmentEntry = await ensureAttachmentEntryUploaded();

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
    attachmentLinkStatus = "pending";

    // Normalize dates to YYYY-MM-DD for SAP. Fallback to today when absent.
    // The expense stores dates as ISO strings from a date input (already YYYY-MM-DD)
    // or as timestamptz — slice(0,10) works for both without timezone drift.
    const normalizeDate = (v: unknown): string => {
      if (!v) return today;
      const s = String(v);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : today;
    };
    let docDate = normalizeDate((expense as any).doc_date);
    let dueDate = normalizeDate((expense as any).due_date ?? (expense as any).doc_date);
    const paymentGroupCode = (() => {
      const raw = (expense as any).payment_terms_code;
      if (raw === undefined || raw === null || raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    })();

    // Regra PagCorp: o vencimento é sempre a data da compra. Se o lançamento
    // acontecer fora do mês da compra (período contábil já fechado no SAP),
    // usamos o dia 01 do mês corrente para docDate/dueDate.
    const isPagCorp = String((expense as any).origin || "").toLowerCase() === "pagcorp"
      || !!(pagcorpLog as any)?.transaction;
    if (isPagCorp) {
      const currentMonth = today.slice(0, 7);
      const purchaseDate = docDate;
      if (purchaseDate.slice(0, 7) === currentMonth) {
        dueDate = purchaseDate;
      } else {
        const firstOfMonth = `${currentMonth}-01`;
        docDate = firstOfMonth;
        dueDate = firstOfMonth;
      }
    }


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
      ...(paymentGroupCode !== null ? { PaymentGroupCode: paymentGroupCode } : {}),
      BPL_IDAssignedToInvoice: branchId,
      // Observação enviada ao SAP: "{código da despesa} - {observação}",
      // limitada a 190 caracteres.
      Comments: truncateSapText(
        (() => {
          const remarks = String((expense as any).remarks || "").trim();
          const code = String(expense.id).slice(0, 8).toUpperCase();
          const text = remarks || (isSales ? "Referente aos serviços prestados" : "");
          return text ? `${code} - ${text}` : code;
        })(),
        190,
      ),


      // Campo dedicado no SAP (UDF) — quando existir na base, permite filtrar
      // pelos pedidos criados por um usuário específico sem depender do texto.
      ...(requesterCode ? { U_FGR_SOLICITANTE: truncateSapText(requesterCode, 50) } : {}),
      AttachmentEntry: attachmentEntry,
      // Moeda do documento: sem DocCurrency, o SAP assume moeda local (BRL/R$).
      // Só enviamos DocCurrency para moedas estrangeiras — algumas bases do SAP
      // rejeitam "BRL" como código válido quando a moeda local está cadastrada
      // como "R$" ("Enter valid currency code [OPOR.DocCur], 'BRL'").
      ...((): Record<string, unknown> => {
        const cur = String((expense as any).currency || "").toUpperCase().trim();
        if (!/^[A-Z]{3}$/.test(cur)) return {};
        if (cur === "BRL" || cur === "R$") return {};
        return { DocCurrency: cur };
      })(),
      // ANA Gaming: por padrão, todos os pedidos de compra são marcados como
      // "sem contrato" (U_FGR_CONTRATO = "N"). Pode ser sobrescrito por
      // headerCustom quando o usuário/regra informar explicitamente.
      ...(/ANAGAMING/i.test(String(expense.company_db || "")) ? { U_FGR_CONTRATO: "N" } : {}),
      // Nunca herdar desconto do cadastro do parceiro no cabeçalho.
      DiscountPercent: 0,
      ...headerCustom,

      DocumentLines: items.map((it: any) => {
        // Vendas (localização Brasil): campo "Utilização" obrigatório por linha.
        const usageCode = Number((expense as any).sales_usage);
        const usageLine =
          isSales && Number.isFinite(usageCode) && usageCode > 0 ? { Usage: usageCode } : {};
        const hasItem = !!it.item_code;
        const qty = it.quantity;
        const unit = it.unit_price;
        const invoiceDesc = truncateSapText(it.description, 100);
        const lineCurrency = String((expense as any).currency || "").toUpperCase().trim();
        const line: Record<string, unknown> = {
          ...lineCustom,
          Quantity: qty,
          UnitPrice: unit,
          // Zera qualquer desconto herdado do cadastro do parceiro/lista de preços.
          // Sem isso o SAP aplica o "% de desconto" padrão do BP e o total do
          // pedido fica divergente do valor aprovado no ERP Flow.
          DiscountPercent: 0,
          ...(/^[A-Z]{3}$/.test(lineCurrency) && lineCurrency !== "BRL" && lineCurrency !== "R$" ? { Currency: lineCurrency } : {}),
          ...usageLine,
        };

        if (hasItem) {
          // Mantém a descrição do item vinda do SAP (não sobrescreve com a da NF).
          // A descrição vinda da NF vai para o campo "Texto Livre" (FreeText).
          line.ItemCode = it.item_code;
          // Quando a linha não tinha descrição, o fallback é o próprio código do
          // item — nesse caso não enviamos FreeText e o SAP usa o nome do item.
          if (invoiceDesc && invoiceDesc !== it.item_code) line.FreeText = invoiceDesc;

        } else {
          // Linha de serviço: sem ItemCode, a descrição é o próprio texto do item.
          line.LineType = "dDocument_Service";
          line.ItemDescription = truncateSapText(it.description, 100);
          if (invoiceDesc) line.FreeText = invoiceDesc;
        }
        // Centro de custo: linha > cabeçalho. Em pedidos de venda o CC é
        // opcional na tela, mas o SAP exige a dimensão — usa 1.1.1.1 como
        // fallback para não travar a integração.
        const salesCcFallback = isSales ? "1.1.1.1" : "";
        const resolvedCc = String(it.cost_center || expense.cost_center || salesCcFallback).trim();
        if (resolvedCc) line.CostingCode = resolvedCc;
        // Open Gaming: se o projeto não vier preenchido na linha nem no cabeçalho,
        // aplica fallback fixo "OPEN GAMING" (política interna da empresa).
        const projectFallback = expense.company_db === "open_gaming_sa" ? "OPEN GAMING" : "";
        // Empresas sem cadastro de projetos no SAP: integrar sempre com ProjectCode = null.
        const companiesWithoutProjects = new Set(["cactus_providers"]);
        const resolvedProject = companiesWithoutProjects.has(expense.company_db)
          ? ""
          : String(it.project || expense.project || projectFallback).trim();
        if (resolvedProject) line.ProjectCode = resolvedProject;
        for (const k of Object.keys(line)) if (line[k] === undefined) delete line[k];
        return line;
      }),
    };

    // Consistência de tipo do documento: o SAP recusa linhas de serviço (sem
    // ItemCode) em um pedido de itens ("Item number is missing [line: N]").
    // - Todas as linhas sem item  -> documento de serviço (DocType).
    // - Mistura de itens e serviços -> falha explícita antes de postar, com a
    //   indicação da linha, em vez de um 400 genérico repetido no retry.
    {
      const docLines = (sapPayload as any).DocumentLines as Array<Record<string, unknown>>;
      const withItem = docLines.filter((l) => !!l.ItemCode);
      const withoutItem = docLines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => !l.ItemCode);
      if (withItem.length && withoutItem.length) {
        const linhas = withoutItem.map(({ i }) => i + 1).join(", ");
        throw new Error(
          `Documento com linhas mistas: as linhas ${linhas} estão sem código de item enquanto outras têm item. ` +
            `Preencha o código do item nessas linhas (ou remova o item das demais) antes de integrar ao ERP.`,
        );
      }
      if (!withItem.length && docLines.length) {
        (sapPayload as any).DocType = "dDocument_Service";
      }
    }

    lastSapPayload = sapPayload;


    // 4. Cria (POST) ou atualiza (PATCH) o documento no SAP.
    // No patch, campos imutáveis do cabeçalho (filial, data de lançamento e
    // moeda) são preservados; todo o resto — inclusive a coleção completa de
    // linhas com LineNum — é reenviado para espelhar o documento aprovado.
    const patchDocEntry = isPatchMode ? Number(expense.sap_doc_entry) : 0;
    const sendDocument = async (): Promise<{ docEntry: number; docNum: number; response: any }> => {
      if (!isPatchMode) {
        return await postSapDocument(sap.baseUrl, sap.cookies, sapPayload, sapEndpoint);
      }
      const patchPayload: Record<string, unknown> = { ...sapPayload };
      delete patchPayload.BPL_IDAssignedToInvoice;
      delete patchPayload.DocDate;
      // TaxDate = data de lançamento contábil. Reenviá-la em um PATCH faz o
      // add-on FGR recusar com "PERÍODO BLOQUEADO" quando o mês do documento
      // já foi fechado — a data original permanece no SAP de qualquer forma.
      delete patchPayload.TaxDate;
      delete patchPayload.DocCurrency;

      patchPayload.DocumentLines = ((sapPayload as any).DocumentLines as Array<Record<string, unknown>>)
        .map((l, i) => ({ LineNum: i, ...l }));
      lastSapPayload = patchPayload;
      const resp = await patchSapDocument(sap.baseUrl, sap.cookies, sapEndpoint, patchDocEntry, patchPayload);
      await verifySapDocumentLines(
        sap.baseUrl,
        sap.cookies,
        sapEndpoint,
        patchDocEntry,
        patchPayload.DocumentLines as Array<Record<string, unknown>>,
      );
      return {
        docEntry: patchDocEntry,
        docNum: Number(resp?.DocNum) || Number(expense.sap_doc_num) || 0,
        response: resp,
      };
    };

    let sapResult;
    try {
      try {
        sapResult = await sendDocument();
      } catch (e1) {
        const msg1 = e1 instanceof Error ? e1.message : String(e1);
        // Fallback de período contábil: o SAP recusa datas fora do intervalo
        // permitido ("Specify a date within the permissible range", -5002).
        // Nesse caso reintegramos com a data de hoje em TaxDate/DocDueDate.
        const outOfDateRange = /permissible range|-5002|intervalo permitido/i.test(msg1);
        if (outOfDateRange && !isPatchMode) {
          (sapPayload as any).DocDate = today;
          (sapPayload as any).TaxDate = today;
          const currentDue = String((sapPayload as any).DocDueDate || today);
          if (currentDue < today) (sapPayload as any).DocDueDate = today;
          lastSapPayload = sapPayload;
          console.log("[expense-to-sap] Retrying with today's dates due to date range error:", msg1.slice(0, 200));
          sapResult = await sendDocument();
        } else {

        // Fallback: SAP FGR validation "EXISTEM LINHAS MARCA/BRAND (PROJETO)"
        // (SBO_ANAGAMING requires every line to have ProjectCode). Retry once
        // forcing ProjectCode = "ANA GAMING" on lines that don't have one.
        const needsProjectFallback = /MARCA\/BRAND|\(PROJETO\)|-1116/i.test(msg1);
        // Project "X does not exist" error → strip ProjectCode from all lines (company has no projects registered).
        const projectDoesNotExist = /Project .* does not exist|540000156/i.test(msg1);
        if (!needsProjectFallback && !projectDoesNotExist) throw e1;

        const lines = (sapPayload as any).DocumentLines as Array<Record<string, unknown>>;
        // Companies without a project registry (e.g. cactus_providers) must integrate with ProjectCode = null.
        const companiesWithoutProjects = new Set(["cactus_providers"]);
        const stripProjects = projectDoesNotExist || companiesWithoutProjects.has(expense.company_db);
        if (stripProjects) {
          for (const line of lines) delete line.ProjectCode;
          if ((sapPayload as any).ProjectCode) delete (sapPayload as any).ProjectCode;
          console.log("[expense-to-sap] Retrying PO with ProjectCode stripped due to:", msg1.slice(0, 200));
        } else {
          for (const line of lines) {
            if (!line.ProjectCode) line.ProjectCode = "ANA GAMING";
          }
          console.log("[expense-to-sap] Retrying PO with ProjectCode=ANA GAMING fallback due to:", msg1.slice(0, 200));
        }
        lastSapPayload = sapPayload;
        sapResult = await sendDocument();
        }
      }

      lastSapResponse = sapResult.response;
      purchaseOrderStatus = "success";
      await ensureSapDocumentAttachmentLinked(sap.baseUrl, sap.cookies, sapEndpoint, sapResult.docEntry, attachmentEntry);
      attachmentLinkStatus = "success";
    } catch (e) {
      purchaseOrderStatus = "failed";
      // If the PO failed, the attachment was uploaded but never linked to a
      // document — surface that explicitly instead of leaving the stage as
      // "pending" forever.
      attachmentLinkStatus = "failed";
      const msg = e instanceof Error ? e.message : String(e);
      await persistStatus({
        sap_integration_error: `${isPatchMode ? "Falha ao atualizar o documento no ERP" : "Falha ao criar Pedido de Compra"}: ${msg}`,
      });
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
      p_action: isPatchMode ? "sap_document_updated" : "sap_document_created",
      p_entity_type: "expense",
      p_entity_id: expenseId,
      p_company_db: expense.company_db || null,
      p_details: {
        sap_endpoint: sapEndpoint,
        sap_doc_entry: sapResult.docEntry,
        sap_doc_num: sapResult.docNum,
        sap_attachment_entry: attachmentEntry,
        patched: isPatchMode,

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
    // Enqueue for automatic retry when the error is classified as transient.
    try {
      if (supabase && expenseId) {
        if (expenseErpType !== "omie") {
          const { classifyAndEnqueue } = await import("../_shared/sap-retry.ts");
          await classifyAndEnqueue(supabase, {
            doc_type: "expense",
            ref_id: expenseId,
            company_db: expenseSnapshot?.company_db ?? null,
            errorBody: msg,
          });
        }
      }
    } catch (retryErr) {
      console.warn("expense-to-sap enqueueRetry failed:", (retryErr as Error).message);
    }
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
}));
