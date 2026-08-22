export const MANUAL_EXPENSE_CANCEL_FLAG = "manual_integration_cancelled";

type QueuePayload = Record<string, unknown>;

export interface ManualExpenseCancellation {
  expenseId: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

function asPayload(value: unknown): QueuePayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as QueuePayload
    : {};
}

export function isManualCancellationPayload(value: unknown): boolean {
  return asPayload(value)[MANUAL_EXPENSE_CANCEL_FLAG] === true;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listManualExpenseCancellations(admin: any, expenseIds: string[]) {
  const ids = [...new Set(expenseIds)].slice(0, 500);
  const cancellations = new Map<string, ManualExpenseCancellation>();
  if (ids.length === 0) return cancellations;

  const { data, error } = await admin
    .from("sap_retry_queue")
    .select("ref_id,payload,updated_at")
    .eq("doc_type", "expense")
    .in("ref_id", ids)
    .contains("payload", { [MANUAL_EXPENSE_CANCEL_FLAG]: true })
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Falha ao consultar cancelamentos: ${error.message}`);

  for (const row of data || []) {
    const expenseId = String(row.ref_id || "");
    if (!expenseId || cancellations.has(expenseId)) continue;
    const payload = asPayload(row.payload);
    cancellations.set(expenseId, {
      expenseId,
      cancelledAt: String(payload.cancelled_at || row.updated_at || "") || null,
      cancelledBy: String(payload.cancelled_by || "") || null,
    });
  }
  return cancellations;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isExpenseIntegrationCancelled(admin: any, expenseId: string): Promise<boolean> {
  const rows = await listManualExpenseCancellations(admin, [expenseId]);
  return rows.has(expenseId);
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function markExpenseIntegrationCancelled(admin: any, params: {
  expenseId: string;
  companyDb: string | null;
  actor: string;
  cancelledAt: string;
}): Promise<void> {
  const { data: existing, error: findError } = await admin
    .from("sap_retry_queue")
    .select("id,payload")
    .eq("doc_type", "expense")
    .eq("ref_id", params.expenseId)
    .neq("status", "succeeded")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw new Error(`Falha ao localizar fila da integração: ${findError.message}`);

  const payload = {
    ...asPayload(existing?.payload),
    [MANUAL_EXPENSE_CANCEL_FLAG]: true,
    cancelled_at: params.cancelledAt,
    cancelled_by: params.actor,
  };
  const patch = {
    status: "cancelled",
    payload,
    last_error: `Cancelado manualmente por ${params.actor}`,
  };

  if (existing?.id) {
    const { error } = await admin.from("sap_retry_queue").update(patch).eq("id", existing.id);
    if (error) throw new Error(`Falha ao cancelar fila da integração: ${error.message}`);
    return;
  }

  const { error } = await admin.from("sap_retry_queue").insert({
    doc_type: "expense",
    ref_id: params.expenseId,
    company_db: params.companyDb,
    ...patch,
  });
  if (error) throw new Error(`Falha ao registrar cancelamento: ${error.message}`);
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reactivateExpenseIntegration(admin: any, expenseId: string): Promise<void> {
  const { data, error } = await admin
    .from("sap_retry_queue")
    .select("id,payload")
    .eq("doc_type", "expense")
    .eq("ref_id", expenseId)
    .contains("payload", { [MANUAL_EXPENSE_CANCEL_FLAG]: true });
  if (error) throw new Error(`Falha ao consultar cancelamento: ${error.message}`);

  for (const row of data || []) {
    const payload = {
      ...asPayload(row.payload),
      [MANUAL_EXPENSE_CANCEL_FLAG]: false,
      reactivated_at: new Date().toISOString(),
    };
    const { error: updateError } = await admin
      .from("sap_retry_queue")
      .update({ payload, last_error: "Reativado por dispatch manual" })
      .eq("id", row.id);
    if (updateError) throw new Error(`Falha ao reativar integração: ${updateError.message}`);
  }
}
