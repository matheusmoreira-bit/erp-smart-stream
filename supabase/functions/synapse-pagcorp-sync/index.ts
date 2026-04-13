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

// ── SAP B1 helpers ───────────────────────────────────────────────────

async function loginSap(sapCreds: Record<string, string>) {
  const baseUrl = sapCreds.service_layer_url || sapCreds.base_url || sapCreds.url;
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");

  const companyDB = sapCreds.company_db || sapCreds.CompanyDB;
  const userName = sapCreds.username || sapCreds.UserName;
  const password = sapCreds.password || sapCreds.Password;

  const loginResp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
  });
  if (!loginResp.ok) throw new Error(`SAP Login failed: ${loginResp.status}`);
  const cookies = loginResp.headers.get("set-cookie") || "";
  return { baseUrl, cookies, companyDB };
}

async function getItemMapping(supabase: ReturnType<typeof createClient>, accountCode: string) {
  // Try exact match first
  const { data: exact } = await supabase
    .from("pagcorp_item_mapping")
    .select("item_code, account_code, account_name")
    .eq("account_code", accountCode)
    .eq("is_fallback", false)
    .maybeSingle();
  if (exact) return exact;

  // Fallback
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
    const results: Array<{ expenseId: number; success: boolean; docEntry?: number; docNum?: number; error?: string }> = [];

    for (const expense of pending) {
      const expenseId = Number(expense.id || expense.expenseId);
      try {
        const accountCode = expense.accountCode || expense.account || "";
        const itemMapping = await getItemMapping(supabase, accountCode);
        const acctMapping = await getAccountMapping(supabase, accountCode);

        const amount = expense.amount || expense.value || expense.expenseValue || 0;
        const description = expense.description || expense.expenseDescription || "";

        // Build SAP document payload
        const sapPayload: Record<string, unknown> = {
          CardCode: String(integrationParams.default_supplier_code || ""),
          DocDate: expense.eventDate || expense.date || endDate,
          Comments: `PagCorp #${expenseId} - ${description}`,
          DocumentLines: [
            {
              ItemCode: itemMapping?.item_code || String(integrationParams.default_item_code || ""),
              Quantity: 1,
              UnitPrice: amount,
              AccountCode: itemMapping?.account_code || accountCode || undefined,
              CostingCode: acctMapping?.cost_center || String(integrationParams.default_cost_center || "") || undefined,
              ProjectCode: acctMapping?.project || String(integrationParams.default_project || "") || undefined,
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

        results.push({ expenseId, success: true, docEntry: sapResult.docEntry, docNum: sapResult.docNum });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Erro desconhecido";

        await supabase.from("pagcorp_integration_log").insert({
          pagcorp_expense_id: expenseId,
          pagcorp_data: { description: expense.description, amount: expense.amount },
          integration_type: "accountability",
          status: "error",
          company_db: bodyCompanyDB || null,
          integrated_by: "synapse_auto",
          error_message: errMsg,
        } as any);

        results.push({ expenseId, success: false, error: errMsg });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const msg = `${successCount}/${pending.length} despesas integradas`;
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
