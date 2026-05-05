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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

async function uploadAttachmentsToSap(
  sap: SapSession,
  files: { name: string; blob: Blob }[],
): Promise<number | null> {
  if (files.length === 0) return null;
  const form = new FormData();
  for (const f of files) form.append("files", f.blob, f.name);
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
  return body.AbsoluteEntry ?? null;
}

async function downloadReceipts(receipts: any[]): Promise<{ name: string; blob: Blob }[]> {
  const files: { name: string; blob: Blob }[] = [];
  for (const r of receipts || []) {
    const url: string | undefined = r?.url || r?.fileUrl || r?.link;
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Falha ao baixar recibo ${url}: HTTP ${res.status}`);
        continue;
      }
      const blob = await res.blob();
      const name: string = r?.fileName || r?.name || `recibo_${files.length + 1}`;
      files.push({ name, blob });
    } catch (e) {
      console.warn(`Erro baixando recibo ${url}:`, e);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let logId: string | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;

  // Stage tracking for the response payload + log
  const stages: Record<string, "pending" | "success" | "failed" | "skipped"> = {
    attachment_upload: "skipped",
    purchase_order: "pending",
  };
  let sapPayloads: Record<string, unknown> = {};
  let sapResponses: Record<string, unknown> = {};

  try {
    const body = await req.json();
    const transaction = body.transaction;
    const companyDb: string = body.companyDb;
    const integrationType: "generic" | "accountability" = body.integrationType || "generic";
    const supplierCode: string = body.supplierCode;
    const supplierName: string | undefined = body.supplierName;
    const integratedBy: string | null = body.integratedBy || null;

    if (!transaction || !transaction.id) throw new Error("transaction inválido");
    if (!companyDb) throw new Error("companyDb obrigatório");
    if (!supplierCode) throw new Error("supplierCode (CardCode) obrigatório");

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 0. Idempotency: skip if already integrated successfully
    const { data: existing } = await supabase
      .from("pagcorp_integration_log")
      .select("id, status, sap_doc_entry, sap_doc_num")
      .eq("pagcorp_expense_id", Number(transaction.id))
      .eq("status", "success")
      .maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({
          success: true,
          alreadyIntegrated: true,
          docEntry: existing.sap_doc_entry,
          docNum: existing.sap_doc_num,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Insert pending log row early so we have logId for any failure path
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
          cardName: transaction.cardName,
          cardLastDigits: transaction.cardLastDigits,
          hasAccountability: transaction.hasAccountability,
          accountabilityApproved: transaction.accountabilityApproved,
          receipts: transaction.receipts,
        } as any,
        integration_type: integrationType,
        status: "pending",
        company_db: companyDb,
        integrated_by: integratedBy,
      } as any)
      .select("id")
      .single();
    if (initialLog.error) throw new Error(`Falha ao criar log: ${initialLog.error.message}`);
    logId = (initialLog.data as any).id;

    // 2. SAP login
    const sapCreds = await getSapCredentials(supabase, companyDb);
    const sap = await loginSap(sapCreds);

    // 3. Resolve mappings
    const acctMapping = await resolveAccountMapping(supabase, transaction.accountCode || null);
    const itemCode = await resolveItemCode(supabase, transaction.accountCode || null);
    if (!itemCode) {
      throw new Error("Nenhum item mapeado encontrado (cadastre um item fallback em Mapeamento PagCorp)");
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

    // 4. Upload attachments (only for accountability with receipts)
    let attachmentEntry: number | null = null;
    if (integrationType === "accountability" && Array.isArray(transaction.receipts) && transaction.receipts.length > 0) {
      stages.attachment_upload = "pending";
      try {
        const files = await downloadReceipts(transaction.receipts);
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

    // 5. Build common document payload
    const txDate = transaction.date
      ? new Date(transaction.date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const amount = Number(transaction.amount) || 0;
    const description =
      `PagCorp #${transaction.id} - ${transaction.description || ""}`.slice(0, 254);

    const docLine: Record<string, unknown> = {
      ItemCode: itemCode,
      ItemDescription: (transaction.description || "PagCorp").slice(0, 100),
      Quantity: 1,
      UnitPrice: amount,
      ...lineCustom,
    };
    if (acctMapping?.cost_center) docLine.CostingCode = acctMapping.cost_center;
    if (acctMapping?.project) docLine.ProjectCode = acctMapping.project;

    const baseDoc = {
      CardCode: supplierCode,
      DocDate: txDate,
      DocDueDate: today,
      TaxDate: txDate,
      BPL_IDAssignedToInvoice: branchId,
      Comments: description,
      DocumentLines: [docLine],
      ...headerCustom,
    };

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

    // 7. Persist final success log (apenas Pedido de Compra)
    await supabase
      .from("pagcorp_integration_log")
      .update({
        status: "success",
        sap_doc_entry: poResult.docEntry,
        sap_doc_num: poResult.docNum,
        sap_payload: sapPayloads as any,
        sap_response: { ...sapResponses, supplierCode, supplierName, stages, attachmentEntry } as any,
      } as any)
      .eq("id", logId!);

    // Audit
    await supabase.rpc("insert_audit_log", {
      p_action: "pagcorp_integrated",
      p_entity_type: "pagcorp_transaction",
      p_entity_id: String(transaction.id),
      p_company_db: companyDb,
      p_actor_email: integratedBy || undefined,
      p_details: {
        integration_type: integrationType,
        purchase_order: poResult,
        stages,
      } as any,
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
    if (supabase && logId) {
      await supabase
        .from("pagcorp_integration_log")
        .update({
          status: "error",
          error_message: msg,
          sap_payload: sapPayloads as any,
          sap_response: { stages, ...sapResponses } as any,
        } as any)
        .eq("id", logId);
    }
    return new Response(
      JSON.stringify({ success: false, error: msg, stages }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
