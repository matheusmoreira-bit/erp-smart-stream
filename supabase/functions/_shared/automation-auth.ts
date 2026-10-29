import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdmin, requireUserOrSapSession } from "./auth.ts";

export type AutomationAuth =
  | { ok: true; source: "service_role" | "scheduler_secret" | "admin" | "user_or_sap" }
  | { ok: false; response: Response };

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function json(status: number, body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isServiceRoleRequest(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return timingSafeEqual(bearer(req), serviceKey);
}

// Fonte única: system_credentials (cron/scheduler_secret), lido via system_credentials_v
// com service role e cache curto. Segredos antigos de env não são aceitos.
const SECRET_TTL_MS = 60_000;
let cachedSecret: { value: string; at: number } | null = null;

export async function getSchedulerSecret(): Promise<string> {
  if (cachedSecret && Date.now() - cachedSecret.at < SECRET_TTL_MS) return cachedSecret.value;
  try {
    const { data, error } = await serviceClient()
      .from("system_credentials_v")
      .select("credential_value")
      .eq("system_name", "cron")
      .eq("credential_key", "scheduler_secret")
      .is("company_db", null)
      .maybeSingle();
    if (error) throw error;
    const value = String((data as { credential_value?: string } | null)?.credential_value || "").trim();
    cachedSecret = { value, at: Date.now() };
    return value;
  } catch (e) {
    console.error("scheduler secret lookup failed", (e as Error).message);
    return cachedSecret?.value || "";
  }
}

export async function isSchedulerSecretRequest(req: Request): Promise<boolean> {
  const provided = (req.headers.get("x-scheduler-secret")
    || req.headers.get("x-internal-key")
    || req.headers.get("x-automation-secret")
    || "").trim();
  if (!provided) return false;
  return timingSafeEqual(provided, await getSchedulerSecret());
}

export async function requireSchedulerOrAdmin(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AutomationAuth> {
  if (isServiceRoleRequest(req)) return { ok: true, source: "service_role" };
  if (await isSchedulerSecretRequest(req)) return { ok: true, source: "scheduler_secret" };

  try {
    await requireAdmin(req);
    return { ok: true, source: "admin" };
  } catch {
    return {
      ok: false,
      response: json(401, { error: "Autorização de scheduler/admin obrigatória." }, corsHeaders),
    };
  }
}

export async function requireSchedulerAdminOrUserSession(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AutomationAuth> {
  const scheduler = await requireSchedulerOrAdmin(req, corsHeaders);
  if (scheduler.ok) return scheduler;

  try {
    await requireUserOrSapSession(req);
    return { ok: true, source: "user_or_sap" };
  } catch {
    return {
      ok: false,
      response: json(401, { error: "Sessão válida obrigatória." }, corsHeaders),
    };
  }
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
