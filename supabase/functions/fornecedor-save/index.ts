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

const digits = (s: string) => (s || "").replace(/\D+/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const payload = body?.payload ?? {};
    const tipo = payload?.tipo_pessoa;

    if (tipo !== "pj" && tipo !== "pf") {
      return json({ error: "tipo_pessoa inválido" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (tipo === "pj") {
      const cnpj = digits(String(payload?.cnpj ?? ""));
      if (cnpj.length !== 14) return json({ error: "CNPJ inválido" }, 400);
      payload.cnpj = cnpj;

      const { data: dup } = await admin
        .from("fornecedores")
        .select("*")
        .eq("cnpj", cnpj)
        .maybeSingle();
      if (dup) return json({ ok: true, id: dup.id, existed: true, fornecedor: dup });
    } else {
      const cpf = digits(String(payload?.cpf ?? ""));
      if (cpf.length !== 11) return json({ error: "CPF inválido" }, 400);
      if (!String(payload?.razao_social ?? "").trim()) {
        return json({ error: "Nome obrigatório" }, 400);
      }
      payload.cpf = cpf;

      const { data: dup } = await admin
        .from("fornecedores")
        .select("*")
        .eq("cpf", cpf)
        .maybeSingle();
      if (dup) return json({ ok: true, id: dup.id, existed: true, fornecedor: dup });
    }

    const { data, error } = await admin
      .from("fornecedores")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      if ((error as any).code === "23505") {
        return json({ error: "Fornecedor duplicado" }, 409);
      }
      return json({ error: error.message }, 400);
    }

    return json({ ok: true, id: data.id, existed: false, fornecedor: data });

  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
