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

    if (action === "findOrCreateBase") {
      const tipo = body?.tipo as "produto" | "servico";
      const ncm = body?.ncm ? String(body.ncm) : null;
      const codigoServico = body?.codigo_servico ? String(body.codigo_servico) : null;
      const grupo = body?.grupo ? String(body.grupo) : null;
      const unidade = body?.unidade ? String(body.unidade) : null;

      if (tipo !== "produto" && tipo !== "servico") return json({ error: "tipo inválido" }, 400);
      if (tipo === "produto" && !ncm) return json({ error: "ncm obrigatório" }, 400);
      if (tipo === "servico" && !codigoServico) return json({ error: "codigo_servico obrigatório" }, 400);

      let q = admin.from("item_base").select("*").eq("tipo", tipo);
      q = tipo === "produto" ? q.eq("ncm", ncm) : q.eq("codigo_servico", codigoServico);
      const { data: existing, error: eFind } = await q.maybeSingle();
      if (eFind) return json({ error: eFind.message }, 400);
      if (existing) return json({ ok: true, base: existing, created: false });

      const payload: any = { tipo, grupo, unidade };
      if (tipo === "produto") payload.ncm = ncm;
      else payload.codigo_servico = codigoServico;
      const { data: created, error: eIns } = await admin
        .from("item_base")
        .insert(payload)
        .select("*")
        .single();
      if (eIns) return json({ error: eIns.message }, 400);
      return json({ ok: true, base: created, created: true });
    }

    if (action === "previewCode") {
      const baseId = String(body?.item_base_id ?? "");
      if (!baseId) return json({ error: "item_base_id obrigatório" }, 400);
      const { data, error } = await admin.rpc("preview_next_codigo", { p_item_base_id: baseId });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, code: data });
    }

    if (action === "createVariante") {
      const baseId = String(body?.item_base_id ?? "");
      const descricao = String(body?.descricao ?? "").trim();
      if (!baseId) return json({ error: "item_base_id obrigatório" }, 400);
      if (!descricao) return json({ error: "descricao obrigatória" }, 400);

      const { data: base, error: eBase } = await admin
        .from("item_base")
        .select("*")
        .eq("id", baseId)
        .maybeSingle();
      if (eBase) return json({ error: eBase.message }, 400);
      if (!base) return json({ error: "item_base não encontrado" }, 404);

      // sequencial + código (mesma lógica do create_item_variante)
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: maxRow } = await admin
          .from("item_variante")
          .select("sequencial")
          .eq("item_base_id", baseId)
          .order("sequencial", { ascending: false })
          .limit(1)
          .maybeSingle();
        const next = ((maxRow?.sequencial as number | undefined) ?? 0) + 1;
        const codigo =
          base.tipo === "produto"
            ? `P${base.ncm}.${String(next).padStart(3, "0")}`
            : `S${base.codigo_servico}.${String(next).padStart(4, "0")}`;
        const { data: variante, error: eIns } = await admin
          .from("item_variante")
          .insert({
            item_base_id: baseId,
            sequencial: next,
            descricao,
            codigo_completo: codigo,
          })
          .select("*")
          .single();
        if (!eIns) return json({ ok: true, variante, base });
        if (!/duplicate|unique/i.test(eIns.message)) {
          return json({ error: eIns.message }, 400);
        }
      }
      return json({ error: "Não foi possível gerar código único" }, 409);
    }

    return json({ error: "invalid action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
