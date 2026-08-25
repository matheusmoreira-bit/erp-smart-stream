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
    integration_log_id?: string;
    source?: "purchase" | "sales" | "pagcorp";
    action?: "dispatch" | "retry" | "cancel" | "list";
  };
  const action = String(body.action || "").trim().toLowerCase();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const callerCompany = "companyDB" in caller ? caller.companyDB : null;
  const callerUserName = "userName" in caller ? caller.userName : null;
  const actor = caller.email || callerUserName || caller.id || "system:integration-control";

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

  if (action === "retry" && body.source === "pagcorp") {
    const logId = String(body.integration_log_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(logId)) return json(400, { error: "integration_log_id inválido" });

    const { data: log, error: logError } = await admin
      .from("pagcorp_integration_log")
      .select("id, company_db, pagcorp_expense_id, status, sap_doc_entry, sap_doc_num, sap_response")
      .eq("id", logId)
      .maybeSingle();
    if (logError) return json(500, { error: logError.message });
    if (!log) return json(404, { error: "Integração PagCorp não encontrada" });
    if (callerCompany && callerCompany !== log.company_db) {
      return json(403, { error: "A integração pertence a outra empresa" });
    }

    const refId = String(log.pagcorp_expense_id);
    const { data: successful } = await admin
      .from("pagcorp_integration_log")
      .select("sap_doc_entry, sap_doc_num")
      .eq("company_db", log.company_db)
      .eq("pagcorp_expense_id", log.pagcorp_expense_id)
      .eq("status", "success")
      .not("sap_doc_entry", "is", null)
      .limit(1)
      .maybeSingle();
    if (log.sap_doc_entry || successful?.sap_doc_entry) {
      return json(200, {
        success: true,
        action,
        alreadyIntegrated: true,
        sapDocEntry: log.sap_doc_entry || successful?.sap_doc_entry,
        sapDocNum: log.sap_doc_num || successful?.sap_doc_num,
      });
    }

    const { data: queueRows, error: queueError } = await admin
      .from("sap_retry_queue")
      .select("id, status, payload, last_attempt_at")
      .in("doc_type", ["pagcorp", "synapse_pagcorp"])
      .eq("ref_id", refId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (queueError) return json(500, { error: queueError.message });

    let queueRow = Array.isArray(queueRows) ? queueRows[0] : null;
    if (queueRow?.status === "in_flight") {
      const lastAttempt = queueRow.last_attempt_at ? Date.parse(String(queueRow.last_attempt_at)) : Date.now();
      if (!Number.isFinite(lastAttempt) || lastAttempt > Date.now() - 10 * 60_000) {
        return json(200, { success: true, action, alreadyProcessing: true });
      }
    }

    if (!queueRow) {
      const responseData = log.sap_response && typeof log.sap_response === "object"
        ? log.sap_response as Record<string, unknown>
        : {};
      const retryRequest = responseData.retry_request;
      if (!retryRequest || typeof retryRequest !== "object") {
        return json(409, {
          error: "Esta tentativa antiga não possui o payload necessário para retry. Refaça a integração pela tela do PagCorp.",
        });
      }
      const { data: inserted, error: insertError } = await admin
        .from("sap_retry_queue")
        .insert({
          doc_type: "pagcorp",
          ref_id: refId,
          company_db: log.company_db,
          payload: { __endpoint: "pagcorp-to-sap", __body: retryRequest },
          status: "pending",
          attempts: 0,
          next_attempt_at: new Date().toISOString(),
          last_error: "Retry manual solicitado no monitor de integrações",
          error_category: "other",
        })
        .select("id, status, payload, last_attempt_at")
        .single();
      if (insertError) {
        if (insertError.code === "23505") {
          return json(200, { success: true, action, alreadyProcessing: true });
        }
        return json(500, { error: insertError.message });
      }
      queueRow = inserted;
    } else {
      const { error: requeueError } = await admin
        .from("sap_retry_queue")
        .update({
          status: "pending",
          attempts: 0,
          next_attempt_at: new Date().toISOString(),
          notified_exhausted_at: null,
        })
        .eq("id", queueRow.id)
        .neq("status", "in_flight");
      if (requeueError) return json(500, { error: requeueError.message });
    }
    if (!queueRow?.id) return json(500, { error: "Não foi possível preparar a fila de retry" });

    const workerResponse = await fetch(`${supabaseUrl}/functions/v1/sap-retry-worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ source: "integration_monitor", queue_id: queueRow.id }),
    });
    if (!workerResponse.ok) {
      const workerResult = await workerResponse.json().catch(() => ({}));
      return json(502, { error: workerResult?.error || "Falha ao acionar o worker de retry" });
    }

    await admin.rpc("insert_audit_log", {
      p_action: "pagcorp_integration_retry_requested",
      p_entity_type: "pagcorp_transaction",
      p_entity_id: refId,
      p_actor_email: actor,
      p_company_db: log.company_db,
      p_details: { actor, source: "integration_monitor", integration_log_id: logId, queue_id: queueRow.id },
    });
    return json(200, { success: true, action, queued: true, queueId: queueRow.id });
  }

  const expenseId = String(body.expense_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(expenseId)) return json(400, { error: "expense_id inválido" });
  if (action !== "dispatch" && action !== "retry" && action !== "cancel") {
    return json(400, { error: "action deve ser dispatch, retry, cancel ou list" });
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
  if (expense.sap_doc_entry) {
    return json(200, {
      success: true,
      action,
      alreadyIntegrated: true,
      message: `Pedido já integrado${expense.sap_doc_num ? ` no documento #${expense.sap_doc_num}` : ""}`,
    });
  }
  if (expense.status !== "aprovado") {
    return json(409, { error: `Pedido não está aprovado (status: ${expense.status})` });
  }
  if (isNativeErpExpenseOrigin(expense.origin)) {
    return json(409, { error: "Pedido originado no ERP; novo dispatch criaria duplicidade" });
  }

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
      .update({ status: "cancelled", last_error: `Substituído por ${action} manual de ${actor}` })
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
    p_action: success
      ? (action === "retry" ? "expense_integration_retry_requested" : "expense_integration_dispatched")
      : (action === "retry" ? "expense_integration_retry_failed" : "expense_integration_dispatch_failed"),
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
