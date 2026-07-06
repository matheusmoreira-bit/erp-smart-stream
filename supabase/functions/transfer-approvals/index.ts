// Reatribui aprovações pendentes de despesas do ERP Flow (tabela `expenses`)
// de um aprovador para outro dentro de uma company_db, opcionalmente
// filtrando por centro de custo. Cria notificação in-app para o novo
// aprovador e registra audit_log. Apenas admins podem invocar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdmin, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const norm = (v: string | null | undefined) => (v || "").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let caller;
  try { caller = await requireAdmin(req); }
  catch (e) { return authErrorResponse(e, corsHeaders); }

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db || "").trim();
    const fromUser = String(body.from_user_code || "").trim();
    const toUser = String(body.to_user_code || "").trim();
    const costCenter = String(body.cost_center || "").trim();
    const dryRun = body.dry_run !== false;
    const reason = String(body.reason || "Transferência administrativa de aprovações pendentes").slice(0, 500);

    if (!companyDb || !toUser) {
      return new Response(JSON.stringify({ error: "company_db e to_user_code são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!fromUser && !costCenter) {
      return new Response(JSON.stringify({ error: "informe from_user_code e/ou cost_center como filtro" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (fromUser && norm(fromUser) === norm(toUser)) {
      return new Response(JSON.stringify({ error: "from_user_code e to_user_code devem ser diferentes" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Fetch pending expenses for the company
    let q = sb.from("expenses")
      .select("id, current_approver, requester_name, requester_email, total_amount, cost_center, doc_type, status, company_db")
      .eq("company_db", companyDb)
      .eq("status", "pendente_aprovacao");
    if (costCenter) q = q.eq("cost_center", costCenter);

    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw new Error(rowsErr.message);

    const matches = (rows || []).filter((r) => {
      if (!fromUser) return true;
      return norm(r.current_approver) === norm(fromUser);
    });

    const results: any = {
      dryRun,
      filter: { fromUser: fromUser || null, costCenter: costCenter || null },
      toUser,
      totalCandidates: rows?.length ?? 0,
      transferred: [] as any[],
      skipped: [] as any[],
      errors: [] as any[],
    };

    // Nothing to do?
    if (matches.length === 0) {
      results.skipped = (rows || []).map((r) => ({
        id: r.id, current_approver: r.current_approver,
        reason: fromUser ? "não pertence ao aprovador de origem" : "sem filtro correspondente",
      }));
      return new Response(JSON.stringify(results), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const r of matches) {
      try {
        if (norm(r.current_approver) === norm(toUser)) {
          results.skipped.push({ id: r.id, reason: "já pertence ao destino" });
          continue;
        }
        if (dryRun) {
          results.transferred.push({
            id: r.id, previousApprover: r.current_approver, wouldSetApprover: toUser,
            costCenter: r.cost_center, totalAmount: r.total_amount, requester: r.requester_name,
          });
          continue;
        }

        const { error: updErr } = await sb.from("expenses")
          .update({ current_approver: toUser, updated_at: new Date().toISOString() })
          .eq("id", r.id)
          .eq("status", "pendente_aprovacao"); // guard against concurrent state change
        if (updErr) throw new Error(updErr.message);

        // In-app notification for the new approver
        const toIdentifier = norm(toUser).replace(/\s+/g, ".");
        await sb.from("notifications").insert({
          user_identifier: toIdentifier,
          title: "Aprovação transferida para você",
          body: `Uma despesa ${r.doc_type ?? ""} de ${r.requester_name ?? "solicitante"} (R$ ${Number(r.total_amount || 0).toLocaleString("pt-BR")}) foi transferida para você${r.cost_center ? ` — CC ${r.cost_center}` : ""}.`,
          category: "approval",
          company_db: companyDb,
          link: "/aprovacoes",
          metadata: {
            expenseId: r.id,
            costCenter: r.cost_center,
            totalAmount: r.total_amount,
            transferredFrom: r.current_approver,
            transferredBy: caller.email || caller.id,
            reason,
          },
        });

        // Audit log
        await sb.from("audit_log").insert({
          actor_id: caller.id,
          actor_email: caller.email,
          action: "transfer_approval",
          entity_type: "expense",
          entity_id: String(r.id),
          company_db: companyDb,
          details: {
            from: r.current_approver, to: toUser,
            costCenter: r.cost_center, totalAmount: r.total_amount,
            requester: r.requester_name, reason,
          },
        });

        // Timeline event on the expense itself (best-effort)
        try {
          await sb.from("expense_approval_log").insert({
            expense_id: r.id,
            company_db: companyDb,
            action: "reassigned",
            actor_email: caller.email,
            approver_name: toUser,
            previous_approver: r.current_approver,
            note: reason,
          } as any);
        } catch { /* table shape may differ — ignore */ }

        results.transferred.push({
          id: r.id, previousApprover: r.current_approver, newApprover: toUser,
          costCenter: r.cost_center, totalAmount: r.total_amount, requester: r.requester_name,
        });
      } catch (e) {
        results.errors.push({ id: r.id, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify(results), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
