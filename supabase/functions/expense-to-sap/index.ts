// Edge function: post an internal approved expense as a Purchase Order in SAP B1
// Endpoint: POST /functions/v1/expense-to-sap
// Body: { expense_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireUserOrSapSession(req);
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: "Faça login no SAP pela tela antes de integrar." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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

    const { data: items, error: itemsErr } = await supabase
      .from("expense_items")
      .select("*")
      .eq("expense_id", expenseId);
    if (itemsErr) throw new Error(`Erro ao carregar itens: ${itemsErr.message}`);
    if (!items || items.length === 0) throw new Error("Despesa sem itens — não é possível lançar no SAP");

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

    // 2. SAP session. User-triggered integrations must reuse the SessionID
    // generated by the SAP login screen inside the 30-minute window. Do not
    // attempt a new SAP /Login here; background/service-account flows are the
    // only ones allowed to use configured Apiuser credentials.
    const sapCreds = await getSapCredentials(supabase, expense.company_db || undefined);
    const sapSessionId = typeof body.sap_session_id === "string" ? body.sap_session_id.trim() : "";
    const sapRouteId = typeof body.sap_route_id === "string" ? body.sap_route_id.trim() : "";
    const sapCompanyDb = typeof body.sap_company_db === "string" ? body.sap_company_db.trim() : "";
    const sapExpiresAt = Number(body.sap_session_expires_at || 0);
    if (!sapSessionId) throw new Error("Faça login no SAP pela tela antes de integrar.");
    if (sapExpiresAt && Date.now() >= sapExpiresAt) throw new Error("Sessão SAP expirada. Faça login novamente pela tela.");
    if (sapCompanyDb && expense.company_db && sapCompanyDb !== expense.company_db) {
      throw new Error("Sessão SAP pertence a outra empresa. Faça login na empresa da despesa.");
    }
    const sap = { baseUrl: getSapBaseUrl(sapCreds), cookies: buildSapCookies(sapSessionId, sapRouteId) };

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

    const sapPayload: Record<string, unknown> = {
      CardCode: expense.supplier_code,
      DocDate: today,
      DocDueDate: today,
      TaxDate: today,
      BPL_IDAssignedToInvoice: branchId,
      Comments: truncateSapText(
        (() => {
          const pcTx: any = (pagcorpLog as any)?.transaction || null;
          const holder = pcTx
            ? (pcTx.cardName || pcTx.accountAlias || pcTx.accountName || "").toString().trim()
            : "";
          const prefix = (expense as any).origin === "pagcorp" || pcTx
            ? `PagCorp${holder ? ` ${holder}` : ""}`
            : `${isSales ? "Pedido de venda" : "Despesa interna"} #${expense.id.slice(0, 8)}`;
          return `${prefix} — ${expense.requester_name}${expense.remarks ? ` — ${expense.remarks}` : ""}`;
        })(),
        190,
      ),
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
          ItemDescription: truncateSapText(it.description, 100),
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
