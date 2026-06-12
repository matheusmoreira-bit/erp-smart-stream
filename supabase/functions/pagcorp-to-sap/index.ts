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
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
function resolveCardKey(tx: { cardLastDigits?: unknown; cardName?: unknown }): string | null {
  const last = tx.cardLastDigits ? String(tx.cardLastDigits).trim() : "";
  if (last) return last;
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

  // For consolidated mode we need to update multiple log rows on error
  const consolidatedLogIds: string[] = [];

  try {
    const body = await req.json();
    const companyDb: string = body.companyDb;
    const integrationType: "generic" | "accountability" = body.integrationType || "generic";
    const supplierCode: string = body.supplierCode;
    const supplierName: string | undefined = body.supplierName;
    const integratedBy: string | null = body.integratedBy || null;
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

    // 0. Idempotency: filter out already-integrated transactions
    const ids = rawList.map((t) => Number(t.id));
    const { data: existingLogs } = await supabase
      .from("pagcorp_integration_log")
      .select("id, pagcorp_expense_id, status, sap_doc_entry, sap_doc_num")
      .in("pagcorp_expense_id", ids)
      .eq("status", "success");
    const alreadyIntegratedIds = new Set((existingLogs || []).map((r: any) => r.pagcorp_expense_id));
    const transactions = rawList.filter((t) => !alreadyIntegratedIds.has(Number(t.id)));

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
            cardName: transaction.cardName,
            cardLastDigits: transaction.cardLastDigits,
            hasAccountability: transaction.hasAccountability,
            accountabilityApproved: transaction.accountabilityApproved,
            receipts: transaction.receipts,
            consolidated: isConsolidated,
            consolidatedWith: isConsolidated ? transactions.map((x) => x.id) : undefined,
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
    const description = truncateSapText(
      isConsolidated
        ? `PagCorp consolidado: ${transactions.length} transações (${transactions.map((t) => `#${t.id}`).join(", ")})`
        : `PagCorp #${transaction.id} - ${transaction.description || ""}`,
      190,
    );

    const documentLines = lineMappings.map(({ tx, acctMapping, itemCode }) => {
      const override = lineOverrides[String(tx.id)] || {};
      const finalCostCenter = override.costCenter ?? acctMapping?.cost_center ?? null;
      const finalProject = override.project ?? acctMapping?.project ?? null;
      const finalItem = override.item || itemCode!;
      const lineCurrency = String(tx.currency || "").toUpperCase();
      const line: Record<string, unknown> = {
        ItemCode: finalItem,
        ItemDescription: (
          isConsolidated
            ? `[#${tx.id}] ${tx.description || "PagCorp"}`
            : (tx.description || "PagCorp")
        ).slice(0, 100),
        Quantity: 1,
        UnitPrice: Number(tx.amount) || 0,
        ...lineCustom,
      };
      if (lineCurrency && /^[A-Z]{3}$/.test(lineCurrency)) {
        line.Currency = lineCurrency;
      }
      if (finalCostCenter) line.CostingCode = finalCostCenter;
      if (finalProject) line.ProjectCode = finalProject;
      return line;
    });

    // Currency from the (already detected) transaction. Without DocCurrency,
    // SAP assumes local currency (BRL) even when the PagCorp expense is in USD.
    const headerCurrency = String(transaction.currency || "").toUpperCase();

    const baseDoc: Record<string, unknown> = {
      CardCode: supplierCode,
      DocDate: txDate,
      DocDueDate: today,
      TaxDate: txDate,
      BPL_IDAssignedToInvoice: branchId,
      Comments: description,
      DocumentLines: documentLines,
      ...headerCustom,
    };
    if (headerCurrency && /^[A-Z]{3}$/.test(headerCurrency)) {
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
        sap_response: { ...sapResponses, supplierCode, supplierName, stages, attachmentEntry, consolidated: isConsolidated, consolidatedCount: transactions.length } as any,
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
    return new Response(
      JSON.stringify({ success: false, error: msg, stages }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
