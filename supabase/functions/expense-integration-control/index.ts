import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { AuthError, requireAdminOrSapModule } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { isNativeErpExpenseOrigin } from "../_shared/expense-origin.ts";
import {
  listManualExpenseCancellations,
  markExpenseIntegrationCancelled,
  reactivateExpenseIntegration,
} from "../_shared/expense-integration-cancel.ts";
import { releaseIntegrationLock, tryAcquireIntegrationLock } from "../_shared/sap-fetch.ts";

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

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let caller: Awaited<ReturnType<typeof requireAdminOrSapModule>>;
  try {
    caller = await requireAdminOrSapModule(req, "integration_history");
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return json(status, { error: error instanceof Error ? error.message : "Não autorizado" });
  }

  const body = await req.json().catch(() => ({})) as {
    expense_id?: string;
    expense_ids?: string[];
    action?: "dispatch" | "cancel" | "list";
  };
  const action = String(body.action || "").trim().toLowerCase();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const callerCompany = "companyDB" in caller ? caller.companyDB : null;

  if (action === "list") {
    const expenseIds = (Array.isArray(body.expense_ids) ? body.expense_ids : [])
      .map((id) => String(id || "").trim())
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
      .slice(0, 500);
    try {
      const rows = await listManualExpenseCancellations(admin, expenseIds);
      let cancellations = [...rows.values()];
      if (callerCompany && cancellations.length > 0) {
        const { data: allowed, error } = await admin
          .from("expenses")
          .select("id")
          .eq("company_db", callerCompany)
          .in("id", cancellations.map((row) => row.expenseId));
        if (error) return json(500, { error: error.message });
        const allowedIds = new Set((allowed || []).map((row) => String(row.id)));
        cancellations = cancellations.filter((row) => allowedIds.has(row.expenseId));
      }
      return json(200, { success: true, cancellations });
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : "Falha ao consultar cancelamentos" });
    }
  }

  const expenseId = String(body.expense_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(expenseId)) return json(400, { error: "expense_id inválido" });
  if (action !== "dispatch" && action !== "cancel") {
    return json(400, { error: "action deve ser dispatch, cancel ou list" });
  }

  const { data: expense, error: expenseError } = await admin
    .from("expenses")
    .select("id, company_db, status, doc_type, origin, sap_doc_entry, sap_doc_num, sap_integration_locked_at")
    .eq("id", expenseId)
    .maybeSingle();

  if (expenseError) return json(500, { error: expenseError.message });
  if (!expense) return json(404, { error: "Pedido não encontrado" });
  if (callerCompany && callerCompany !== expense.company_db) {
    return json(403, { error: "O pedido pertence a outra empresa" });
  }
  if (expense.doc_type === "sales") {
    return json(409, { error: "Este controle está disponível apenas para pedidos de compra" });
  }
  if (expense.sap_doc_entry) {
    return json(409, {
      error: `Pedido já integrado${expense.sap_doc_num ? ` no documento #${expense.sap_doc_num}` : ""}`,
    });
  }
  if (expense.status !== "aprovado") {
    return json(409, { error: `Pedido não está aprovado (status: ${expense.status})` });
  }
  if (isNativeErpExpenseOrigin(expense.origin)) {
    return json(409, { error: "Pedido originado no ERP; novo dispatch criaria duplicidade" });
  }

  const callerUserName = "userName" in caller ? caller.userName : null;
  const actor = caller.email || callerUserName || caller.id || "system:integration-control";
  const lockAt = expense.sap_integration_locked_at
    ? new Date(expense.sap_integration_locked_at).getTime()
    : 0;
  const hasRecentLock = lockAt > Date.now() - 15 * 60_000;

  if (action === "cancel") {
    if (hasRecentLock) {
      return json(409, { error: "A integração já está em processamento e não pode ser cancelada agora" });
    }

    const acquired = await tryAcquireIntegrationLock(admin, "expenses", expenseId, 15);
    if (!acquired) {
      return json(409, { error: "A integração começou a ser processada. Atualize o monitor e tente novamente." });
    }
    try {
      const now = new Date().toISOString();
      const { data: current, error: currentError } = await admin
        .from("expenses")
        .select("status,sap_doc_entry")
        .eq("id", expenseId)
        .single();
      if (currentError) return json(500, { error: currentError.message });
      if (current.status !== "aprovado" || current.sap_doc_entry) {
        return json(409, { error: "O pedido mudou de status. Atualize o monitor e tente novamente." });
      }

      await admin.from("sap_retry_queue")
        .update({ status: "cancelled", last_error: `Cancelado manualmente por ${actor}` })
        .eq("doc_type", "expense")
        .eq("ref_id", expenseId)
        .in("status", ["pending", "in_flight"]);
      await markExpenseIntegrationCancelled(admin, {
        expenseId,
        companyDb: expense.company_db,
        actor,
        cancelledAt: now,
      });

      await admin.rpc("insert_audit_log", {
        p_action: "expense_integration_cancelled",
        p_entity_type: "expense",
        p_entity_id: expenseId,
        p_actor_email: actor,
        p_company_db: expense.company_db,
        p_details: { actor, source: "integration_monitor" },
      });
      return json(200, { success: true, action, cancelledAt: now });
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : "Falha ao cancelar integração" });
    } finally {
      await releaseIntegrationLock(admin, "expenses", expenseId);
    }
  }

  // Desativa qualquer tentativa concorrente da fila; a chamada abaixo será a
  // única dona do lock de integração. Falhas transitórias reabrem a fila pelo
  // próprio expense-to-sap.
  if (hasRecentLock) {
    return json(200, {
      success: true,
      action,
      alreadyProcessing: true,
      message: "A integração já está em processamento",
    });
  }

  try {
    await reactivateExpenseIntegration(admin, expenseId);
    await admin.from("sap_retry_queue")
      .update({ status: "cancelled", last_error: `Substituído por dispatch manual de ${actor}` })
      .eq("doc_type", "expense")
      .eq("ref_id", expenseId)
      .in("status", ["pending", "in_flight"]);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "Falha ao reativar integração" });
  }

  const clearPatch: Record<string, unknown> = {
    sap_integration_error: null,
    sap_purchase_order_status: "pending",
    sap_integration_last_attempt_at: new Date().toISOString(),
  };
  clearPatch.sap_integration_locked_at = null;
  const { data: reactivatedRows, error: clearError } = await admin.from("expenses")
    .update(clearPatch)
    .eq("id", expenseId)
    .eq("status", "aprovado")
    .is("sap_doc_entry", null)
    .select("id");
  if (clearError) return json(500, { error: clearError.message });
  if (!reactivatedRows?.length) {
    return json(409, { error: "O pedido mudou de status. Atualize o monitor e tente novamente." });
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/expense-to-sap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "x-internal-retry": "1",
    },
    body: JSON.stringify({ expense_id: expenseId, use_service_account: true }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok && result?.alreadyProcessing === true) {
    return json(200, { success: true, action, alreadyProcessing: true, result });
  }
  const success = response.ok && result?.success !== false;

  await admin.rpc("insert_audit_log", {
    p_action: success ? "expense_integration_dispatched" : "expense_integration_dispatch_failed",
    p_entity_type: "expense",
    p_entity_id: expenseId,
    p_actor_email: actor,
    p_company_db: expense.company_db,
    p_details: {
      actor,
      source: "integration_monitor",
      status: response.status,
      error: success ? null : (result?.error || `HTTP ${response.status}`),
    },
  });

  if (!success) {
    return json(502, { success: false, error: result?.error || `Falha no ERP (HTTP ${response.status})` });
  }
  return json(200, { success: true, action, result });
});
