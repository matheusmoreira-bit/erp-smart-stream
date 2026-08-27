// Função temporária de manutenção: dispara a troca de item de uma linha já
// integrada, reaproveitando expense-line-item-patch com a chave interna.
// Protegida por TEMP_PATCH_KEY. Remover após o uso.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-temp-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("TEMP_PATCH_KEY") || "";
  const provided = req.headers.get("x-temp-key") || "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.text();
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/expense-line-item-patch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": Deno.env.get("INTERNAL_FUNCTION_SECRET") || "",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
    },
    body,
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
