// Edge function: integrate a PagCorp transaction directly into SAP B1.
// Creates Purchase Order + AP Invoice + Outgoing Payment in sequence,
// without going through the internal expense/approval flow.
// Endpoint: POST /functions/v1/pagcorp-to-sap
// Body: {
//   transaction: PagCorpTransaction (raw object with id, description, amount, currency, date, accountAlias, accountCode, receipts...),
//   companyDb: string,
//   integrationType: "generic" | "accountability",
//   supplierCode: string,
//   supplierName?: string,
//   integratedBy?: string,
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { ensureCopyToTargetDocument } from "../_shared/sap-attach-copy.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";
import { sanitizeSapFileName } from "../_shared/sap-filename.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Fire-and-forget notification about ERP integration attempts (PagCorp path).
async function notifyErpIntegration(params: {
  status: "success" | "error";
  entityIds: (string | number)[];
  companyDb?: string | null;
  docEntry?: number | null;
  docNum?: number | null;
  errorMessage?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  totalAmount?: number | null;
  currency?: string | null;
  integratedBy?: string | null;
}): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const ok = params.status === "success";
    const subject = ok
      ? `[ERP] Integração PagCorp OK — ${params.companyDb || ""} · Doc ${params.docNum ?? params.docEntry ?? ""}`
      : `[ERP] Falha integração PagCorp — ${params.companyDb || ""} · tx ${params.entityIds.join(",")}`;
    const rows: [string, string][] = [
      ["Origem", "pagcorp"],
      ["Empresa (DB)", params.companyDb || "-"],
      ["Transações", params.entityIds.join(", ")],
      ["Integrado por", params.integratedBy || "-"],
      ["Fornecedor", `${params.supplierCode || "-"} ${params.supplierName || ""}`],
      ["Valor", params.totalAmount != null ? `${params.currency || "BRL"} ${Number(params.totalAmount).toFixed(2)}` : "-"],
      ["SAP DocEntry", params.docEntry != null ? String(params.docEntry) : "-"],
      ["SAP DocNum", params.docNum != null ? String(params.docNum) : "-"],
      ["Status", ok ? "SUCESSO" : "ERRO"],
      ["Erro", params.errorMessage || "-"],
    ];
    const html = `<h2>${ok ? "Integração PagCorp → SAP concluída" : "Falha na integração PagCorp → SAP"}</h2>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
${rows.map(([k, v]) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;background:#f8f8f8"><b>${k}</b></td><td style="padding:4px 8px;border:1px solid #ddd">${String(v).replace(/</g, "&lt;")}</td></tr>`).join("")}
</table>`;
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

interface SapSession {
  baseUrl: string;
  cookies: string;
}

async function getSapCredentials(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Erro credenciais SAP: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`Credenciais SAP não configuradas para ${companyDb}`);
  const creds: Record<string, string> = {};
  for (const row of data) creds[row.credential_key] = row.credential_value;
  return creds;
}

async function loginSap(sapCreds: Record<string, string>): Promise<SapSession> {
  let baseUrl = (sapCreds.service_layer_url || sapCreds.base_url || sapCreds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;

  const loginResp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: sapCreds.company_db || sapCreds.CompanyDB,
      UserName: sapCreds.username || sapCreds.UserName,
      Password: sapCreds.password || sapCreds.Password,
    }),
  });
  if (!loginResp.ok) {
    const body = await loginResp.text().catch(() => "");
    throw new Error(`SAP Login falhou (HTTP ${loginResp.status}): ${body.slice(0, 200)}`);
  }
  return { baseUrl, cookies: loginResp.headers.get("set-cookie") || "" };
}

async function postSapDocument(
  sap: SapSession,
  payload: Record<string, unknown>,
  endpoint: string,
): Promise<{ docEntry: number; docNum: number; response: any }> {
  const res = await fetch(`${sap.baseUrl}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sap.cookies },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`SAP ${endpoint} falhou [${res.status}]: ${msg}`);
  }
  return { docEntry: body.DocEntry, docNum: body.DocNum, response: body };
}

/**
 * Valida no SAP se os itens usados nas linhas estão ativos (Valid/Frozen).
 * Sem isso, o Service Layer devolve apenas "Item X is inactive" [400], sem
 * dizer qual transação/mapeamento precisa ser corrigido.
 */
async function assertItemsActive(sap: SapSession, itemCodes: string[]): Promise<void> {
  const codes = Array.from(new Set(itemCodes.filter(Boolean)));
  if (codes.length === 0) return;
  const filter = codes.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
  const url = `${sap.baseUrl}/Items?$select=ItemCode,ItemName,Valid,Frozen&$filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, { headers: { Cookie: sap.cookies } });
  if (!res.ok) return; // não bloqueia a integração se a checagem falhar
  const body = await res.json().catch(() => null);
  const rows: any[] = Array.isArray(body?.value) ? body.value : [];
  const problems: string[] = [];
  for (const code of codes) {
    const row = rows.find((r) => String(r.ItemCode) === code);
    if (!row) { problems.push(`${code} (não existe nesta base)`); continue; }
    if (row.Valid === "tNO") problems.push(`${code} — ${row.ItemName || ""} (inativo)`);
    else if (row.Frozen === "tYES") problems.push(`${code} — ${row.ItemName || ""} (bloqueado)`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Item indisponível no SAP: ${problems.join("; ")}. Escolha outro item no diálogo de integração ou atualize o Mapeamento PagCorp.`,
    );
  }
}


async function uploadAttachmentsToSap(
  sap: SapSession,
  files: { name: string; blob: Blob }[],
): Promise<number | null> {
  if (files.length === 0) return null;
  const form = new FormData();
  for (const f of files) form.append("files", f.blob, sanitizeSapFileName(f.name));
  const res = await fetch(`${sap.baseUrl}/Attachments2`, {
    method: "POST",
    headers: { Cookie: sap.cookies },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message?.value || JSON.stringify(body);
    throw new Error(`SAP Attachments2 falhou [${res.status}]: ${msg}`);
  }
  const absoluteEntry: number | null = body.AbsoluteEntry ?? null;
  await ensureCopyToTargetDocument(sap.baseUrl, sap.cookies, absoluteEntry, body, files.length);
  return absoluteEntry;
}

function collectReceiptUrls(receipts: any[]): { url: string; name?: string }[] {
  const out: { url: string; name?: string }[] = [];
  const seen = new Set<string>();
  const push = (url: unknown, name?: unknown) => {
    if (typeof url !== "string" || !url) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, name: typeof name === "string" ? name : undefined });
  };
  for (const r of receipts || []) {
    if (!r) continue;
    if (Array.isArray(r.files)) {
      for (const f of r.files) {
        if (typeof f === "string") push(f);
        else if (f && typeof f === "object") push(f.url || f.fileUrl || f.link, f.fileName || f.name);
      }
    }
    push(r.url || r.fileUrl || r.link || r.downloadUrl || r.receiptUrl || r.imageUrl || r?.file?.url, r.fileName || r.name);
  }
  return out;
}

function extFromContentType(ct: string | null): string {
  const c = (ct || "").toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/zip": "zip",
    "text/plain": "txt",
  };
  return map[c] || "";
}

function extFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-zA-Z0-9]{2,5})$/);
    return m ? m[1].toLowerCase() : "";
  } catch {
    const m = url.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
    return m ? m[1].toLowerCase() : "";
  }
}

function ensureFilenameWithExt(rawName: string | undefined, fallbackIndex: number, url: string, contentType: string | null): string {
  const base = (rawName || `recibo_${fallbackIndex}`).trim().replace(/[\r\n\t]/g, "").replace(/[\\/]+/g, "_");
  const hasExt = /\.[a-zA-Z0-9]{2,5}$/.test(base);
  if (hasExt) return base;
  const ext = extFromUrl(url) || extFromContentType(contentType) || "pdf";
  return `${base}.${ext}`;
}

async function downloadReceipts(receipts: any[]): Promise<{ name: string; blob: Blob }[]> {
  const files: { name: string; blob: Blob }[] = [];
  const sources = collectReceiptUrls(receipts);
  for (const src of sources) {
    try {
      const res = await fetch(src.url);
      if (!res.ok) {
        console.warn(`Falha ao baixar recibo ${src.url}: HTTP ${res.status}`);
        continue;
      }
      const blob = await res.blob();
      const name = ensureFilenameWithExt(src.name, files.length + 1, src.url, res.headers.get("content-type"));
      files.push({ name, blob });
    } catch (e) {
      console.warn(`Erro baixando recibo ${src.url}:`, e);
    }
  }
  return files;
}

interface AccountMapping {
  account_code: string;
  account_name: string | null;
  cost_center: string | null;
  project: string | null;
}

function truncateSapText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

async function resolveAccountMapping(
  supabase: ReturnType<typeof createClient>,
  accountCode: string | null,
): Promise<AccountMapping | null> {
  if (!accountCode) return null;
  const { data } = await supabase
    .from("pagcorp_account_mapping")
    .select("account_code, account_name, cost_center, project")
    .eq("account_code", accountCode)
    .maybeSingle();
  return (data as AccountMapping) || null;
}

async function resolveItemCode(
  supabase: ReturnType<typeof createClient>,
  accountCode: string | null,
): Promise<string | null> {
  // Try specific account_code mapping first
  if (accountCode) {
    const { data } = await supabase
      .from("pagcorp_item_mapping")
      .select("item_code")
      .eq("account_code", accountCode)
      .eq("is_fallback", false)
      .maybeSingle();
    if (data?.item_code) return data.item_code as string;
  }
  // Fallback
  const { data: fb } = await supabase
    .from("pagcorp_item_mapping")
    .select("item_code")
    .eq("is_fallback", true)
    .maybeSingle();
  return (fb?.item_code as string) || null;
}

interface CardMapping {
  cost_center: string | null;
  project: string | null;
  item_code: string | null;
}

/** Same resolution as the client uses to identify cards. */
function resolveCardKey(tx: { cardLastDigits?: unknown; cardId?: unknown; cardName?: unknown }): string | null {
  const last = tx.cardLastDigits ? String(tx.cardLastDigits).trim() : "";
  if (last) return last;
  const cardId = tx.cardId ? String(tx.cardId).trim() : "";
  if (cardId) return cardId;
  const name = tx.cardName ? String(tx.cardName).trim() : "";
  return name || null;
}

async function resolveCardMapping(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
  cardKey: string | null,
): Promise<CardMapping | null> {
  if (cardKey) {
    const { data } = await supabase
      .from("pagcorp_card_mapping")
      .select("cost_center, project, item_code")
      .eq("company_db", companyDb)
      .eq("card_identifier", cardKey)
      .eq("is_fallback", false)
      .maybeSingle();
    if (data) return data as CardMapping;
  }
  // Per-company fallback (e.g. ANA Gaming default project)
  const { data: fb } = await supabase
    .from("pagcorp_card_mapping")
    .select("cost_center, project, item_code")
    .eq("company_db", companyDb)
    .eq("is_fallback", true)
    .maybeSingle();
  return (fb as CardMapping) || null;
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  { const _pause = await getIntegrationPause("sap_b1"); if (_pause) return pauseResponse(_pause, corsHeaders); }

  let logId: string | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;

  // Stage tracking for the response payload + log
  const stages: Record<string, "pending" | "success" | "failed" | "skipped"> = {
    attachment_upload: "skipped",
    purchase_order: "pending",
  };
  let sapPayloads: Record<string, unknown> = {};
  let sapResponses: Record<string, unknown> = {};

  // For consolidated mode we need to update multiple log rows on error
  const consolidatedLogIds: string[] = [];

  // Snapshot for the ERP notification email (populated as we parse body/txs).
  const snapshot: {
    companyDb?: string;
    supplierCode?: string;
    supplierName?: string;
    integratedBy?: string | null;
    txIds: (string | number)[];
    totalAmount?: number;
    currency?: string;
  } = { txIds: [] };

  try {
    const body = await req.json();
    const companyDb: string = body.companyDb;
    const integrationType: "generic" | "accountability" = body.integrationType || "generic";
    const supplierCode: string = body.supplierCode;
    const supplierName: string | undefined = body.supplierName;
    const integratedBy: string | null = body.integratedBy || null;
    const nondeductible: boolean = body.nondeductible === true;
    // Data do documento informada pelo usuário (ex.: emissão da NF do Google
    // Cloud, que fatura no mês seguinte às compras). Só é aceita no formato
    // ISO e dentro de uma janela de ±1 ano para evitar o erro do SAP
    // "Specify a date within the permissible range".
    const documentDate: string | null = (() => {
      const raw = typeof body.documentDate === "string" ? body.documentDate.slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
      const d = new Date(`${raw}T00:00:00Z`).getTime();
      if (isNaN(d)) return null;
      const now = Date.now();
      const year = 365 * 24 * 60 * 60 * 1000;
      if (d < now - year || d > now + year) return null;
      return raw;
    })();
    // Optional per-line overrides from integrate modal: { [txId]: { costCenter?, project? } }
    const lineOverrides: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }> =
      body.lineOverrides && typeof body.lineOverrides === "object" ? body.lineOverrides : {};

    // Accept either single `transaction` or `transactions[]` for consolidated mode
    const rawList: any[] = Array.isArray(body.transactions)
      ? body.transactions
      : body.transaction
        ? [body.transaction]
        : [];
    const isConsolidated = Array.isArray(body.transactions) && body.transactions.length > 1;

    if (rawList.length === 0) throw new Error("transaction(s) inválido(s)");
    if (!companyDb) throw new Error("companyDb obrigatório");
    if (!supplierCode) throw new Error("supplierCode (CardCode) obrigatório");
    for (const t of rawList) {
      if (!t?.id) throw new Error("toda transação precisa de id");
    }


    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 0a. Drop transactions with amount <= 0 (defensive: estornos / créditos
    // não devem virar linha de PC). Se sobrar nenhuma, retorna sucesso vazio.
    const beforeFilter = rawList.length;
    const positiveList = rawList.filter((t) => Number(t.amount) > 0);
    if (positiveList.length < beforeFilter) {
      console.warn(`pagcorp-to-sap: descartadas ${beforeFilter - positiveList.length} transações com valor <= 0`);
    }
    if (positiveList.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Nenhuma transação com valor positivo para integrar (todas com valor <= 0 foram descartadas).",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 0b. Idempotency: filter out already-integrated transactions
    const ids = positiveList.map((t) => Number(t.id));
    const { data: existingLogs } = await supabase
      .from("pagcorp_integration_log")
      .select("id, pagcorp_expense_id, status, sap_doc_entry, sap_doc_num")
      .in("pagcorp_expense_id", ids)
      .eq("status", "success");
    const alreadyIntegratedIds = new Set((existingLogs || []).map((r: any) => r.pagcorp_expense_id));
    const transactions = positiveList.filter((t) => !alreadyIntegratedIds.has(Number(t.id)));

    snapshot.companyDb = companyDb;
    snapshot.supplierCode = supplierCode;
    snapshot.supplierName = supplierName;
    snapshot.integratedBy = integratedBy;
    snapshot.txIds = transactions.map((t) => t.id);
    snapshot.totalAmount = transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    snapshot.currency = String(transactions[0]?.currency || "").toUpperCase() || "BRL";

    if (transactions.length === 0) {
      const first = (existingLogs || [])[0] as any;
      return new Response(
        JSON.stringify({
          success: true,
          alreadyIntegrated: true,
          docEntry: first?.sap_doc_entry,
          docNum: first?.sap_doc_num,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Insert pending log row(s) early so we have logId(s) for any failure path
    for (const transaction of transactions) {
      const initialLog = await supabase
        .from("pagcorp_integration_log")
        .insert({
          pagcorp_expense_id: Number(transaction.id),
          pagcorp_data: {
            description: transaction.description,
            amount: transaction.amount,
            currency: transaction.currency,
            date: transaction.date,
            accountAlias: transaction.accountAlias,
            accountCode: transaction.accountCode,
            accountName: transaction.accountName,
            cardId: transaction.cardId,
            cardName: transaction.cardName,
            cardLastDigits: transaction.cardLastDigits,
            eventClassification: (transaction as any).eventClassification || null,
            hasAccountability: transaction.hasAccountability,
            accountabilityApproved: transaction.accountabilityApproved,
            receipts: transaction.receipts,
            consolidated: isConsolidated,
            consolidatedWith: isConsolidated ? transactions.map((x) => x.id) : undefined,
            nondeductible,
          } as any,
          integration_type: integrationType,
          status: "pending",
          company_db: companyDb,
          integrated_by: integratedBy,
        } as any)
        .select("id")
        .single();
      if (initialLog.error) throw new Error(`Falha ao criar log: ${initialLog.error.message}`);
      consolidatedLogIds.push((initialLog.data as any).id);
    }
    logId = consolidatedLogIds[0];

    // Use first transaction as the "header reference"
    const transaction = transactions[0];

    // 2. SAP login
    const sapCreds = await getSapCredentials(supabase, companyDb);
    const sap = await loginSap(sapCreds);

    // 3. Resolve mappings (per transaction so each line can have its own cost center/item)
    const lineMappings = await Promise.all(
      transactions.map(async (t) => {
        const acctMapping = await resolveAccountMapping(supabase!, t.accountCode || null);
        const cardMapping = await resolveCardMapping(
          supabase!,
          companyDb,
          resolveCardKey(t),
        );
        const itemCode =
          cardMapping?.item_code || (await resolveItemCode(supabase!, t.accountCode || null));
        return { tx: t, acctMapping, cardMapping, itemCode };
      }),
    );
    const missing = lineMappings.find((m) => {
      const ov = lineOverrides[String(m.tx.id)] || {};
      return !ov.item && !m.itemCode;
    });
    if (missing) {
      throw new Error(
        `Nenhum item mapeado para a conta "${missing.tx.accountCode || "(sem conta)"}" (cadastre item fallback em Mapeamento PagCorp ou escolha um Item no diálogo)`,
      );
    }

    // (Pagamento desabilitado: integração agora cria apenas o Pedido de Compra)

    const configuredBranch = Number(sapCreds.default_branch_id || "");
    const branchId = Number.isFinite(configuredBranch) && configuredBranch > 0 ? configuredBranch : 1;

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

    // 4. Upload attachments — sempre que houver receipts em qualquer transação,
    // independente do integrationType. 0 receipts = integra sem anexo.
    let attachmentEntry: number | null = null;
    {
      const allReceipts = transactions.flatMap((t) =>
        Array.isArray(t.receipts) ? t.receipts : [],
      );
      if (allReceipts.length > 0) {
        stages.attachment_upload = "pending";
        try {
          const files = await downloadReceipts(allReceipts);
          if (files.length > 0) {
            attachmentEntry = await uploadAttachmentsToSap(sap, files);
            stages.attachment_upload = attachmentEntry ? "success" : "failed";
          } else {
            stages.attachment_upload = "skipped";
          }
        } catch (e) {
          stages.attachment_upload = "failed";
          throw new Error(`Anexos: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // 5. Build common document payload using first transaction as header reference
    const txDate = transaction.date
      ? new Date(transaction.date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const holderName = (
      (transaction.cardName as string | undefined) ||
      (transaction.accountAlias as string | undefined) ||
      (transaction.accountName as string | undefined) ||
      ""
    ).toString().trim();
    // Descrição da PRESTAÇÃO DE CONTAS (quando existe). A API do PagCorp
    // devolve esse texto em nomes diferentes conforme o tipo de despesa
    // (campo do expense ou do recibo), então procuramos por todos os
    // candidatos conhecidos e usamos o primeiro texto não vazio.
    const pickAccountabilityText = (tx: Record<string, unknown>): string => {
      const candidates: unknown[] = [
        tx.accountabilityDescription,
        tx.accountabilityObservation,
        tx.accountabilityJustification,
        tx.expenseAccountabilityDescription,
        tx.receiptDescription,
        tx.justification,
        tx.observation,
        tx.observations,
        tx.note,
        tx.notes,
        tx.comments,
      ];
      const receipts = Array.isArray(tx.receipts) ? (tx.receipts as Record<string, unknown>[]) : [];
      for (const r of receipts) {
        candidates.push(
          r?.description,
          r?.observation,
          r?.observations,
          r?.justification,
          r?.note,
          r?.notes,
          r?.comments,
          r?.receiptDescription,
        );
      }
      for (const c of candidates) {
        const s = typeof c === "string" ? c.trim() : "";
        if (s) return s;
      }
      return "";
    };

    const accountabilityTexts = transactions
      .map((t) => {
        const text = pickAccountabilityText(t as Record<string, unknown>);
        if (!text) return "";
        return isConsolidated ? `[#${t.id}] ${text}` : text;
      })
      .filter((s) => !!s);
    const accountabilitySuffix = accountabilityTexts.length > 0 ? ` | PC: ${accountabilityTexts.join(" ; ")}` : "";

    const description = truncateSapText(
      (isConsolidated
        ? `PagCorp${holderName ? ` ${holderName}` : ""} — consolidado ${transactions.length} transações`
        : `PagCorp${holderName ? ` ${holderName}` : ""} — ${transaction.description || ""}`) +
        accountabilitySuffix,
      190,
    );


    const toIsoDate = (v: unknown): string | null => {
      if (!v) return null;
      const s = String(v);
      // DD/MM/YYYY
      const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (br) return `${br[3]}-${br[2]}-${br[1]}`;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };

    const documentLines = lineMappings.map(({ tx, acctMapping, cardMapping, itemCode }) => {
      const override = lineOverrides[String(tx.id)] || {};
      // Priority: per-line override > card mapping > account mapping
      const finalCostCenter =
        override.costCenter ?? cardMapping?.cost_center ?? acctMapping?.cost_center ?? null;
      const projectFallback = companyDb === "open_gaming_sa" ? "OPEN GAMING" : null;
      const finalProject =
        override.project ?? cardMapping?.project ?? acctMapping?.project ?? projectFallback;
      const finalItem = override.item || itemCode!;
      const lineCurrency = String(tx.currency || "").toUpperCase();
      // Mantém a descrição do item cadastrada no SAP (ItemDescription não é
      // sobrescrita). A descrição vinda da nota do PagCorp vai para o campo
      // de texto livre da linha (FreeText), preservando a rastreabilidade
      // sem alterar o nome do item.
      const lineFreeText = (
        isConsolidated
          ? `[#${tx.id}] ${tx.description || "PagCorp"}`
          : (tx.description || "PagCorp")
      ).slice(0, 100);
      // Data da transação vira Data de Entrega da linha (ShipDate). Assim,
      // cada linha do PC consolidado carrega a data real da despesa.
      const lineTxDate = toIsoDate((tx as Record<string, unknown>).date) || txDate;
      const line: Record<string, unknown> = {
        ItemCode: finalItem,
        FreeText: lineFreeText,
        Quantity: 1,
        UnitPrice: Number(tx.amount) || 0,
        ShipDate: lineTxDate,
        ...lineCustom,
      };
      // Só envia Currency para moedas estrangeiras. BRL é a moeda local
      // no SAP (código pode ser "R$"), enviar "BRL" resulta em -5002.
      if (lineCurrency && lineCurrency !== "BRL" && /^[A-Z]{3}$/.test(lineCurrency)) {
        line.Currency = lineCurrency;
      }
      if (finalCostCenter) line.CostingCode = finalCostCenter;
      if (finalProject) line.ProjectCode = finalProject;
      return line;
    });

    // Currency from the (already detected) transaction. Without DocCurrency,
    // SAP assumes local currency (BRL) even when the PagCorp expense is in USD.
    const headerCurrency = String(transaction.currency || "").toUpperCase();

    // DocDueDate (Data de Entrega do cabeçalho): data da ÚLTIMA transação
    // integrada em lote (mais recente); em integração unitária = data da
    // própria transação. Isso reflete o "vencimento" do bordero para o
    // time financeiro em vez de usar `today`.
    const txDates = transactions
      .map((t) => toIsoDate((t as Record<string, unknown>).date))
      .filter((d): d is string => !!d)
      .sort();
    const lastTxDate = txDates.length > 0 ? txDates[txDates.length - 1] : txDate;

    // Quando o usuário informa a data de emissão da nota (caso Google Cloud:
    // compras de meses distintos faturadas em uma única NF), ela vira a data
    // do documento e do imposto. O VENCIMENTO, porém, é SEMPRE a data da
    // transação no cartão (a última, em consolidações).
    const headerDocDate = documentDate || txDate;
    const headerDueDate = lastTxDate || documentDate || txDate;

    const baseDoc: Record<string, unknown> = {
      CardCode: supplierCode,
      DocDate: headerDocDate,
      DocDueDate: headerDueDate,
      TaxDate: headerDocDate,
      BPL_IDAssignedToInvoice: branchId,
      Comments: description,
      DocumentLines: documentLines,
      // ANA Gaming: por padrão, todos os pedidos de compra são marcados como
      // "sem contrato" (U_FGR_CONTRATO = "N"). headerCustom pode sobrescrever.
      ...(/ANAGAMING/i.test(String(companyDb || "")) ? { U_FGR_CONTRATO: "N" } : {}),
      ...headerCustom,
    };
    // Só envia DocCurrency para moedas estrangeiras. Para BRL (local), deixa
    // o SAP assumir a moeda local — enviar "BRL" causa erro -5002 quando o
    // código da moeda local no SAP é diferente (ex.: "R$").
    if (headerCurrency && headerCurrency !== "BRL" && /^[A-Z]{3}$/.test(headerCurrency)) {
      baseDoc.DocCurrency = headerCurrency;
    }

    // 6. Create Purchase Order
    sapPayloads.purchase_order = { ...baseDoc, ...(attachmentEntry ? { AttachmentEntry: attachmentEntry } : {}) };
    let poResult;
    try {
      poResult = await postSapDocument(sap, sapPayloads.purchase_order as any, "PurchaseOrders");
      stages.purchase_order = "success";
      sapResponses.purchase_order = { DocEntry: poResult.docEntry, DocNum: poResult.docNum };
    } catch (e) {
      stages.purchase_order = "failed";
      throw e;
    }

    // 7. Persist final success log for every transaction in the consolidation
    await supabase
      .from("pagcorp_integration_log")
      .update({
        status: "success",
        sap_doc_entry: poResult.docEntry,
        sap_doc_num: poResult.docNum,
        sap_payload: sapPayloads as any,
        sap_response: { ...sapResponses, supplierCode, supplierName, stages, attachmentEntry, consolidated: isConsolidated, consolidatedCount: transactions.length, nondeductible } as any,
      } as any)
      .in("id", consolidatedLogIds);

    // Audit
    await supabase.rpc("insert_audit_log", {
      p_action: isConsolidated ? "pagcorp_integrated_consolidated" : "pagcorp_integrated",
      p_entity_type: "pagcorp_transaction",
      p_entity_id: transactions.map((t) => String(t.id)).join(","),
      p_company_db: companyDb,
      p_actor_email: integratedBy || undefined,
      p_details: {
        integration_type: integrationType,
        purchase_order: poResult,
        stages,
        consolidated_ids: transactions.map((t) => t.id),
      } as any,
    });

    await notifyErpIntegration({
      status: "success",
      entityIds: snapshot.txIds,
      companyDb: snapshot.companyDb,
      docEntry: poResult.docEntry,
      docNum: poResult.docNum,
      supplierCode: snapshot.supplierCode,
      supplierName: snapshot.supplierName,
      totalAmount: snapshot.totalAmount,
      currency: snapshot.currency,
      integratedBy: snapshot.integratedBy,
    });

    return new Response(
      JSON.stringify({
        success: true,
        stages,
        purchaseOrder: { DocEntry: poResult.docEntry, DocNum: poResult.docNum },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("pagcorp-to-sap error:", msg);
    if (supabase && consolidatedLogIds.length > 0) {
      await supabase
        .from("pagcorp_integration_log")
        .update({
          status: "error",
          error_message: msg,
          sap_payload: sapPayloads as any,
          sap_response: { stages, ...sapResponses } as any,
        } as any)
        .in("id", consolidatedLogIds);
    }
    // Enqueue for automatic retry (transient errors only).
    try {
      if (supabase && snapshot.txIds.length > 0) {
        const originalBody = await req.clone().json().catch(() => ({}));
        const { classifyAndEnqueue } = await import("../_shared/sap-retry.ts");
        await classifyAndEnqueue(supabase, {
          doc_type: "pagcorp",
          ref_id: String(snapshot.txIds[0]),
          company_db: snapshot.companyDb ?? null,
          payload: { __endpoint: "pagcorp-to-sap", __body: originalBody },
          errorBody: msg,
        });
      }
    } catch (retryErr) {
      console.warn("pagcorp-to-sap enqueueRetry failed:", (retryErr as Error).message);
    }
    await notifyErpIntegration({
      status: "error",
      entityIds: snapshot.txIds,
      companyDb: snapshot.companyDb,
      errorMessage: msg,
      supplierCode: snapshot.supplierCode,
      supplierName: snapshot.supplierName,
      totalAmount: snapshot.totalAmount,
      currency: snapshot.currency,
      integratedBy: snapshot.integratedBy,
    });
    return new Response(
      JSON.stringify({ success: false, error: msg, stages }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
