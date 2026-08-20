// Retorna o status de integração e as marcações de não-dedutibilidade
// para um conjunto de transações PagCorp — sem depender de acesso anon
// às tabelas `pagcorp_integration_log`, `pagcorp_nondeductible_cards`
// e `pagcorp_nondeductible_expenses`.
//
// Exige sessão SAP (headers x-sap-*) OU JWT do Lovable Cloud. Usa
// service_role no servidor para ler as tabelas, então a chave `anon`
// pode ser bloqueada dessas tabelas sem quebrar a UI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUserOrSapSessionHeaders, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  companyDb?: string;
  expenseIds?: (number | string)[];
  classification?: {
    expenseId?: number | string;
    status?: "processing" | "completed" | "error";
    hasFiscalDocument?: boolean | null;
    documentKinds?: string[];
    confidence?: number | null;
    errorMessage?: string | null;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function materialSapDoc(row: Record<string, unknown>): { docEntry: number | null; docNum: number | null } {
  const response = asRecord(row.sap_response);
  const purchaseOrder = asRecord(response.purchase_order);
  const docEntry =
    asNumber(row.sap_doc_entry) ||
    asNumber(purchaseOrder.DocEntry) ||
    asNumber(response.DocEntry) ||
    asNumber(response.docEntry);
  const docNum =
    asNumber(row.sap_doc_num) ||
    asNumber(purchaseOrder.DocNum) ||
    asNumber(response.DocNum) ||
    asNumber(response.docNum);
  return { docEntry, docNum };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    await requireUserOrSapSessionHeaders(req);
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    return new Response(JSON.stringify({ error: "Não autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const companyDb = (body.companyDb || "").trim();
  if (!companyDb) {
    return new Response(JSON.stringify({ error: "companyDb obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Sanitiza e limita o batch (evita consultas descontroladas)
  const rawIds = Array.isArray(body.expenseIds) ? body.expenseIds : [];
  const expenseIds = Array.from(
    new Set(
      rawIds
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && !Number.isNaN(n)),
    ),
  ).slice(0, 5000);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (body.classification) {
      const expenseId = Number(body.classification.expenseId);
      if (!Number.isFinite(expenseId)) throw new Error("classification.expenseId inválido");
      const status = body.classification.status || "processing";
      const { data, error } = await admin
        .from("pagcorp_document_classification")
        .upsert({
          company_db: companyDb,
          pagcorp_expense_id: expenseId,
          status,
          has_fiscal_document: body.classification.hasFiscalDocument ?? null,
          document_kinds: body.classification.documentKinds || [],
          confidence: body.classification.confidence ?? null,
          error_message: body.classification.errorMessage ?? null,
          analyzed_at: status === "completed" || status === "error" ? new Date().toISOString() : null,
        }, { onConflict: "company_db,pagcorp_expense_id" })
        .select("*")
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ classification: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Logs de integração materialmente concluídos para essas expenses NA EMPRESA.
    // Alguns fluxos antigos marcavam `status=error` depois de o SAP já ter
    // criado o pedido/anexo (falha em etapa tardia como audit/notify/backfill).
    // Para status de tela, DocEntry real prevalece sobre o status textual antigo.
    let integrations: any[] = [];
    if (expenseIds.length > 0) {
      const { data, error } = await admin
        .from("pagcorp_integration_log")
        .select(
          "pagcorp_expense_id, id, status, integration_type, pagcorp_data, sap_doc_num, sap_doc_entry, sap_payload, sap_response, settlement_status, settlement_payment_doc_num, settlement_error, created_at",
        )
        .eq("company_db", companyDb)
        .in("pagcorp_expense_id", expenseIds)
        // Uma transação pode ter N pedidos (fornecedores diferentes no mesmo
        // comprovante) — devolvemos todos, do mais antigo para o mais novo.
        .order("created_at", { ascending: true });
      if (error) throw error;
      integrations = (data || [])
        .map((row: Record<string, unknown>) => {
          const doc = materialSapDoc(row);
          if (row.status !== "success" && !doc.docEntry) return null;
          return {
            ...row,
            status: "success",
            sap_doc_entry: doc.docEntry,
            sap_doc_num: doc.docNum,
          };
        })
        .filter(Boolean);
    }

    // 1b. Relações reais no SAP (NF de entrada e pagamento) por pedido —
    // cobre documentos lançados/baixados manualmente fora do ERP Flow.
    let relations: any[] = [];
    if (integrations.length > 0) {
      const logIds = integrations.map((l: any) => l.id);
      const { data: rel, error: relErr } = await admin
        .from("pagcorp_document_relations")
        .select("pagcorp_log_id, nf_found, payment_found, nf_doc_entries, payment_doc_entries")
        .in("pagcorp_log_id", logIds);
      if (relErr) throw relErr;
      relations = rel || [];

    }

    // 2. Cartões marcados como não-dedutíveis (por company_db).
    const { data: ndCards, error: ndCardsErr } = await admin
      .from("pagcorp_nondeductible_cards")
      .select("card_identifier, supplier_code, supplier_name")
      .eq("company_db", companyDb);
    if (ndCardsErr) throw ndCardsErr;

    // 3. Overrides por expense.
    let ndExpenses: any[] = [];
    if (expenseIds.length > 0) {
      const { data, error } = await admin
        .from("pagcorp_nondeductible_expenses")
        .select("pagcorp_expense_id, supplier_code, supplier_name")
        .eq("company_db", companyDb)
        .in("pagcorp_expense_id", expenseIds);
      if (error) throw error;
      ndExpenses = data || [];
    }

    let classifications: any[] = [];
    if (expenseIds.length > 0) {
      const { data, error } = await admin
        .from("pagcorp_document_classification")
        .select("pagcorp_expense_id,status,has_fiscal_document,document_kinds,confidence,error_message,analyzed_at")
        .eq("company_db", companyDb)
        .in("pagcorp_expense_id", expenseIds);
      if (error) throw error;
      classifications = data || [];
    }

    return new Response(
      JSON.stringify({
        integrations,
        relations,

        nondeductibleCards: ndCards || [],
        nondeductibleExpenses: ndExpenses,
        classifications,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[pagcorp-integration-status] error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
