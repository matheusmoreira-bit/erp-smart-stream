// Processa os disparos pendentes do motor de notificações (canais e-mail e
// WhatsApp) criados por `enqueue_notification_event`.
//
// - Autorização: apenas scheduler/service-role/admin.
// - Best-effort com retentativas limitadas (metadata.attempts).
// - Nunca expõe segredos; credenciais vêm de variáveis de ambiente.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";
const MAX_ATTEMPTS = 5;
const BATCH = 40;

function isEmail(v: string | null | undefined): boolean {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function normalizePhone(p?: string | null): string {
  const digits = String(p || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function fallbackHtml(subject: string, body: string): string {
  const lines = body.split("\n").filter(Boolean).map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
<h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(subject)}</h2>
${lines.join("\n")}
</div>`;
}

async function sendEmail(to: string[], subject: string, html: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || to.length === 0) throw new Error("Configuração de e-mail indisponível");
  const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`send-smtp-email ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
}

async function sendWhatsApp(to: string, message: string) {
  if (!WHATSAPP_TOKEN) throw new Error("WHATSAPP_TOKEN não configurado");
  const res = await fetch(WHATSAPP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ to, message }).toString(),
  });
  if (!res.ok) throw new Error(`whatsapp ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/** Resolve telefone a partir do e-mail/identificador do destinatário. */
async function resolvePhone(admin: any, email: string | null, name: string | null): Promise<string> {
  const candidates: string[] = [];
  const local = isEmail(email) ? String(email).split("@")[0] : (name || "").trim();
  try {
    let userKeys: string[] = [];
    if (isEmail(email)) {
      const { data } = await admin.from("sap_user_emails").select("user_key").ilike("email", String(email).trim());
      userKeys = (data || []).map((r: any) => r.user_key).filter(Boolean);
    }
    if (userKeys.length === 0 && local) {
      userKeys = [local.replace(/[^a-z0-9]/gi, "").toLowerCase()];
    }
    if (userKeys.length === 0) return "";
    const { data: dir } = await admin
      .from("sap_user_directory")
      .select("sap_user_code")
      .in("user_key", userKeys);
    for (const row of dir || []) if (row?.sap_user_code) candidates.push(row.sap_user_code);
    if (local) candidates.push(local);
    if (candidates.length === 0) return "";
    const { data: phones } = await admin
      .from("user_phones")
      .select("phone")
      .in("user_code", Array.from(new Set(candidates)))
      .limit(5);
    for (const p of phones || []) {
      const n = normalizePhone(p?.phone);
      if (n) return n;
    }
  } catch (e) {
    console.warn("[notification-dispatch-worker] resolvePhone:", e instanceof Error ? e.message : String(e));
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const blocked = blockIfIntegrationsDisabled(corsHeaders);
  if (blocked) return blocked;

  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0, recipients: 0 };

  try {
    const { data: dispatches, error } = await admin
      .from("notification_dispatches")
      .select("id, channel, rendered_subject, rendered_body, rendered_html, metadata, payload_snapshot, event_key")
      .eq("status", "pending")
      .in("channel", ["email", "whatsapp"])
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);

    for (const d of dispatches || []) {
      stats.processed++;
      const attempts = Number((d.metadata as any)?.attempts ?? 0) + 1;
      const { data: rcpts } = await admin
        .from("notification_dispatch_recipients")
        .select("id, recipient_name, recipient_email, recipient_phone, channel_address, status")
        .eq("dispatch_id", d.id)
        .eq("status", "pending");

      const list = rcpts || [];
      if (list.length === 0) {
        await admin.from("notification_dispatches")
          .update({ status: "skipped", error_message: "Sem destinatários pendentes", updated_at: new Date().toISOString() })
          .eq("id", d.id);
        stats.skipped++;
        continue;
      }

      let anySent = false;
      let lastError: string | null = null;

      for (const r of list) {
        stats.recipients++;
        try {
          if (d.channel === "email") {
            const to = [r.recipient_email, r.channel_address].find((v) => isEmail(v)) as string | undefined;
            if (!to) throw new Error("Destinatário sem e-mail válido");
            const subject = (d.rendered_subject || "ERP Flow — notificação").slice(0, 200);
            const html = d.rendered_html || fallbackHtml(subject, d.rendered_body || "");
            await sendEmail([to.trim().toLowerCase()], subject, html);
          } else {
            let phone = normalizePhone(r.recipient_phone || (String(r.channel_address || "").includes("@") ? "" : r.channel_address));
            if (!phone) phone = await resolvePhone(admin, r.recipient_email || r.channel_address, r.recipient_name);
            if (!phone) throw new Error("Destinatário sem telefone");
            const text = [d.rendered_subject ? `*${d.rendered_subject}*` : "", d.rendered_body || ""]
              .filter(Boolean).join("\n");
            await sendWhatsApp(phone, text);
          }
          anySent = true;
          await admin.from("notification_dispatch_recipients")
            .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() })
            .eq("id", r.id);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          const finalFail = attempts >= MAX_ATTEMPTS;
          await admin.from("notification_dispatch_recipients")
            .update({
              status: finalFail ? "failed" : "pending",
              error_message: lastError.slice(0, 400),
              updated_at: new Date().toISOString(),
            })
            .eq("id", r.id);
        }
      }

      const allDone = !lastError;
      const giveUp = attempts >= MAX_ATTEMPTS;
      const status = allDone ? "sent" : giveUp ? (anySent ? "sent" : "failed") : "pending";
      if (status === "sent") stats.sent++;
      else if (status === "failed") stats.failed++;

      await admin.from("notification_dispatches")
        .update({
          status,
          sent_at: status === "sent" ? new Date().toISOString() : null,
          error_message: lastError ? lastError.slice(0, 400) : null,
          metadata: { ...(d.metadata as any || {}), attempts },
          updated_at: new Date().toISOString(),
        })
        .eq("id", d.id);
    }

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[notification-dispatch-worker]", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: "Falha ao processar disparos", ...stats }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
