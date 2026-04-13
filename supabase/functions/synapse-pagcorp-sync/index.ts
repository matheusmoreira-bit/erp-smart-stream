import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const json = decoder.decode(base64ToUint8Array(base64));
  return JSON.parse(json);
}

async function encryptPassword(password: string, ivBase64: string, aesKeyBase64: string, hmacKeyBase64: string): Promise<string> {
  const aesKeyBytes = base64ToUint8Array(aesKeyBase64);
  const hmacKeyBytes = base64ToUint8Array(hmacKeyBase64);
  const iv = base64ToUint8Array(ivBase64);

  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, aesKey, encoder.encode(password));

  const encryptedArr = new Uint8Array(encrypted);
  const ciphertext = encryptedArr.slice(0, encryptedArr.length - 16);
  const tag = encryptedArr.slice(encryptedArr.length - 16);

  const payload = new Uint8Array(iv.length + ciphertext.length + tag.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);
  payload.set(tag, iv.length + ciphertext.length);

  const hmacKey = await crypto.subtle.importKey("raw", hmacKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hmacValue = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, payload));

  const final = new Uint8Array(payload.length + hmacValue.length);
  final.set(payload, 0);
  final.set(hmacValue, payload.length);

  return uint8ArrayToBase64(final);
}

interface PagCorpCreds {
  api_base_url: string;
  client_key: string;
  client_secret: string;
  login_email: string;
  login_password: string;
  aes_key: string;
  hmac_key: string;
  account_id: string;
}

// ── Credential helpers ───────────────────────────────────────────────

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getPagCorpCredentials(supabase: ReturnType<typeof createClient>, companyDb?: string): Promise<PagCorpCreds> {
  let query = supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "pagcorp");
  if (companyDb) query = query.eq("company_db", companyDb);

  const { data, error } = await query;
  if (error) throw new Error(`Erro credenciais PagCorp: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais PagCorp não configuradas");

  const creds: Record<string, string> = {};
  for (const row of data) creds[row.credential_key] = row.credential_value;

  const required = ["api_base_url", "client_key", "client_secret", "login_email", "login_password", "aes_key", "hmac_key", "account_id"];
  for (const key of required) {
    if (!creds[key]) throw new Error(`Credencial PagCorp ausente: ${key}`);
  }
  return creds as unknown as PagCorpCreds;
}

async function getSapCredentials(supabase: ReturnType<typeof createClient>, companyDb?: string) {
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

// ── PagCorp auth ─────────────────────────────────────────────────────

async function getPagCorpToken(creds: PagCorpCreds): Promise<string> {
  const tokenRes = await fetch(`${creds.api_base_url}Authentication/Client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: creds.client_key, clientSecret: creds.client_secret }),
  });
  if (!tokenRes.ok) throw new Error(`PagCorp client auth failed [${tokenRes.status}]`);
  const { token: accessToken } = await tokenRes.json();

  const jwt = decodeJwtPayload(accessToken);
  const iv = jwt.iv as string;
  const encryptedPassword = await encryptPassword(creds.login_password, iv, creds.aes_key, creds.hmac_key);

  const loginRes = await fetch(`${creds.api_base_url}Authentication/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ login: creds.login_email, password: encryptedPassword }),
  });
  if (!loginRes.ok) throw new Error(`PagCorp login failed [${loginRes.status}]`);
  const { token: apiToken } = await loginRes.json();
  return apiToken;
}

// ── PagCorp: fetch approved accountability expenses ──────────────────

async function fetchApprovedExpenses(apiToken: string, baseUrl: string, accountId: string, startDate: string, endDate: string): Promise<any[]> {
  const allItems: any[] = [];
  let page = 1;

  while (true) {
    const url = `${baseUrl}Expense/Account/${accountId}?startDate=${startDate}&endDate=${endDate}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (!res.ok) throw new Error(`PagCorp fetch expenses failed [${res.status}]`);
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) break;
    allItems.push(...items);
    if (data.currentPage >= data.totalPages) break;
    page++;
  }

  // Filter only those with approved accountability (statusId === 3)
  return allItems.filter((item: any) => {
    const receipts = item.receipts || [];
    return receipts.some((r: any) => r.statusId === 3);
  });
}

// ── AI: extract document data from receipts ──────────────────────────

interface AIExtractionResult {
  supplier_code?: string;
  supplier_name?: string;
  item_code?: string;
  item_description?: string;
  cost_center?: string;
  project?: string;
  amount?: number;
  document_date?: string;
  document_number?: string;
  confidence: number;
}

async function fetchReceiptFile(url: string, token: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) return null; // skip empty or >10MB

    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return { base64: btoa(binary), mimeType: contentType.split(";")[0] };
  } catch {
    return null;
  }
}

async function extractDataWithAI(
  expense: any,
  pagToken: string,
  pagBaseUrl: string,
  integrationParams: Record<string, unknown>,
): Promise<AIExtractionResult | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.warn("LOVABLE_API_KEY não configurada, pulando extração por IA");
    return null;
  }

  // Collect receipt file URLs from the expense
  const receipts = expense.receipts || [];
  const fileUrls: string[] = [];
  for (const r of receipts) {
    // Try common PagCorp receipt file URL patterns
    if (r.fileUrl) fileUrls.push(r.fileUrl);
    if (r.receiptUrl) fileUrls.push(r.receiptUrl);
    if (r.imageUrl) fileUrls.push(r.imageUrl);
    if (r.file?.url) fileUrls.push(r.file.url);
    if (r.id && !r.fileUrl && !r.receiptUrl && !r.imageUrl) {
      // Try fetching receipt detail for file URL
      fileUrls.push(`${pagBaseUrl}Receipt/${r.id}/File`);
    }
  }

  if (fileUrls.length === 0) return null;

  // Download receipt files and build multimodal content
  const contentParts: any[] = [];
  for (const url of fileUrls.slice(0, 3)) { // limit to 3 files
    const file = await fetchReceiptFile(url, pagToken);
    if (file) {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${file.mimeType};base64,${file.base64}` },
      });
    }
  }

  if (contentParts.length === 0) return null;

  // Build context about available defaults and mappings
  const contextInfo = `
Contexto da integração:
- Fornecedor padrão (CardCode): ${integrationParams.default_supplier_code || "não definido"}
- Item padrão (ItemCode): ${integrationParams.default_item_code || "não definido"}
- Centro de custo padrão: ${integrationParams.default_cost_center || "não definido"}
- Projeto padrão: ${integrationParams.default_project || "não definido"}
- Dados da despesa PagCorp: Valor=${expense.amount || expense.value || 0}, Descrição="${expense.description || ""}", Conta="${expense.accountCode || ""}"
`;

  contentParts.push({
    type: "text",
    text: `${contextInfo}

Analise o(s) documento(s) anexo(s) desta despesa e extraia as informações para lançamento no SAP Business One.
Responda APENAS com JSON, sem markdown:
{
  "supplier_code": "Código do fornecedor no SAP (CardCode) se identificável no documento, ou null",
  "supplier_name": "Nome do fornecedor/emissor do documento",
  "item_code": "Código do item SAP se identificável, ou null",
  "item_description": "Descrição do item/serviço principal",
  "cost_center": "Centro de custo se identificável no documento, ou null",
  "project": "Código do projeto se identificável, ou null",
  "amount": 0.00,
  "document_date": "YYYY-MM-DD",
  "document_number": "Número da NF ou documento",
  "confidence": 0.0
}

Regras:
- NÃO invente dados. Se não encontrar um campo, use null.
- supplier_code deve ser o CardCode SAP (ex: F00001) - só preencha se visível no documento.
- item_code deve ser o ItemCode SAP - só preencha se visível.
- cost_center e project só preencha se claramente identificáveis.
- confidence entre 0 e 1 indica confiança geral na extração.`,
  });

  try {
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Você é um assistente especializado em processar documentos fiscais brasileiros para integração com SAP Business One. Extraia dados com precisão. Responda apenas com JSON válido.",
          },
          { role: "user", content: contentParts },
        ],
      }),
    });

    if (!aiResponse.ok) {
      console.warn(`AI extraction failed [${aiResponse.status}]`);
      await aiResponse.text(); // consume body
      return null;
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";
    const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed as AIExtractionResult;
  } catch (e) {
    console.warn("AI extraction error:", e);
    return null;
  }
}

// ── SAP B1 helpers ───────────────────────────────────────────────────

async function loginSap(sapCreds: Record<string, string>) {
  let baseUrl = (sapCreds.service_layer_url || sapCreds.base_url || sapCreds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");
  if (!baseUrl.includes("/b1s/v1")) baseUrl = `${baseUrl}/b1s/v1`;

  const companyDB = sapCreds.company_db || sapCreds.CompanyDB;
  const userName = sapCreds.username || sapCreds.UserName;
  const password = sapCreds.password || sapCreds.Password;

  let loginResp: Response;
  try {
    loginResp = await fetch(`${baseUrl}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
    });
  } catch (e) {
    throw new Error(`SAP Service Layer inacessível (${baseUrl}). Verifique se o servidor permite conexões externas.`);
  }
  if (!loginResp.ok) {
    const body = await loginResp.text().catch(() => "");
    if (loginResp.status === 502 || loginResp.status === 503) {
      throw new Error(`SAP Service Layer indisponível (HTTP ${loginResp.status}). O servidor pode estar fora do ar ou bloqueando conexões externas.`);
    }
    throw new Error(`SAP Login falhou (HTTP ${loginResp.status}): ${body.slice(0, 200)}`);
  }
  const cookies = loginResp.headers.get("set-cookie") || "";
  return { baseUrl, cookies, companyDB };
}

async function getItemMapping(supabase: ReturnType<typeof createClient>, accountCode: string) {
  const { data: exact } = await supabase
    .from("pagcorp_item_mapping")
    .select("item_code, account_code, account_name")
    .eq("account_code", accountCode)
    .eq("is_fallback", false)
    .maybeSingle();
  if (exact) return exact;

  const { data: fallback } = await supabase
    .from("pagcorp_item_mapping")
    .select("item_code, account_code, account_name")
    .eq("is_fallback", true)
    .limit(1)
    .maybeSingle();
  return fallback;
}

async function getAccountMapping(supabase: ReturnType<typeof createClient>, accountCode: string) {
  const { data } = await supabase
    .from("pagcorp_account_mapping")
    .select("cost_center, project")
    .eq("account_code", accountCode)
    .maybeSingle();
  return data;
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
  return {
    docEntry: body.DocEntry,
    docNum: body.DocNum,
    response: body,
  };
}

// ── SAP validation helpers ───────────────────────────────────────────

async function sapEntityExists(sapBaseUrl: string, cookies: string, entity: string, code: string): Promise<boolean> {
  if (!code) return false;
  try {
    const res = await fetch(`${sapBaseUrl}/${entity}('${encodeURIComponent(code)}')`, {
      method: "GET",
      headers: { Cookie: cookies },
    });
    if (res.ok) {
      await res.text();
      return true;
    }
    await res.text();
    return false;
  } catch {
    return false;
  }
}

// ── Email notification helper ────────────────────────────────────────

interface ValidationIssue {
  expenseId: number;
  description: string;
  type: "supplier_not_found" | "item_not_found";
  code: string;
  employeeName: string;
  amount: number;
}

async function sendValidationNotificationEmail(
  issues: ValidationIssue[],
  notificationEmail: string,
  companyDB: string,
) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!notificationEmail || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("Notification email not configured or missing env vars, skipping email");
    return;
  }

  const supplierIssues = issues.filter((i) => i.type === "supplier_not_found");
  const itemIssues = issues.filter((i) => i.type === "item_not_found");

  const rows = issues.map((i) => {
    const typeLabel = i.type === "supplier_not_found" ? "Fornecedor" : "Item";
    return `<tr>
      <td style="padding:8px;border:1px solid #ddd">${i.expenseId}</td>
      <td style="padding:8px;border:1px solid #ddd">${i.employeeName || "-"}</td>
      <td style="padding:8px;border:1px solid #ddd">${i.description}</td>
      <td style="padding:8px;border:1px solid #ddd">R$ ${i.amount.toFixed(2)}</td>
      <td style="padding:8px;border:1px solid #ddd">${typeLabel}</td>
      <td style="padding:8px;border:1px solid #ddd"><code>${i.code || "vazio"}</code></td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#d97706">⚠️ Integração PagCorp → SAP — Itens não integrados</h2>
      <p>A integração automática do PagCorp encontrou <strong>${issues.length}</strong> despesa(s) que não puderam ser integradas por falta de cadastro no SAP.</p>
      ${supplierIssues.length > 0 ? `<p>🔴 <strong>${supplierIssues.length}</strong> fornecedor(es) não encontrado(s)</p>` : ""}
      ${itemIssues.length > 0 ? `<p>🟡 <strong>${itemIssues.length}</strong> item(ns) não encontrado(s)</p>` : ""}
      <p><strong>Empresa:</strong> ${companyDB}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px;border:1px solid #ddd;text-align:left">ID Despesa</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Colaborador</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Descrição</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Valor</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Problema</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Código</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#666;font-size:13px">Cadastre os fornecedores/itens no SAP e reexecute a integração para processar essas despesas.</p>
    </div>
  `;

  // Try sending via send-transactional-email if available, otherwise log
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "__raw_html",
        recipientEmail: notificationEmail,
        subject: `⚠️ PagCorp: ${issues.length} despesa(s) não integrada(s) — ${companyDB}`,
        rawHtml: html,
        idempotencyKey: `pagcorp-validation-${companyDB}-${new Date().toISOString().slice(0, 10)}`,
      },
    });
    console.log(`Notification email sent to ${notificationEmail}`);
  } catch (emailErr) {
    console.warn("Failed to send notification email via transactional, trying direct:", emailErr);
    // Fallback: log to audit_log for visibility
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from("audit_log").insert({
        action: "pagcorp_validation_issues",
        entity_type: "synapse_integration",
        company_db: companyDB,
        details: { issues, notification_email: notificationEmail, email_failed: true },
      } as any);
    } catch {}
  }
}

// ── Execution log helper ─────────────────────────────────────────────

async function logExecution(
  supabase: ReturnType<typeof createClient>,
  status: string,
  details: Record<string, unknown>,
  affectedCount: number,
) {
  await supabase.from("synapse_execution_log").insert({
    integration_key: "pagcorp_erp_sync",
    status,
    details,
    affected_count: affectedCount,
  });
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = getServiceClient();

  try {
    let bodyCompanyDB = "";
    let bodyParams: Record<string, unknown> = {};
    try {
      const body = await req.json();
      bodyCompanyDB = (body.company_db as string) || "";
      bodyParams = body.params || {};
    } catch { /* no body */ }

    // Check integration config
    let query = supabase
      .from("synapse_integrations")
      .select("*")
      .eq("integration_key", "pagcorp_erp_sync");
    if (bodyCompanyDB) query = query.eq("company_db", bodyCompanyDB);
    const { data: config } = await query.single();

    if (!config?.is_active) {
      return new Response(JSON.stringify({ message: "Integração PagCorp → ERP não está ativa" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const integrationParams = { ...(config.parameters as Record<string, unknown>), ...bodyParams };

    // Date range: defaults to last 30 days
    const daysBack = Number(integrationParams.days_back) || 30;
    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 86400000).toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);

    // SAP document endpoint (configurable)
    const sapEndpoint = String(integrationParams.sap_endpoint || "PurchaseInvoices");

    // 1. Get PagCorp credentials and fetch approved expenses
    const pagCreds = await getPagCorpCredentials(supabase, bodyCompanyDB || undefined);
    const pagToken = await getPagCorpToken(pagCreds);
    const approvedExpenses = await fetchApprovedExpenses(pagToken, pagCreds.api_base_url, pagCreds.account_id, startDate, endDate);

    if (approvedExpenses.length === 0) {
      await logExecution(supabase, "success", { message: "Nenhuma despesa aprovada encontrada", startDate, endDate }, 0);
      await supabase.from("synapse_integrations")
        .update({ last_run_at: now.toISOString(), last_run_status: "success", last_run_message: "Nenhuma despesa aprovada" })
        .eq("id", config.id);
      return new Response(JSON.stringify({ message: "Nenhuma despesa aprovada para integrar", startDate, endDate }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Filter out already integrated
    const expenseIds = approvedExpenses.map((e: any) => Number(e.id || e.expenseId)).filter((id: number) => !isNaN(id));
    const { data: existingLogs } = await supabase
      .from("pagcorp_integration_log")
      .select("pagcorp_expense_id")
      .in("pagcorp_expense_id", expenseIds)
      .eq("status", "success");

    const alreadyIntegrated = new Set((existingLogs || []).map((l: any) => l.pagcorp_expense_id));
    const pending = approvedExpenses.filter((e: any) => !alreadyIntegrated.has(Number(e.id || e.expenseId)));

    if (pending.length === 0) {
      await logExecution(supabase, "success", { message: "Todas despesas já integradas", total: approvedExpenses.length }, 0);
      await supabase.from("synapse_integrations")
        .update({ last_run_at: now.toISOString(), last_run_status: "success", last_run_message: `${approvedExpenses.length} despesas, todas já integradas` })
        .eq("id", config.id);
      return new Response(JSON.stringify({ message: "Todas já integradas", total: approvedExpenses.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Login to SAP
    const sapCreds = await getSapCredentials(supabase, bodyCompanyDB || undefined);
    const sap = await loginSap(sapCreds);

    // 4. Integrate each pending expense
    const results: Array<{ expenseId: number; success: boolean; docEntry?: number; docNum?: number; error?: string; aiUsed?: boolean; skipped?: string }> = [];
    const bplId = integrationParams.default_bpl_id ? Number(integrationParams.default_bpl_id) : undefined;
    const notificationEmail = String(integrationParams.notification_email || "").trim();
    const validationIssues: ValidationIssue[] = [];

    for (const expense of pending) {
      const expenseId = Number(expense.id || expense.expenseId);
      try {
        const accountCode = expense.accountCode || expense.account || "";
        const itemMapping = await getItemMapping(supabase, accountCode);
        const acctMapping = await getAccountMapping(supabase, accountCode);

        const amount = expense.amount || expense.value || expense.expenseValue || 0;
        const description = expense.description || expense.expenseDescription || "";

        // ── AI extraction: try to get data from receipt documents ──
        let aiResult: AIExtractionResult | null = null;
        try {
          aiResult = await extractDataWithAI(expense, pagToken, pagCreds.api_base_url, integrationParams);
        } catch (aiErr) {
          console.warn(`AI extraction failed for expense ${expenseId}:`, aiErr);
        }

        const aiUsed = aiResult !== null && (aiResult.confidence ?? 0) >= 0.5;

        // Determine final values: AI > mapping > defaults
        const finalSupplierCode = (aiUsed && aiResult?.supplier_code)
          ? aiResult.supplier_code
          : String(integrationParams.default_supplier_code || "");

        const finalItemCode = (aiUsed && aiResult?.item_code)
          ? aiResult.item_code
          : itemMapping?.item_code || String(integrationParams.default_item_code || "");

        const finalCostCenter = (aiUsed && aiResult?.cost_center)
          ? aiResult.cost_center
          : acctMapping?.cost_center || String(integrationParams.default_cost_center || "");

        const finalProject = (aiUsed && aiResult?.project)
          ? aiResult.project
          : acctMapping?.project || String(integrationParams.default_project || "");

        const finalAmount = (aiUsed && aiResult?.amount && aiResult.amount > 0)
          ? aiResult.amount
          : amount;

        const finalDocDate = (aiUsed && aiResult?.document_date)
          ? aiResult.document_date
          : expense.eventDate || expense.date || endDate;

        // Build SAP PurchaseOrders payload (based on n8n template)
        const employeeName = expense.employeeName || expense.userName || "";
        const docCurrency = String(integrationParams.default_currency || "").trim();
        const docRate = Number(integrationParams.default_doc_rate) || 0;

        const sapPayload: Record<string, unknown> = {
          CardCode: finalSupplierCode,
          DocDate: finalDocDate,
          DocDueDate: finalDocDate,
          TaxDate: finalDocDate,
          BPL_IDAssignedToInvoice: bplId || 1,
          U_FGR_RATEIO_CC: "N",
          U_FGR_CONTRATO: "N",
          ...(docCurrency ? { DocCurrency: docCurrency } : {}),
          ...(docRate > 0 ? { DocRate: docRate } : {}),
          Comments: `${employeeName} - ${description} - Integração PagCorp${aiUsed ? " [IA]" : ""}`,
          DocumentLines: [
            {
              ItemCode: finalItemCode,
              Quantity: 1,
              UnitPrice: finalAmount,
              CostingCode: finalCostCenter || undefined,
              ProjectCode: finalProject || undefined,
            },
          ],
        };

        // Remove empty optional fields from line
        const line = sapPayload.DocumentLines as any[];
        for (const key of Object.keys(line[0])) {
          if (!line[0][key]) delete line[0][key];
        }

        const sapResult = await postSapDocument(sap.baseUrl, sap.cookies, sapPayload, sapEndpoint);

        // Log success
        await supabase.from("pagcorp_integration_log").insert({
          pagcorp_expense_id: expenseId,
          pagcorp_data: {
            description,
            amount,
            date: expense.eventDate || expense.date,
            accountCode,
            accountabilityApproved: true,
            ai_extraction: aiUsed ? aiResult : null,
          },
          integration_type: "accountability",
          status: "success",
          company_db: bodyCompanyDB || null,
          integrated_by: "synapse_auto",
          sap_doc_entry: sapResult.docEntry,
          sap_doc_num: sapResult.docNum,
          sap_payload: sapPayload,
          sap_response: sapResult.response,
        } as any);

        results.push({ expenseId, success: true, docEntry: sapResult.docEntry, docNum: sapResult.docNum, aiUsed });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Erro desconhecido";
        const accountCode = expense.accountCode || expense.account || "";
        const itemMapping = await getItemMapping(supabase, accountCode).catch(() => null);
        const acctMapping = await getAccountMapping(supabase, accountCode).catch(() => null);
        const amount = expense.amount || expense.value || expense.expenseValue || 0;
        const description = expense.description || expense.expenseDescription || "";

        const failedDocDate = expense.eventDate || expense.date || endDate;
        const failedEmployeeName = expense.employeeName || expense.userName || "";
        const failedPayload: Record<string, unknown> = {
          CardCode: String(integrationParams.default_supplier_code || ""),
          DocDate: failedDocDate,
          DocDueDate: failedDocDate,
          TaxDate: failedDocDate,
          BPL_IDAssignedToInvoice: bplId || 1,
          U_FGR_RATEIO_CC: "N",
          U_FGR_CONTRATO: "N",
          ...(String(integrationParams.default_currency || "").trim() ? { DocCurrency: String(integrationParams.default_currency).trim() } : {}),
          ...(Number(integrationParams.default_doc_rate) > 0 ? { DocRate: Number(integrationParams.default_doc_rate) } : {}),
          Comments: `${failedEmployeeName} - ${description} - Integração PagCorp`,
          DocumentLines: [
            {
              ItemCode: itemMapping?.item_code || String(integrationParams.default_item_code || ""),
              Quantity: 1,
              UnitPrice: amount,
              CostingCode: acctMapping?.cost_center || String(integrationParams.default_cost_center || "") || undefined,
              ProjectCode: acctMapping?.project || String(integrationParams.default_project || "") || undefined,
            },
          ],
        };

        await supabase.from("pagcorp_integration_log").insert({
          pagcorp_expense_id: expenseId,
          pagcorp_data: { description, amount, date: expense.eventDate || expense.date, accountCode },
          integration_type: "accountability",
          status: "error",
          company_db: bodyCompanyDB || null,
          integrated_by: "synapse_auto",
          error_message: errMsg,
          sap_payload: failedPayload,
        } as any);

        results.push({ expenseId, success: false, error: errMsg });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const aiCount = results.filter((r) => r.aiUsed).length;
    const msg = `${successCount}/${pending.length} despesas integradas${aiCount > 0 ? ` (${aiCount} com IA)` : ""}`;
    const finalStatus = successCount === pending.length ? "success" : successCount > 0 ? "partial" : "error";

    await logExecution(supabase, finalStatus, { results, startDate, endDate }, successCount);
    await supabase.from("synapse_integrations")
      .update({ last_run_at: now.toISOString(), last_run_status: finalStatus, last_run_message: msg })
      .eq("id", config.id);

    return new Response(JSON.stringify({ message: msg, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    try { await logExecution(supabase, "error", { error: message }, 0); } catch {}
    try {
      await supabase.from("synapse_integrations")
        .update({ last_run_at: new Date().toISOString(), last_run_status: "error", last_run_message: message })
        .eq("integration_key", "pagcorp_erp_sync");
    } catch {}

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
