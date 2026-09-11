// Reenvio manual de notificações que falharam (e-mail / WhatsApp).
//
// - Autorização: apenas scheduler/service-role/admin.
// - Reabre o disparo (status pending, tentativas zeradas) e chama o worker.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_IDS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const rawIds: unknown = (body as any)?.dispatch_ids;
    const allFailed = (body as any)?.all_failed === true;

    let ids: string[] = Array.isArray(rawIds)
      ? rawIds.filter((v): v is string => typeof v === "string" && UUID_RE.test(v)).slice(0, MAX_IDS)
      : [];

    if (!ids.length && allFailed) {
      const { data, error } = await admin
        .from("notification_dispatches")
        .select("id")
        .eq("status", "failed")
        .in("channel", ["email", "whatsapp"])
        .order("updated_at", { ascending: false })
        .limit(MAX_IDS);
      if (error) throw new Error(error.message);
      ids = (data || []).map((r: any) => r.id);
    }

    if (!ids.length) {
      return new Response(
        JSON.stringify({ error: "Informe dispatch_ids válidos ou all_failed = true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const nowIso = new Date().toISOString();

    const { data: dispatches, error: readError } = await admin
      .from("notification_dispatches")
      .select("id, metadata")
      .in("id", ids)
      .in("channel", ["email", "whatsapp"]);
    if (readError) throw new Error(readError.message);

    let requeued = 0;
    for (const d of dispatches || []) {
      const meta = (d as any).metadata || {};
      const { error: upErr } = await admin
        .from("notification_dispatches")
        .update({
          status: "pending",
          error_message: null,
          sent_at: null,
          scheduled_at: nowIso,
          metadata: {
            ...meta,
            attempts: 0,
            next_retry_at: null,
            manual_resend_at: nowIso,
            manual_resend_count: Number(meta?.manual_resend_count ?? 0) + 1,
          },
          updated_at: nowIso,
        })
        .eq("id", (d as any).id);
      if (upErr) {
        console.warn("[notification-dispatch-resend] update dispatch:", upErr.message);
        continue;
      }
      await admin
        .from("notification_dispatch_recipients")
        .update({ status: "pending", error_message: null, updated_at: nowIso })
        .eq("dispatch_id", (d as any).id)
        .neq("status", "sent");
      requeued++;
    }

    if (requeued > 0) {
      try {
        await admin.functions.invoke("notification-dispatch-worker", { body: { source: "resend" } });
      } catch (e) {
        console.warn("[notification-dispatch-resend] worker:", e instanceof Error ? e.message : String(e));
      }
    }

    return new Response(JSON.stringify({ ok: true, requeued }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[notification-dispatch-resend]", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: "Falha ao reenviar notificações" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
