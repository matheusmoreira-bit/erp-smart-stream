// Gatilho administrativo pontual (protegido por REPROCESS_ONETIME_KEY) para
// reexecutar o roteamento de aprovação em lote via expense-reassign-approver.
const cors = {
  "Access-Control-Allow-Origin": "null",
  "Access-Control-Allow-Headers": "content-type, x-reprocess-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  const expected = (Deno.env.get("REPROCESS_ONETIME_KEY") || "").trim();
  const provided = (req.headers.get("x-reprocess-key") || "").trim();
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
  }
  const body = await req.json().catch(() => ({}));
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const serviceUrl = Deno.env.get("SUPABASE_URL") || "";
  const res = await fetch(`${serviceUrl}/functions/v1/expense-reassign-approver`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { ...cors, "content-type": "application/json" } });
});
