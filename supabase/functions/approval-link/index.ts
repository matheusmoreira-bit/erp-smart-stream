// Endpoint público das aprovações por link assinado (e-mail / Slack).
//
// Segurança:
//   - O token NUNCA trafega em query string: é enviado no corpo (POST).
//   - Guardamos apenas o hash SHA-256 do token; uso único e expiração curta.
//   - A execução da decisão reusa `expense-approval-action` (todas as regras
//     de alçada, self-approval e auditoria continuam valendo) através de uma
//     chamada interna autenticada com a service role key.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { enforceRateLimit, rateLimitResponse, clientIpFrom } from "../_shared/rate-limit.ts";
import { sha256Hex } from "../_shared/approval-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método não suportado." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const ip = clientIpFrom(req);
  const rl = await enforceRateLimit(admin, {
    scope: "approval-link", identifier: ip, max: 30, windowSeconds: 60,
  });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  let body: any = {};
  try { body = await req.json(); } catch { return json(400, { error: "Corpo inválido." }); }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const action = typeof body.action === "string" ? body.action : "info";
  const remarks = typeof body.remarks === "string" ? body.remarks.slice(0, 500) : "";
  if (!token || token.length < 20 || token.length > 200) {
    return json(400, { error: "Link inválido." });
  }
  if (!["info", "approve", "reject"].includes(action)) {
    return json(400, { error: "Ação inválida." });
  }

  const hash = await sha256Hex(token);
  const { data: rec } = await admin
    .from("approval_action_tokens")
    .select("id, expense_id, approver_email, approver_name, level_order, expires_at, used_at, used_action")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!rec) return json(404, { error: "Link inválido ou já removido." });

  const expired = new Date(rec.expires_at).getTime() < Date.now();

  const { data: exp } = await admin
    .from("expenses")
    .select("id, status, doc_type, company_db, supplier_name, total_amount, currency, requester_name, current_approver, current_level_order, due_date, description")
    .eq("id", rec.expense_id)
    .maybeSingle();

  const summary = exp
    ? {
        id: exp.id,
        status: exp.status,
        docType: exp.doc_type,
        companyDb: exp.company_db,
        supplierName: exp.supplier_name,
        totalAmount: exp.total_amount,
        currency: exp.currency,
        requesterName: exp.requester_name,
        levelOrder: rec.level_order,
        dueDate: (exp as any).due_date ?? null,
        description: (exp as any).description ?? null,
      }
    : null;

  if (action === "info") {
    return json(200, {
      ok: true,
      approverName: rec.approver_name,
      approverEmail: rec.approver_email,
      expired,
      used: !!rec.used_at,
      usedAction: rec.used_action,
      pending: exp?.status === "pendente_aprovacao",
      status: exp?.status ?? null,
      expense: summary,
    });
  }

  if (expired) return json(410, { error: "Este link expirou. Abra o ERP Flow para decidir." });
  if (rec.used_at) return json(409, { error: "Este link já foi utilizado." });
  if (!exp) return json(404, { error: "Documento não encontrado." });
  if (exp.status !== "pendente_aprovacao") {
    return json(409, { error: "Este documento não está mais pendente de aprovação." });
  }

  // Consumo atômico: só um request consegue marcar used_at.
  const { data: claimed } = await admin
    .from("approval_action_tokens")
    .update({
      used_at: new Date().toISOString(),
      used_action: action,
      used_ip: ip,
      used_user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
    })
    .eq("id", rec.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return json(409, { error: "Este link já foi utilizado." });

  const res = await fetch(`${url}/functions/v1/expense-approval-action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "x-internal-actor-email": rec.approver_email,
    },
    body: JSON.stringify({
      expense_id: rec.expense_id,
      action,
      remarks: remarks || `Decisão registrada por link seguro (${action === "approve" ? "aprovado" : "reprovado"}).`,
    }),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }

  if (!res.ok) {
    // Libera o token para nova tentativa quando a decisão não foi aplicada.
    await admin.from("approval_action_tokens")
      .update({ used_at: null, used_action: null })
      .eq("id", rec.id);
    console.error(`[approval-link] decisão falhou [${res.status}]`, text.slice(0, 400));
    return json(res.status, {
      error: data?.error || "Não foi possível registrar a decisão. Tente pelo ERP Flow.",
    });
  }

  return json(200, {
    ok: true,
    action,
    finalized: data?.finalized ?? null,
    nextApproverName: data?.nextApproverName ?? null,
    expense: summary,
  });
});
