// Edge function: post an internal approved expense as a Purchase Order in SAP B1
// Endpoint: POST /functions/v1/expense-to-sap
// Body: { expense_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

  try {
    const { expense_id } = await req.json();
    if (!expense_id) throw new Error("expense_id obrigatório");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Load expense + items
    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .select("*")
      .eq("id", expense_id)
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
      .eq("expense_id", expense_id);
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

    // 3.1 Optional: upload attachments first and link via AttachmentEntry
    let attachmentEntry: number | null = null;
    const integrateAttachments = (sapCreds.integrate_attachments || "").toLowerCase() === "true";
    if (integrateAttachments) {
      const { data: atts, error: attErr } = await supabase
        .from("expense_attachments")
        .select("file_path, file_name")
        .eq("expense_id", expense_id);
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

      if (files.length > 0) {
        attachmentEntry = await uploadAttachmentsToSap(sap.baseUrl, sap.cookies, files);
        console.log(`Anexos enviados ao SAP — AbsoluteEntry=${attachmentEntry}`);
      }
    }

    const configuredBranch = Number(sapCreds.default_branch_id || "");
    const fallbackBranch = Number.isFinite(configuredBranch) && configuredBranch > 0 ? configuredBranch : 1;
    const branchId = (expense.branch_id && Number(expense.branch_id) > 0)
      ? Number(expense.branch_id)
      : fallbackBranch;

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
        const line: Record<string, unknown> = {
          ItemDescription: it.description,
          Quantity: Number(it.quantity) || 1,
          UnitPrice: Number(it.unit_price) || 0,
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

    // 4. Post to PurchaseOrders (Pedido de Compra — usa fornecedor como CardCode)
    const sapResult = await postSapDocument(sap.baseUrl, sap.cookies, sapPayload, "PurchaseOrders");

    // 5. Update expense record
    await supabase
      .from("expenses")
      .update({
        status: "pc_lancado",
        sap_doc_entry: sapResult.docEntry,
        sap_doc_num: sapResult.docNum,
      })
      .eq("id", expense_id);

    // 6. Audit
    await supabase.rpc("insert_audit_log", {
      p_action: "sap_document_created",
      p_entity_type: "expense",
      p_entity_id: expense_id,
      p_company_db: expense.company_db || null,
      p_details: {
        sap_endpoint: "PurchaseOrders",
        sap_doc_entry: sapResult.docEntry,
        sap_doc_num: sapResult.docNum,
      },
    });

    return new Response(
      JSON.stringify({ success: true, docEntry: sapResult.docEntry, docNum: sapResult.docNum }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("expense-to-sap error:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
