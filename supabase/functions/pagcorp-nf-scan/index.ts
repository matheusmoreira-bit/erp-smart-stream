// Edge function: pagcorp-nf-scan
//
// Complementa o `pagcorp-settlement-watcher`. Enquanto o watcher varre
// `pagcorp_integration_log` (linha a linha) e checa o PO no SAP, este scanner
// parte das NFs de entrada recém-lançadas (já cacheadas em `sap_nf_entrada_cache`
// pelo cron `sap-nf-entrada-sync`) e cruza com as linhas do PagCorp que ainda
// não foram baixadas. Para cada match, dispara o watcher com { logId, forceRetry:
// true } — ou seja, uma baixa direcionada e imediata.
//
// Cron: a cada 30 min (varre por empresa). Reagenda apenas as linhas que
// realmente têm NF disponível, evitando esperar o próximo slot do watcher geral.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Janela de "NFs recentes" a considerar. sap-nf-entrada-sync roda a cada 5min,
// mas o scanner só olha para as últimas 2h para não reprocessar em vão.
const RECENT_NF_WINDOW_HOURS = 2;

interface LogRow {
  id: string;
  company_db: string;
  sap_doc_entry: number;
  settlement_status: string | null;
}

interface NfRow {
  company_db: string;
  base_po_doc_entry: number;
  doc_num: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Coleta NFs de entrada recentes (com PO base) por empresa.
    const cutoffIso = new Date(Date.now() - RECENT_NF_WINDOW_HOURS * 3600 * 1000).toISOString();
    const { data: nfs, error: nfErr } = await sb
      .from("sap_nf_entrada_cache")
      .select("company_db, base_po_doc_entry, doc_num")
      .not("base_po_doc_entry", "is", null)
      .gte("synced_at", cutoffIso);
    if (nfErr) throw new Error(`nf_entrada_cache: ${nfErr.message}`);

    // Agrupa PO entries por empresa.
    const byCompany = new Map<string, { poEntries: Set<number>; nfDocs: Map<number, number> }>();
    for (const n of (nfs || []) as NfRow[]) {
      if (!n.company_db || n.base_po_doc_entry == null) continue;
      let bucket = byCompany.get(n.company_db);
      if (!bucket) {
        bucket = { poEntries: new Set(), nfDocs: new Map() };
        byCompany.set(n.company_db, bucket);
      }
      bucket.poEntries.add(n.base_po_doc_entry);
      if (n.doc_num != null) bucket.nfDocs.set(n.base_po_doc_entry, n.doc_num);
    }

    console.info(`[pagcorp-nf-scan:${requestId}] scan_start`, JSON.stringify({
      companies: byCompany.size,
      totalPoEntries: Array.from(byCompany.values()).reduce((s, b) => s + b.poEntries.size, 0),
      windowHours: RECENT_NF_WINDOW_HOURS,
    }));

    const matched: LogRow[] = [];
    for (const [companyDb, bucket] of byCompany) {
      if (bucket.poEntries.size === 0) continue;
      const poList = Array.from(bucket.poEntries);
      // Busca linhas do PagCorp para esses POs que ainda não estão baixadas.
      const { data: logs, error: logErr } = await sb
        .from("pagcorp_integration_log")
        .select("id, company_db, sap_doc_entry, settlement_status")
        .eq("company_db", companyDb)
        .eq("status", "success")
        .neq("integration_type", "journal_entry")
        .in("sap_doc_entry", poList)
        .neq("settlement_status", "settled");
      if (logErr) {
        console.error(`[pagcorp-nf-scan:${requestId}] logs_select_error`, JSON.stringify({ companyDb, err: logErr.message }));
        continue;
      }
      for (const r of (logs || []) as LogRow[]) matched.push(r);
    }

    console.info(`[pagcorp-nf-scan:${requestId}] matched_logs`, JSON.stringify({
      count: matched.length,
      byCompany: Object.fromEntries(
        [...byCompany.keys()].map((c) => [c, matched.filter((m) => m.company_db === c).length]),
      ),
    }));

    if (matched.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        request_id: requestId,
        scanned_companies: byCompany.size,
        matched: 0,
        duration_ms: Date.now() - startedAt,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Zera gates de backoff das linhas encontradas.
    await sb
      .from("pagcorp_integration_log")
      .update({
        settlement_retry_after: null,
        settlement_locked_at: null,
        settlement_status: "pending",
      })
      .in("id", matched.map((m) => m.id));

    // 3. Dispara o watcher para cada linha (paralelo controlado). Cada chamada
    //    é rápida porque manualLogId curto-circuita a varredura geral.
    const CONCURRENCY = 5;
    const results: Array<{ id: string; ok: boolean; status?: number; error?: string }> = [];
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    let idx = 0;
    async function worker() {
      while (idx < matched.length) {
        const my = matched[idx++];
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/pagcorp-settlement-watcher`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: anonKey,
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({ logId: my.id, forceRetry: true }),
          });
          results.push({ id: my.id, ok: r.ok, status: r.status });
        } catch (e) {
          results.push({ id: my.id, ok: false, error: (e as Error).message });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, matched.length) }, worker));

    const okCount = results.filter((r) => r.ok).length;
    const errCount = results.length - okCount;
    console.info(`[pagcorp-nf-scan:${requestId}] scan_done`, JSON.stringify({
      matched: matched.length,
      dispatched: results.length,
      ok: okCount,
      err: errCount,
      duration_ms: Date.now() - startedAt,
    }));

    return new Response(JSON.stringify({
      ok: true,
      request_id: requestId,
      scanned_companies: byCompany.size,
      matched: matched.length,
      dispatched_ok: okCount,
      dispatched_err: errCount,
      duration_ms: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(`[pagcorp-nf-scan:${requestId}] fatal`, JSON.stringify({ err: (e as Error).message }));
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
