import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { parseSapHeaders, requireUser, validateSapSession } from "../_shared/auth.ts";
import { notifySalesMilestone } from "../_shared/sales-notify.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BaixaInput = {
  companyDb: string;
  cardCode: string;
  cardName?: string | null;
  dataRecebimento: string;
  contaContabilCodigo: string;
  contaContabilNome?: string | null;
  contaJurosMultaCodigo?: string | null;
  contaJurosMultaNome?: string | null;
  valorTotal: number;
  valorJurosMulta?: number;
  itens: Array<{
    invoiceDocEntry: number;
    invoiceDocNum?: string | number | null;
    valorBaixado: number;
    invoiceType?: "invoice" | "journal_entry";
    invoiceDocLine?: number | null;
  }>;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getSapBaseUrl(companyDB: string): Promise<string> {
  const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") || "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
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
    : fallback;
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

function extractSapError(payload: unknown, fallback: string): string {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload || fallback;
  if (typeof payload !== "object") return fallback;
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

function validateInput(input: BaixaInput, sessionCompanyDb: string): string | null {
  if (!input || typeof input !== "object") return "Dados da baixa inválidos.";
  if (input.companyDb !== sessionCompanyDb) return "Empresa da baixa não corresponde à sessão SAP.";
  if (!input.cardCode?.trim()) return "Cliente obrigatório.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dataRecebimento || "")) return "Data de recebimento inválida.";
  if (!input.contaContabilCodigo?.trim()) return "Conta contábil de recebimento obrigatória.";
  if (!Number.isFinite(Number(input.valorTotal)) || Number(input.valorTotal) <= 0) return "Valor recebido inválido.";
  if (!Array.isArray(input.itens) || input.itens.length === 0) return "Informe ao menos uma NF para baixa.";
  for (const item of input.itens) {
    if (!Number.isFinite(Number(item.invoiceDocEntry)) || Number(item.invoiceDocEntry) <= 0) return "NF inválida no rateio.";
    if (!Number.isFinite(Number(item.valorBaixado)) || Number(item.valorBaixado) <= 0) return "Valor do rateio inválido.";
  }
  return null;
}

function buildIncomingPayment(
  baixa: Record<string, unknown>,
  itens: Array<Record<string, unknown>>,
  bplId: number,
) {
  const excedente = Number(baixa.valor_juros_multa || 0);
  const payload: Record<string, unknown> = {
    DocType: "rCustomer",
    CardCode: baixa.card_code,
    DocDate: baixa.data_recebimento,
    TransferDate: baixa.data_recebimento,
    TransferAccount: baixa.conta_contabil_codigo,
    TransferSum: Number(baixa.valor_total),
    BPLID: bplId,
    PaymentInvoices: itens.map((it) => {
      const type = String(it.invoice_type || "invoice");
      const isJE = type === "journal_entry";
      const entry: Record<string, unknown> = {
        DocEntry: Number(it.invoice_doc_entry),
        SumApplied: Number(it.valor_baixado),
        InvoiceType: isJE ? "it_JournalEntry" : "it_Invoice",
      };
      if (isJE) entry.DocLine = Number(it.invoice_doc_line || 0);
      return entry;
    }),
  };

  if (excedente > 0 && baixa.conta_juros_multa_codigo) {
    payload.PaymentAccounts = [{
      AccountCode: baixa.conta_juros_multa_codigo,
      SumPaid: excedente,
    }];
  }
  return payload;
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

async function fetchInvoiceBplId(
  baseUrl: string,
  cookie: string,
  docEntry: number,
): Promise<number | null> {
  try {
    const r = await fetch(`${baseUrl}/Invoices(${docEntry})?$select=BPL_IDAssignedToInvoice`, {
      headers: { Cookie: cookie },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null) as { BPL_IDAssignedToInvoice?: unknown } | null;
    const v = Number(j?.BPL_IDAssignedToInvoice);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

async function syncExistingBaixa(baixaId: string, headers: ReturnType<typeof parseSapHeaders>) {
  if (!headers) return json(401, { ok: false, errorMessage: "Sessão SAP inválida." });
  const sb = adminClient();
  const { data: baixa, error: baixaErr } = await sb
    .from("baixas_recebimento")
    .select("*")
    .eq("id", baixaId)
    .maybeSingle();

  if (baixaErr || !baixa) {
    return json(404, { ok: false, baixaId, errorMessage: baixaErr?.message || "Baixa não encontrada." });
  }
  if (baixa.company_db !== headers.companyDB) {
    return json(403, { ok: false, baixaId, errorMessage: "Baixa pertence a outra empresa." });
  }
  if (baixa.status === "sincronizado" && baixa.sap_incoming_payment_doc_entry) {
    return json(200, { ok: true, baixaId, sapDocEntry: baixa.sap_incoming_payment_doc_entry });
  }

  const { data: itens, error: itensErr } = await sb
    .from("baixas_recebimento_itens")
    .select("invoice_doc_entry,valor_baixado,invoice_type,invoice_doc_line")
    .eq("baixa_id", baixaId);
  if (itensErr || !itens?.length) {
    const msg = itensErr?.message || "Baixa sem itens.";
    await sb.from("baixas_recebimento").update({ status: "erro", sap_error_message: msg }).eq("id", baixaId);
    return json(200, { ok: false, baixaId, errorMessage: msg });
  }

  const baseUrl = await getSapBaseUrl(headers.companyDB);
  const cookie = `B1SESSION=${headers.sapSession}${headers.routeId ? `; ROUTEID=${headers.routeId}` : ""}`;

  // Filial (BPLId): tenta uma NF real do rateio; se todos os itens forem SI (JournalEntry)
  // ou a consulta falhar, cai para default_branch_id do system_credentials (fallback 1).
  const firstInvoice = (itens as Array<{ invoice_doc_entry: number; invoice_type?: string }>)
    .find((it) => (it.invoice_type || "invoice") === "invoice");
  const invoiceBpl = firstInvoice
    ? await fetchInvoiceBplId(baseUrl, cookie, Number(firstInvoice.invoice_doc_entry))
    : null;
  const bplId = invoiceBpl ?? await resolveDefaultBranchId(headers.companyDB);

  const sapResp = await fetch(`${baseUrl}/IncomingPayments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(buildIncomingPayment(baixa as Record<string, unknown>, itens as Array<Record<string, unknown>>, bplId)),
  });
  const text = await sapResp.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  if (!sapResp.ok) {
    const sessionExpired = sapResp.status === 401;
    const msg = sessionExpired
      ? "O SAP rejeitou a sessão atual ao criar o recebimento. Faça login no SAP novamente e reenvie esta baixa."
      : extractSapError(payload, "SAP recusou a criação do recebimento.");
    await sb.from("baixas_recebimento").update({ status: "erro", sap_error_message: msg }).eq("id", baixaId);
    return json(200, { ok: false, baixaId, sapDocEntry: null, errorMessage: msg, sapStatus: sapResp.status });
  }

  const sapDocEntry = payload && typeof payload === "object" && typeof (payload as { DocEntry?: unknown }).DocEntry === "number"
    ? (payload as { DocEntry: number }).DocEntry
    : null;
  await sb.from("baixas_recebimento").update({
    status: "sincronizado",
    sap_incoming_payment_doc_entry: sapDocEntry,
    sap_error_message: null,
  }).eq("id", baixaId);

  const b = baixa as Record<string, unknown>;
  await notifySalesMilestone(sb, {
    milestone: "nfse_settled",
    companyDb: headers.companyDB,
    refId: baixaId,
    link: "/vendas/recebimentos",
    summary: "Uma baixa de recebimento foi registrada no ERP.",
    details: [
      { label: "Cliente", value: (b.card_name as string) || (b.card_code as string) },
      { label: "Valor", value: `BRL ${Number(b.valor_total || 0).toFixed(2)}` },
      { label: "Data", value: b.data_recebimento as string },
      { label: "Documento SAP", value: sapDocEntry },
      { label: "Empresa", value: headers.companyDB },
      { label: "Usuário", value: (b.criado_por_nome as string) || (b.criado_por_user_code as string) },
    ],
  });

  return json(200, { ok: true, baixaId, sapDocEntry });
}

Deno.serve(withEdgeMetrics("baixa-recebimento", async (req, _mctx) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, errorMessage: "Método não permitido." });

  try {
    const headers = parseSapHeaders(req);
    const sap = await validateSapSession(req);
    if (!headers || !sap) {
      return json(401, {
        ok: false,
        errorMessage: "Sessão SAP inválida ou expirada. Faça login no SAP novamente para lançar a baixa.",
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "syncExisting") {
      const baixaId = String(body.baixaId || "").trim();
      if (!baixaId) return json(400, { ok: false, errorMessage: "ID da baixa obrigatório." });
      return await syncExistingBaixa(baixaId, headers);
    }

    if (action === "createAndSync") {
      const input = body.input as BaixaInput;
      const validation = validateInput(input, sap.companyDB);
      if (validation) return json(400, { ok: false, errorMessage: validation });

      const sb = adminClient();
      let criadoPor: string | null = null;
      try {
        const cloudUser = await requireUser(req);
        criadoPor = cloudUser.id;
      } catch {
        // A baixa continua permitida para sessão SAP válida; apenas não haverá
        // vínculo com usuário Cloud para RLS/leitura direta pelo cliente.
      }

      // Nome amigável do usuário SAP: pega de user_profiles pelo user_code+company_db.
      let criadoPorNome: string | null = null;
      try {
        const { data: prof } = await sb
          .from("user_profiles")
          .select("display_name")
          .eq("company_db", sap.companyDB)
          .eq("user_code", sap.userName)
          .maybeSingle();
        criadoPorNome = (prof as { display_name?: string | null } | null)?.display_name || null;
      } catch { /* opcional */ }

      const { data: baixa, error: insertErr } = await sb.from("baixas_recebimento").insert({
        company_db: sap.companyDB,
        card_code: input.cardCode.trim(),
        card_name: input.cardName || null,
        data_recebimento: input.dataRecebimento,
        conta_contabil_codigo: input.contaContabilCodigo.trim(),
        conta_contabil_nome: input.contaContabilNome || null,
        conta_juros_multa_codigo: input.contaJurosMultaCodigo || null,
        conta_juros_multa_nome: input.contaJurosMultaNome || null,
        valor_total: Number(input.valorTotal),
        valor_juros_multa: Number(input.valorJurosMulta || 0),
        status: "pendente_sincronizacao",
        criado_por: criadoPor,
        criado_por_user_code: sap.userName,
        criado_por_nome: criadoPorNome,
      }).select("id").single();
      if (insertErr || !baixa) return json(500, { ok: false, errorMessage: insertErr?.message || "Falha ao gravar baixa." });

      const baixaId = baixa.id as string;
      const itensPayload = input.itens.map((it) => ({
        baixa_id: baixaId,
        invoice_doc_entry: Number(it.invoiceDocEntry),
        invoice_doc_num: it.invoiceDocNum != null ? String(it.invoiceDocNum) : null,
        valor_baixado: Number(it.valorBaixado),
        invoice_type: it.invoiceType === "journal_entry" ? "journal_entry" : "invoice",
        invoice_doc_line: it.invoiceType === "journal_entry" ? Number(it.invoiceDocLine || 0) : null,
      }));
      const { error: itemErr } = await sb.from("baixas_recebimento_itens").insert(itensPayload);
      if (itemErr) {
        await sb.from("baixas_recebimento").update({ status: "erro", sap_error_message: itemErr.message }).eq("id", baixaId);
        return json(500, { ok: false, baixaId, errorMessage: itemErr.message });
      }

      return await syncExistingBaixa(baixaId, headers);
    }

    return json(400, { ok: false, errorMessage: "Ação inválida." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao lançar baixa.";
    // Best-effort: enqueue for visibility in the retry panel (auto-retry disabled
    // for baixa since it needs a live SAP session — admin retries via UI).
    try {
      const body = await req.clone().json().catch(() => ({}));
      const baixaId = String((body?.baixaId ?? body?.input?.id) || "");
      if (baixaId) {
        const sb = adminClient();
        const { classifyAndEnqueue } = await import("../_shared/sap-retry.ts");
        await classifyAndEnqueue(sb, {
          doc_type: "baixa",
          ref_id: baixaId,
          errorBody: msg,
        });
      }
    } catch (_) { /* silent */ }
    return json(500, { ok: false, errorMessage: msg });
  }
}));