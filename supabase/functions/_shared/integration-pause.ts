// Shared helper: check whether an integration key is currently paused.
// Reads from public.integration_pause. Returns null when not paused (or on error),
// otherwise returns the timestamp until which the pause is active.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let _client: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_client) _client = createClient(SUPABASE_URL, SERVICE_KEY);
  return _client;
}

export interface IntegrationPauseInfo {
  key: string;
  paused_until: string;
  reason: string | null;
}

export async function getIntegrationPause(key: string): Promise<IntegrationPauseInfo | null> {
  try {
    const { data, error } = await admin()
      .from("integration_pause")
      .select("key, paused_until, reason")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    const until = new Date(data.paused_until as string).getTime();
    if (!isFinite(until) || until <= Date.now()) return null;
    return data as IntegrationPauseInfo;
  } catch {
    return null;
  }
}

export function pauseResponse(info: IntegrationPauseInfo, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({
      success: false,
      paused: true,
      paused_until: info.paused_until,
      reason: info.reason,
      error: `Integração pausada até ${new Date(info.paused_until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${info.reason ? ` — ${info.reason}` : ""}`,
    }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
