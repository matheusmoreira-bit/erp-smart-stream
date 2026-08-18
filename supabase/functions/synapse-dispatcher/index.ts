import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { authErrorResponse, requireScheduler } from "../_shared/auth.ts";
import { releaseWatcherLock, tryWatcherLock } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-cron-secret",
};

const functionByIntegration: Record<string, string> = {
  jumpcloud_sap_sync: "synapse-jc-sync",
  pagcorp_erp_sync: "synapse-pagcorp-sync",
  purchase_order_notifications: "synapse-po-notify",
  pagcorp_settlement_watcher: "pagcorp-settlement-watcher",
  jumpcloud_attributes_sync: "jumpcloud-attributes-sync",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    requireScheduler(req);
  } catch (error) {
    return authErrorResponse(error, corsHeaders) ?? new Response("Unauthorized", { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET")!;
  const supabase = createClient(url, serviceKey);

  if (!(await tryWatcherLock(supabase, "synapse-dispatcher", 3))) {
    return Response.json({ ok: true, skipped: "another_run_in_progress" }, { headers: corsHeaders });
  }

  const results: Array<Record<string, unknown>> = [];
  try {
    const { data, error } = await supabase
      .from("synapse_integrations")
      .select("id, integration_key, company_db, interval_minutes, parameters, last_run_at")
      .eq("is_active", true);
    if (error) throw error;

    const now = Date.now();
    for (const integration of data || []) {
      const functionName = functionByIntegration[integration.integration_key];
      if (!functionName) {
        results.push({ id: integration.id, skipped: "unsupported_integration" });
        continue;
      }

      const intervalMs = Math.max(1, Number(integration.interval_minutes) || 1) * 60_000;
      const lastRun = integration.last_run_at ? Date.parse(integration.last_run_at) : 0;
      if (lastRun && now - lastRun < intervalMs) continue;

      const response = await fetch(`${url}/functions/v1/${functionName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({
          company_db: integration.company_db,
          params: integration.parameters || {},
        }),
      });
      const body = await response.json().catch(() => ({}));
      results.push({
        id: integration.id,
        integration_key: integration.integration_key,
        company_db: integration.company_db,
        ok: response.ok,
        status: response.status,
      });

      const message = String(
        response.ok ? body?.message || `HTTP ${response.status}` : body?.error || `HTTP ${response.status}`,
      ).slice(0, 300);
      await Promise.all([
        supabase.from("synapse_integrations").update({
          last_run_at: new Date().toISOString(),
          last_run_status: response.ok ? "success" : "error",
          last_run_message: message,
        }).eq("id", integration.id),
        supabase.from("synapse_execution_log").insert({
          integration_key: integration.integration_key,
          company_db: integration.company_db,
          status: response.ok ? "success" : "error",
          affected_count: 0,
          details: { source: "dispatcher", http_status: response.status, message },
        }),
      ]);
    }

    await releaseWatcherLock(supabase, "synapse-dispatcher", "ok", `dispatched=${results.length}`);
    return Response.json({ ok: true, results }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releaseWatcherLock(supabase, "synapse-dispatcher", "error", message);
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
});
