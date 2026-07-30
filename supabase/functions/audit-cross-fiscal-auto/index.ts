// Edge function: audit-cross-fiscal-auto
// Executa a conciliação fiscal automática (NFS-e × pagamento × lançamento no ERP)
// para todas as empresas com auto_conciliar = true. Pensado para rodar via cron diário.
// Cada empresa é processada de forma isolada: falha em uma não interrompe as demais.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  empresa_id?: string;
  periodo_inicio?: string;
  periodo_fim?: string;
  dias?: number; // janela retroativa, default 45
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    let body: Body = {};
    try { body = (await req.json()) as Body; } catch { /* cron sem corpo */ }

    const dias = Number.isFinite(Number(body.dias)) ? Number(body.dias) : 45;
    const hoje = new Date();
    const inicio = body.periodo_inicio || isoDate(new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000));
    const fim = body.periodo_fim || isoDate(hoje);

    let q = supabase
      .from("auditoria_cruzamento_config")
      .select("empresa_id, auto_conciliar")
      .eq("auto_conciliar", true);
    if (body.empresa_id) q = q.eq("empresa_id", body.empresa_id);
    const { data: cfgs, error: cfgErr } = await q;
    if (cfgErr) throw cfgErr;

    const results: any[] = [];
    for (const cfg of cfgs || []) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/audit-cross-fiscal-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ empresa_id: cfg.empresa_id, periodo_inicio: inicio, periodo_fim: fim }),
        });
        const json = await res.json().catch(() => ({}));
        results.push({ empresa_id: cfg.empresa_id, ok: res.ok, ...json });
      } catch (e) {
        results.push({ empresa_id: cfg.empresa_id, ok: false, error: (e as Error).message });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, periodo: { inicio, fim }, empresas: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[audit-cross-fiscal-auto]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
