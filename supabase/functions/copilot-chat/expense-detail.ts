import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// The caller retains the existing administrator/MFA checks and client scope.
export async function readExpenseDetail(sb: SupabaseClient, id: string) {
  const results = await Promise.all([
    sb.from("expenses").select("*").eq("id", id).maybeSingle(),
    sb.from("expense_items").select("*").eq("expense_id", id).order("created_at"),
    sb.from("expense_approval_log").select("*").eq("expense_id", id).order("created_at"),
    sb.from("expense_attachments").select("id, file_name, file_size, mime_type, created_at").eq("expense_id", id),
  ]);
  const sources = ["pedido", "itens", "histórico de aprovação", "anexos"];
  for (const [index, result] of results.entries()) {
    if (result.error) {
      // Do not misrepresent a failed query as missing items or attachments.
      throw new Error(`Falha ao consultar ${sources[index]} do pedido (${result.error.code || "erro de leitura"}).`);
    }
  }
  const [expense, items, history, attachments] = results;
  return {
    expense: expense.data,
    items: items.data,
    history: history.data,
    attachments: attachments.data,
  };
}