// Reenvio pontual do aviso "documento aguardando aprovação".
// Uso administrativo/automação: documentos que ficaram pendentes sem nenhum
// aviso (ex.: falha no disparo durante a submissão) podem ser notificados
// novamente sem alterar o fluxo de aprovação.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { notifyApprovalPending } from "../_shared/approval-notify.ts";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-scheduler-secret, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método não suportado" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const auth = await requireSchedulerOrAdmin(req, admin, corsHeaders);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Corpo inválido" });
  }

  const rawIds = (body as { expense_ids?: unknown })?.expense_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 50) {
    return json(400, { error: "expense_ids deve ser uma lista com 1 a 50 identificadores" });
  }
  const ids = rawIds.map((v) => String(v)).filter((v) => UUID_RE.test(v));
  if (ids.length !== rawIds.length) return json(400, { error: "expense_ids contém identificador inválido" });

  const { data, error } = await admin
    .from("expenses")
    .select(
      "id, company_db, doc_type, status, current_approver, current_level_order, approval_rule_id, requester_name, supplier_name, supplier_code, total_amount, currency, cost_center, project",
    )
    .in("id", ids);
  if (error) return json(500, { error: `Falha ao carregar documentos: ${error.message}` });

  const results: Array<{ id: string; status: string; detail?: string }> = [];

  for (const expense of (data || []) as Record<string, unknown>[]) {
    const id = String(expense.id);
    if (String(expense.status) !== "pendente_aprovacao") {
      results.push({ id, status: "skipped", detail: `status ${String(expense.status)}` });
      continue;
    }
    const approverName = String(expense.current_approver ?? "").trim();
    if (!approverName) {
      results.push({ id, status: "skipped", detail: "sem aprovador definido" });
      continue;
    }

    let approverEmail: string | null = null;
    if (expense.approval_rule_id) {
      const { data: levels } = await admin
        .from("approval_rule_levels")
        .select("approver_name, approver_email, level_order")
        .eq("rule_id", expense.approval_rule_id);
      const target = (levels || []).find(
        (l: Record<string, unknown>) =>
          String(l.approver_name ?? "").trim().toLowerCase() === approverName.toLowerCase(),
      );
      approverEmail = (target?.approver_email as string | undefined)?.trim() || null;
    }

    try {
      await notifyApprovalPending(admin, {
        expenseId: id,
        companyDb: String(expense.company_db ?? ""),
        approverEmail,
        approverName,
        levelOrder: Number(expense.current_level_order ?? 1),
        requesterName: (expense.requester_name as string) ?? null,
        supplierName: (expense.supplier_name as string) || (expense.supplier_code as string) || null,
        totalAmount: Number(expense.total_amount ?? 0),
        currency: (expense.currency as string) || "BRL",
        docType: String(expense.doc_type ?? "purchase"),
        resolution: {
          source: "matrix_rule",
          reason: "Reenvio manual do aviso de documento pendente",
          ruleId: (expense.approval_rule_id as string) ?? null,
          costCenter: (expense.cost_center as string) ?? null,
          project: (expense.project as string) ?? null,
          metadata: { via: "notify-pending-resend" },
        },
      });
      results.push({ id, status: "notified" });
    } catch (e) {
      results.push({ id, status: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  const missing = ids.filter((id) => !results.some((r) => r.id === id));
  for (const id of missing) results.push({ id, status: "not_found" });

  return json(200, { ok: true, results });
});
