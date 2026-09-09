// Reconciliação (LCM) de adiantamento de cliente: cria o recebimento
// (IncomingPayment) no SAP quitando o Down Payment, informando a conta bancária.
// POST /functions/v1/advance-reconcile  body: { advance_id, data_recebimento, conta_codigo, conta_nome? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { parseSapHeaders, requireUser, validateSapSession } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getSapBaseUrl(companyDB: string): Promise<string> {
  const sb = adminClient();
  const { data } = await sb
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();
  const raw = typeof data?.credential_value === "string" && data.credential_value.trim()
    ? data.credential_value.trim()
    : (Deno.env.get("SAP_DEFAULT_BASE_URL") || "");
  if (!raw) throw new Error("URL do SAP B1 não configurada para esta empresa.");
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

function extractSapError(payload: unknown, fallback: string): string {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload || fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (message && typeof message === "object") {
      const value = (message as { value?: unknown }).value;
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return fallback;
}

async function resolveDefaultBranchId(companyDb: string): Promise<number> {
  const sb = adminClient();
  const { data } = await sb
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDb)
    .eq("system_name", "sap")
    .eq("credential_key", "default_branch_id")
    .maybeSingle();
  const raw = Number(data?.credential_value);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, errorMessage: "Método não permitido." });
  { const _pause = await getIntegrationPause("sap_b1"); if (_pause) return pauseResponse(_pause, corsHeaders); }

  try {
    const headers = parseSapHeaders(req);
    const sap = await validateSapSession(req);
    if (!headers || !sap) {
      return json(401, { ok: false, errorMessage: "Sessão SAP inválida ou expirada. Faça login no SAP novamente." });
    }

    const body = await req.json().catch(() => ({}));
    const advanceId = String(body.advance_id || "").trim();
    const dataRecebimento = String(body.data_recebimento || "").trim();
    const contaCodigo = String(body.conta_codigo || "").trim();
    const contaNome = body.conta_nome ? String(body.conta_nome) : null;

    if (!advanceId) return json(400, { ok: false, errorMessage: "Adiantamento obrigatório." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataRecebimento)) return json(400, { ok: false, errorMessage: "Data de recebimento inválida." });
    if (!contaCodigo) return json(400, { ok: false, errorMessage: "Conta bancária de recebimento obrigatória." });

    let userId: string | null = null;
    try {
      const user = await requireUser(req);
      userId = user.id;
    } catch { /* sessão SAP válida já autoriza a operação */ }

    const sb = adminClient();
    const { data: adv, error: advErr } = await sb
      .from("advance_payments")
      .select("*")
      .eq("id", advanceId)
      .maybeSingle();
    if (advErr || !adv) return json(404, { ok: false, errorMessage: advErr?.message || "Adiantamento não encontrado." });
    if (adv.company_db !== sap.companyDB) return json(403, { ok: false, errorMessage: "Adiantamento pertence a outra empresa." });
    if (adv.advance_type !== "customer") return json(400, { ok: false, errorMessage: "Apenas adiantamentos de cliente são reconciliados por esta rotina." });
    if (!adv.sap_doc_entry) return json(400, { ok: false, errorMessage: "Adiantamento ainda não integrado ao ERP." });
    if (adv.sap_incoming_payment_doc_entry) {
      return json(200, { ok: true, alreadyReconciled: true, sapDocEntry: adv.sap_incoming_payment_doc_entry });
    }

    const baseUrl = await getSapBaseUrl(sap.companyDB);
    const cookie = `B1SESSION=${headers.sapSession}${headers.routeId ? `; ROUTEID=${headers.routeId}` : ""}`;
    const bplId = await resolveDefaultBranchId(sap.companyDB);
    const amount = Number(adv.amount || 0);

    const payload = {
      DocType: "rCustomer",
      CardCode: adv.supplier_card_code,
      DocDate: dataRecebimento,
      TransferDate: dataRecebimento,
      TransferAccount: contaCodigo,
      TransferSum: amount,
      BPLID: bplId,
      PaymentInvoices: [{
        DocEntry: Number(adv.sap_doc_entry),
        SumApplied: amount,
        InvoiceType: "it_DownPayment",
      }],
    };

    const resp = await fetch(`${baseUrl}/IncomingPayments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

    if (!resp.ok) {
      const msg = resp.status === 401
        ? "O SAP rejeitou a sessão atual. Faça login no SAP novamente e repita a reconciliação."
        : extractSapError(parsed, "SAP recusou a reconciliação do adiantamento.");
      await sb.from("advance_payments").update({ reconciliation_error: msg }).eq("id", advanceId);
      return json(200, { ok: false, errorMessage: msg });
    }

    const sapDocEntry = parsed && typeof parsed === "object" && typeof (parsed as { DocEntry?: unknown }).DocEntry === "number"
      ? (parsed as { DocEntry: number }).DocEntry
      : null;

    await sb.from("advance_payments").update({
      reconciliation_date: dataRecebimento,
      reconciliation_account_code: contaCodigo,
      reconciliation_account_name: contaNome,
      reconciled_at: new Date().toISOString(),
      reconciled_by: userId,
      reconciliation_error: null,
      sap_incoming_payment_doc_entry: sapDocEntry,
    }).eq("id", advanceId);

    return json(200, { ok: true, sapDocEntry });
  } catch (e) {
    return json(500, { ok: false, errorMessage: (e as Error).message || "Falha ao reconciliar adiantamento." });
  }
});
