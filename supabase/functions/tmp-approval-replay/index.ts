// Função temporária de manutenção: reaplica uma decisão de aprovação já
// registrada (ex.: link de e-mail que gravou o log mas não avançou o nível).
// Reusa `expense-approval-action` com a service role — todas as regras de
// alçada, self-approval e auditoria continuam valendo.
// deno-lint-ignore-file no-explicit-any

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: any = {};
  try { body = await req.json(); } catch { /* noop */ }
  const expenseId = String(body.expense_id || "");
  const actorEmail = String(body.actor_email || "");
  const action = body.action === "reject" ? "reject" : "approve";
  if (!expenseId || !actorEmail) {
    return new Response(JSON.stringify({ error: "expense_id e actor_email são obrigatórios" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const res = await fetch(`${url}/functions/v1/expense-approval-action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "x-internal-actor-email": actorEmail,
    },
    body: JSON.stringify({
      expense_id: expenseId,
      action,
      remarks: String(body.remarks || "").slice(0, 400),
    }),
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
