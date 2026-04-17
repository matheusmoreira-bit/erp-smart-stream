// Edge function: post an internal approved expense as a Purchase Order in SAP B1
// Endpoint: POST /functions/v1/expense-to-sap
// Body: { expense_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Status values used to track each integration stage on the expense row.
// Possible values:
//   "not_applicable" — stage skipped (e.g. no attachments, or feature disabled)
//   "pending"        — not yet attempted in this run
//   "success"        — stage completed without error
//   "failed"         — stage failed (see sap_integration_error)
type StageStatus = "not_applicable" | "pending" | "success" | "failed";

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

async function loginSap(sapCreds: Record<string, string>) {
  let baseUrl = (sapCreds.service_layer_url || sapCreds.base_url || sapCreds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");
  if (!baseUrl.includes("/b1s/v1")) baseUrl = `${baseUrl}/b1s/v1`;

  const companyDB = sapCreds.company_db || sapCreds.CompanyDB;
  const userName = sapCreds.username || sapCreds.UserName;
  const password = sapCreds.password || sapCreds.Password;

  const loginResp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
  });
  if (!loginResp.ok) {
    const body = await loginResp.text().catch(() => "");
    throw new Error(`SAP Login falhou (HTTP ${loginResp.status}): ${body.slice(0, 200)}`);
  }
  const cookies = loginResp.headers.get("set-cookie") || "";
  return { baseUrl, cookies };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Track stage status across the whole request so we can persist progress
  // even when later stages fail. These are flushed on success and on error.
  let attachmentStatus: StageStatus = "not_applicable";
  let purchaseOrderStatus: StageStatus = "pending";
  let attachmentLinkStatus: StageStatus = "not_applicable";
  let expenseId: string | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;
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

  try {
    const body = await req.json();
    expenseId = body.expense_id;
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

    if (expense.sap_doc_entry) {
      return new Response(
        JSON.stringify({ message: "Despesa já integrada", docEntry: expense.sap_doc_entry, docNum: expense.sap_doc_num }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: items, error: itemsErr } = await supabase
      .from("expense_items")
      .select("*")
      .eq("expense_id", expenseId);
    if (itemsErr) throw new Error(`Erro ao carregar itens: ${itemsErr.message}`);
    if (!items || items.length === 0) throw new Error("Despesa sem itens — não é possível lançar no SAP");

    if (!expense.supplier_code) {
      throw new Error("Fornecedor (CardCode) não informado na despesa");
    }

    // 2. SAP login
    const sapCreds = await getSapCredentials(supabase, expense.company_db || undefined);
    const sap = await loginSap(sapCreds);

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

    const sapPayload: Record<string, unknown> = {
      CardCode: expense.supplier_code,
      DocDate: today,
      DocDueDate: today,
      TaxDate: today,
      BPL_IDAssignedToInvoice: branchId,
      Comments: `Despesa interna #${expense.id.slice(0, 8)} — ${expense.requester_name}${expense.remarks ? ` — ${expense.remarks}` : ""}`,
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
        const line: Record<string, unknown> = {
          ItemDescription: it.description,
          Quantity: qty,
          UnitPrice: unit,
          ...lineCustom,
        };
        if (hasItem) {
          line.ItemCode = it.item_code;
        } else {
          line.LineType = "dDocument_Service";
        }
        if (it.cost_center || expense.cost_center) line.CostingCode = it.cost_center || expense.cost_center;
        if (it.project || expense.project) line.ProjectCode = it.project || expense.project;
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
      sapResult = await postSapDocument(sap.baseUrl, sap.cookies, sapPayload, "PurchaseOrders");
      lastSapResponse = sapResult.response;
      purchaseOrderStatus = "success";
      if (attachmentEntry !== null) attachmentLinkStatus = "success";
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
        sap_endpoint: "PurchaseOrders",
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

    return new Response(
      JSON.stringify({
        success: true,
        docEntry: sapResult.docEntry,
        docNum: sapResult.docNum,
        sapPayload,
        sapResponse: sapResult.response,
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
    return new Response(
      JSON.stringify({
        success: false,
        error: msg,
        sapPayload: lastSapPayload,
        sapResponse: lastSapResponse,
        stages: {
          attachment: attachmentStatus,
          purchase_order: purchaseOrderStatus,
          attachment_link: attachmentLinkStatus,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
