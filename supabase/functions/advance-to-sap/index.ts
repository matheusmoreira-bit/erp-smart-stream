// Edge function: integra um adiantamento aprovado como Down Payment Invoice (PurchaseDownPaymentInvoices) no SAP B1.
// POST /functions/v1/advance-to-sap  body: { advance_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUserOrSapSession } from "../_shared/auth.ts";
import { tryAcquireIntegrationLock, releaseIntegrationLock } from "../_shared/sap-fetch.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildSapCookies(sessionId: string, routeId?: string) {
  return `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
}

async function getSapCreds(supabase: ReturnType<typeof createClient>, companyDb?: string) {
  let q = supabase.from("system_credentials").select("credential_key, credential_value").eq("system_name", "sap");
  if (companyDb) q = q.eq("company_db", companyDb);
  const { data, error } = await q;
  if (error) throw new Error(`Erro credenciais SAP: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais SAP não configuradas");
  const out: Record<string, string> = {};
  for (const r of data as any[]) out[r.credential_key] = r.credential_value;
  return out;
}

function getSapBaseUrl(creds: Record<string, string>) {
  let url = (creds.service_layer_url || creds.base_url || creds.url || "").replace(/\/+$/, "");
  if (!url) throw new Error("URL do SAP B1 não configurada");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, creds: Record<string, string>, companyDb: string) {
  const user = creds.username || creds.apiuser;
  const pwd = creds.password || creds.apipassword;
  if (!user || !pwd) throw new Error("Credenciais admin SAP ausentes (username/password).");
  const res = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: user, Password: pwd, CompanyDB: companyDb }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SAP Login failed: ${body?.error?.message?.value || res.status}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const routeMatch = /ROUTEID=([^;]+)/.exec(setCookie);
  return { sessionId: body.SessionId as string, routeId: routeMatch?.[1] };
}

async function uploadAttachmentsToSap(baseUrl: string, cookies: string, files: { name: string; blob: Blob }[]) {
  if (files.length === 0) return null;
  const form = new FormData();
  for (const f of files) form.append("files", f.blob, f.name);
  const res = await fetch(`${baseUrl}/Attachments2`, { method: "POST", headers: { Cookie: cookies }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SAP Attachments2 failed [${res.status}]: ${body?.error?.message?.value || JSON.stringify(body)}`);
  return body.AbsoluteEntry ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireUserOrSapSession(req);
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Faça login no SAP pela tela antes de integrar." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let advanceId: string | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const body = await req.json();
    advanceId = body.advance_id;
    if (!advanceId) throw new Error("advance_id obrigatório");

    supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: adv, error: aErr } = await supabase
      .from("advance_payments")
      .select("*")
      .eq("id", advanceId)
      .single();
    if (aErr || !adv) throw new Error(`Adiantamento não encontrado: ${aErr?.message ?? ""}`);

    if (adv.sap_doc_entry) {
      return new Response(
        JSON.stringify({ success: true, alreadyIntegrated: true, docEntry: adv.sap_doc_entry, docNum: adv.sap_doc_num }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Lock anti-duplicação: impede dois cliques simultâneos de criar 2 DPIs no SAP.
    const acquired = await tryAcquireIntegrationLock(supabase, "advance_payments", advanceId);
    if (!acquired) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Este adiantamento já está sendo integrado ao SAP por outro processo. Aguarde alguns minutos e tente novamente.",
          alreadyProcessing: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const companyDb: string = adv.company_db;
    const creds = await getSapCreds(supabase, companyDb);
    const baseUrl = getSapBaseUrl(creds);

    // Conta contábil padrão de adiantamento por empresa.
    // Configurada em system_credentials com credential_key='dpm_account_code'.
    const dpmAccount = creds.dpm_account_code;
    if (!dpmAccount) {
      throw new Error(
        "Conta contábil de adiantamento (dpm_account_code) não configurada para esta empresa. Cadastre em Integrações → Credenciais SAP.",
      );
    }

    // Faz login com credenciais administrativas (operação de back-office, não requer sessão do usuário).
    const { sessionId, routeId } = await sapLogin(baseUrl, creds, companyDb);
    const cookies = buildSapCookies(sessionId, routeId);

    const today = new Date().toISOString().slice(0, 10);
    const dueDate = adv.due_date || today;

    // Anexos
    const { data: attRows } = await supabase
      .from("advance_payment_attachments")
      .select("*")
      .eq("advance_id", advanceId);
    let attachmentEntry: number | null = null;
    if (attRows && attRows.length > 0) {
      const files: { name: string; blob: Blob }[] = [];
      for (const a of attRows as any[]) {
        const { data: f } = await supabase.storage.from("expense-attachments").download(a.file_path);
        if (f) files.push({ name: a.file_name, blob: f });
      }
      attachmentEntry = await uploadAttachmentsToSap(baseUrl, cookies, files);
    }

    // Carrega linhas do adiantamento
    const { data: lineRows } = await supabase
      .from("advance_payment_items")
      .select("*")
      .eq("advance_id", advanceId)
      .order("created_at", { ascending: true });

    const items = (lineRows as any[]) || [];
    const anyItem = items.some((l) => l.item_code);
    const docType = anyItem ? "dDocument_Items" : "dDocument_Service";

    let documentLines: Record<string, unknown>[];
    if (items.length === 0) {
      // Fallback legado: uma única linha com valor total do cabeçalho
      documentLines = [
        {
          AccountCode: dpmAccount,
          LineTotal: Number(adv.amount),
          Currency: adv.currency,
          ...(adv.cost_center ? { CostingCode: adv.cost_center } : {}),
        },
      ];
    } else {
      documentLines = items.map((l) => {
        const line: Record<string, unknown> = {
          Quantity: Number(l.quantity) || 1,
          UnitPrice: Number(l.unit_price) || 0,
          Currency: adv.currency,
        };
        if (l.item_code) {
          line.ItemCode = l.item_code;
          if (l.description) line.FreeText = String(l.description).slice(0, 100);
        } else {
          line.LineType = "dDocument_Service";
          line.AccountCode = dpmAccount;
          line.ItemDescription = String(l.description || "Adiantamento").slice(0, 100);
        }
        if (l.cost_center) line.CostingCode = l.cost_center;
        if (l.project) line.ProjectCode = l.project;
        return line;
      });
    }

    const payload: Record<string, unknown> = {
      CardCode: adv.supplier_card_code,
      DocDate: today,
      DocDueDate: dueDate,
      TaxDate: today,
      DocType: docType,
      DocCurrency: adv.currency,
      DownPaymentType: "dptInvoice",
      DownPaymentPercentage: 100,
      Comments: adv.remarks || `Adiantamento a fornecedor — solicitante: ${adv.requester_email || ""}`,
      DocumentLines: documentLines,
    };
    if (attachmentEntry) payload.AttachmentEntry = attachmentEntry;

    const res = await fetch(`${baseUrl}/PurchaseDownPaymentInvoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify(payload),
    });
    const respBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = respBody?.error?.message?.value || JSON.stringify(respBody);
      throw new Error(`SAP PurchaseDownPaymentInvoices failed [${res.status}]: ${msg}`);
    }

    await supabase
      .from("advance_payments")
      .update({
        status: "integrated",
        sap_doc_entry: respBody.DocEntry,
        sap_doc_num: respBody.DocNum,
        sap_integration_status: "success",
        sap_integration_error: null,
        sap_integrated_at: new Date().toISOString(),
      })
      .eq("id", advanceId);

    // Logout
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookies } }).catch(() => {});

    return new Response(
      JSON.stringify({ success: true, docEntry: respBody.DocEntry, docNum: respBody.DocNum }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (supabase && advanceId) {
      await supabase
        .from("advance_payments")
        .update({ status: "failed", sap_integration_status: "error", sap_integration_error: msg })
        .eq("id", advanceId)
        .catch(() => {});
    }
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (supabase && advanceId) {
      await releaseIntegrationLock(supabase, "advance_payments", advanceId);
    }
  }
});
