// build: 1789800600
// Rede de segurança: devolve ao solicitante todo documento que entrou em
// aprovação SEM nenhum anexo efetivamente gravado (o arquivo é enviado depois
// da criação e pode falhar / a aba pode ser fechada no meio).
//
// POST /functions/v1/expense-attachment-sweeper
// Body opcional: { dry_run?: boolean, grace_minutes?: number, limit?: number }
// Auth: scheduler (x-scheduler-secret) ou admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { notifyActionCompleted } from "../_shared/action-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
};

const RETURN_NOTE =
  "DEVOLVIDO ao solicitante: documento sem anexo salvo. Anexe o documento fiscal e envie novamente para aprovação.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = Boolean((body as { dry_run?: boolean }).dry_run);
  const graceMinutes = Math.min(Math.max(Number((body as { grace_minutes?: number }).grace_minutes ?? 10), 1), 1440);
  const limit = Math.min(Math.max(Number((body as { limit?: number }).limit ?? 50), 1), 200);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - graceMinutes * 60_000).toISOString();

  const { data: candidates, error: qErr } = await admin
    .from("expenses")
    .select(
      "id, status, doc_type, origin, remarks, requester_name, requester_email, supplier_name, total_amount, currency, company_db, created_at",
    )
    .in("status", ["pendente_aprovacao", "aprovado"])
    .is("sap_doc_entry", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit * 4);

  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (candidates || []).filter(
    (e) =>
      String(e.doc_type || "purchase").toLowerCase() !== "sales" &&
      String(e.origin || "").toLowerCase() !== "uber",
  );

  const returned: string[] = [];
  for (const exp of rows) {
    if (returned.length >= limit) break;
    const { count, error: cErr } = await admin
      .from("expense_attachments")
      .select("id", { count: "exact", head: true })
      .eq("expense_id", exp.id);
    if (cErr || (count ?? 0) > 0) continue;

    if (dryRun) {
      returned.push(exp.id as string);
      continue;
    }

    const remarks = String(exp.remarks || "").trim();
    const { error: uErr } = await admin
      .from("expenses")
      .update({
        status: "rascunho",
        current_level_order: 1,
        current_approver: null,
        remarks: remarks ? `${remarks} | ${RETURN_NOTE}` : RETURN_NOTE,
      })
      .eq("id", exp.id)
      .in("status", ["pendente_aprovacao", "aprovado"]);
    if (uErr) {
      console.warn("[expense-attachment-sweeper] falha ao devolver", exp.id, uErr.message);
      continue;
    }

    await admin
      .from("expense_approval_segments")
      .update({
        status: "bloqueado",
        current_approver: null,
        current_approver_email: null,
        decided_by: "sistema",
        decided_at: new Date().toISOString(),
        resolution_note: "Devolvida ao solicitante: documento sem anexo salvo.",
      })
      .eq("expense_id", exp.id)
      .eq("status", "pendente");

    await admin.from("expense_approval_log").insert({
      expense_id: exp.id,
      decision: "returned",
      approver_name: "Sistema",
      approver_email: null,
      level_order: 1,
      remarks: RETURN_NOTE,
    } as any);

    try {
      await notifyActionCompleted(admin, {
        actionKey: "approval",
        refId: `${exp.id}:returned_no_attachment:${Date.now()}`,
        recipient: (exp.requester_email as string) || (exp.requester_name as string),
        companyDb: exp.company_db as string,
        title: "Documento devolvido: falta o anexo",
        summary:
          "O documento voltou para rascunho porque nenhum arquivo foi salvo. Anexe o documento fiscal e envie novamente para aprovação.",
        link: "/compras",
        details: [
          { label: "Fornecedor/Cliente", value: String(exp.supplier_name || "-") },
          {
            label: "Valor",
            value: `${exp.currency || "BRL"} ${Number(exp.total_amount || 0).toFixed(2)}`,
          },
          { label: "Empresa", value: String(exp.company_db || "-") },
        ],
      });
    } catch (e) {
      console.warn("[expense-attachment-sweeper] falha ao notificar", exp.id, (e as Error)?.message);
    }

    returned.push(exp.id as string);
  }

  return new Response(
    JSON.stringify({ ok: true, dry_run: dryRun, grace_minutes: graceMinutes, returned_count: returned.length, returned }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
