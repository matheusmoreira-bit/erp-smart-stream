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
    // 1. Logs de integração com status success para essas expenses NA EMPRESA.
    let integrations: any[] = [];
    if (expenseIds.length > 0) {
      const { data, error } = await admin
        .from("pagcorp_integration_log")
        .select(
          "pagcorp_expense_id, id, status, sap_doc_num, sap_doc_entry, settlement_status, settlement_payment_doc_num, settlement_error",
        )
        .eq("company_db", companyDb)
        .eq("status", "success")
        .in("pagcorp_expense_id", expenseIds);
      if (error) throw error;
      integrations = data || [];
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

    return new Response(
      JSON.stringify({
        integrations,
        nondeductibleCards: ndCards || [],
        nondeductibleExpenses: ndExpenses,
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
