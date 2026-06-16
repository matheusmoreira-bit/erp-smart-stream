import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "findByTaxId") {
      const taxId = String(body?.taxId ?? "").trim();
      const companyDb = String(body?.companyDb ?? "").trim();
      if (!taxId || !companyDb) return json({ ok: true, supplier: null });
      const cleaned = taxId.replace(/\D/g, "");
      const orParts = [`federal_tax_id.eq.${taxId}`];
      if (cleaned && cleaned !== taxId) orParts.push(`federal_tax_id.eq.${cleaned}`);
      const { data, error } = await admin
        .from("suppliers")
        .select("*")
        .eq("company_db", companyDb)
        .or(orParts.join(","))
        .limit(1)
        .maybeSingle();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, supplier: data });
    }

    if (action === "insert") {
      const row = body?.row;
      if (!row || typeof row !== "object") return json({ error: "row missing" }, 400);
      const { data, error } = await admin
        .from("suppliers")
        .insert(row)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, supplier: data });
    }

    return json({ error: "invalid action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
