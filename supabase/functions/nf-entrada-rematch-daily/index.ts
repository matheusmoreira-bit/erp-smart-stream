// Edge function: nf-entrada-rematch-daily
// Rotina diária que reexecuta o vínculo (rematch) das NFs de entrada ainda
// sem Pedido de Compra localizado no SAP. Para cada NF elegível invoca a
// função `nf-entrada-rematch` (que consulta o Service Layer ao vivo).
//
// Elegível = status in ('awaiting_erpflow_approval','integration_error')
//            AND sap_matched_po_doc_entry IS NULL
//            AND sap_invoice_draft_id IS NULL
//            AND sap_company_db IS NOT NULL
//            AND created_at >= now() - interval '60 days'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const locked = await tryWatcherLock(supabase, "nf-entrada-rematch-daily", 30);
  if (!locked) {
    return new Response(JSON.stringify({ skipped: "lock" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stats = { candidates: 0, matched: 0, unmatched: 0, errors: 0 };

  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("nf_entrada_imports")
      .select("id")
      .in("status", ["awaiting_erpflow_approval", "integration_error"])
      .is("sap_matched_po_doc_entry", null)
      .is("sap_invoice_draft_id", null)
      .not("sap_company_db", "is", null)
      .gte("created_at", cutoff)
      .limit(500);

    if (error) throw error;
    stats.candidates = rows?.length ?? 0;

    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/nf-entrada-rematch`;
    const auth = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;

    for (const r of rows || []) {
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({ import_id: r.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.matched) stats.matched++;
        else stats.unmatched++;
      } catch (e) {
        stats.errors++;
        console.warn("[rematch-daily] falha", r.id, (e as Error).message);
      }
    }

    await releaseWatcherLock(supabase, "nf-entrada-rematch-daily", "ok",
      `candidates=${stats.candidates} matched=${stats.matched} unmatched=${stats.unmatched} errors=${stats.errors}`);

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await releaseWatcherLock(supabase, "nf-entrada-rematch-daily", "error", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message, ...stats }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
