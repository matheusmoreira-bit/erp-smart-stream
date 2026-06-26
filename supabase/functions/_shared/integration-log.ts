// Shared helper to log calls from external integration proxies (OMIE, PagCorp, MasterTax, etc.)
// Writes to public.integration_log via service-role; failures are swallowed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let _client: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_client) _client = createClient(SUPABASE_URL, SERVICE_KEY);
  return _client;
}

export interface IntegrationLogEntry {
  system_name: string;
  action: string;
  company_db?: string | null;
  status?: "ok" | "error";
  http_status?: number | null;
  error_message?: string | null;
  duration_ms?: number | null;
  request_meta?: Record<string, unknown>;
  response_meta?: Record<string, unknown>;
}

export async function logIntegrationCall(entry: IntegrationLogEntry): Promise<void> {
  try {
    await admin().from("integration_log").insert({
      system_name: entry.system_name,
      action: entry.action,
      company_db: entry.company_db ?? null,
      status: entry.status ?? "ok",
      http_status: entry.http_status ?? null,
      error_message: entry.error_message ?? null,
      duration_ms: entry.duration_ms ?? null,
      request_meta: entry.request_meta ?? {},
      response_meta: entry.response_meta ?? {},
    });
  } catch (e) {
    console.warn("integration_log insert failed:", (e as Error).message);
  }
}
