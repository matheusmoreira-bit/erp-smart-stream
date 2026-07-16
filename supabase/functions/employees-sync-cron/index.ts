// Cron tick: dispara employees-sync-run para configs ativas cujo intervalo venceu.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { CORS_HEADERS, jsonResponse } from "../_shared/employee-sync.ts";

const INTERVALS: Record<string, number> = {
  manual: Infinity,
  hourly: 60 * 60 * 1000,
  every_6h: 6 * 60 * 60 * 1000,
  every_12h: 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: configs } = await supabase
    .from("employee_integration_config")
    .select("id, company_db, schedule_type, last_execution_at, is_active");

  const now = Date.now();
  const triggered: string[] = [];
  for (const c of (configs ?? []) as Array<{
    id: string; company_db: string; schedule_type: string; last_execution_at: string | null; is_active: boolean;
  }>) {
    if (!c.is_active) continue;
    if (!/^TST/i.test(c.company_db)) continue;
    const interval = INTERVALS[c.schedule_type] ?? Infinity;
    if (!isFinite(interval)) continue;
    const last = c.last_execution_at ? new Date(c.last_execution_at).getTime() : 0;
    if (now - last < interval) continue;

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/employees-sync-run`;
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        integration_config_id: c.id,
        mode: "execute",
        execution_type: "scheduled",
      }),
    }).catch((e) => console.warn("cron dispatch failed", e));
    triggered.push(c.id);
  }
  return jsonResponse({ ok: true, triggered });
});
