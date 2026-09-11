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

/** Remove placeholders não substituídos e linhas vazias resultantes. */
function cleanTemplate(text: string): string {
  return String(text || "")
    .replace(/\{\{\s*[\w.]+\s*\}\}/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .filter((l, i, arr) => !(l.trim() === "" && arr[i - 1]?.trim() === ""))
    // descarta linhas do tipo "Rótulo:" que ficaram sem valor
    .filter((l) => !/^\s*[^:]{1,40}:\s*$/.test(l))
    .join("\n")
    .trim();
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Converte o corpo texto em blocos HTML: linhas "Rótulo: valor" viram lista de detalhes. */
function bodyToHtml(body: string): string {
  const lines = cleanTemplate(body).split("\n").filter((l) => l.trim() !== "");
  const paragraphs: string[] = [];
  let details: string[] = [];
  const flush = () => {
    if (!details.length) return;
    paragraphs.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;border-left:4px solid #0f766e;background:#f8fafc">` +
        details.join("") +
        `</table>`,
    );
    details = [];
  };
  for (const line of lines) {
    const m = /^([^:]{1,40}):\s*(.+)$/.exec(line.trim());
    if (m) {
      details.push(
        `<tr><td style="padding:8px 16px;font-family:${FONT};font-size:14px;color:#0f172a;line-height:1.5">` +
          `<strong style="color:#334155">${escapeHtml(m[1].trim())}:</strong> ${escapeHtml(m[2].trim())}</td></tr>`,
      );
      continue;
    }
    flush();
    paragraphs.push(
      `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:#334155">${escapeHtml(line)}</p>`,
    );
  }
  flush();
  return paragraphs.join("\n");
}

/** Envelope visual padrão de todos os e-mails do motor de notificações. */
function renderEmail(subject: string, content: string): string {
  const title = escapeHtml(subject.replace(/^\[ERP Flow\]\s*/i, ""));
  const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#eef1f4;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0">
  <tr><td style="padding:24px 32px 0;font-family:${FONT}">
    <span style="font-size:15px;font-weight:800;letter-spacing:.5px;color:#0f172a">ERP</span><span style="font-size:15px;font-weight:800;letter-spacing:.5px;color:#0f766e"> FLOW</span>
  </td></tr>
  <tr><td style="padding:16px 32px 0"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0"></td></tr>
  <tr><td style="padding:26px 32px 0;font-family:${FONT}">
    <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#0f172a;text-align:center;font-weight:700">${title}</h1>
  </td></tr>
  <tr><td style="padding:0 32px">${content}</td></tr>
  <tr><td style="padding:6px 32px 0;font-family:${FONT};font-size:14px;color:#0f172a;font-weight:700">Este é um e-mail automático informativo.</td></tr>
  <tr><td style="padding:24px 32px 0"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0"></td></tr>
  <tr><td style="padding:16px 32px 28px;font-family:${FONT};font-size:12px;line-height:1.7;color:#94a3b8;text-align:center">
    Notificação emitida em ${escapeHtml(stamp)}.<br>
    <span style="color:#64748b;font-weight:600">ERP Flow — Cactus Corporation</span>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
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
        const startedAt = Date.now();
        let usedAddress: string | null = r.recipient_email || r.channel_address || r.recipient_phone || null;
        try {
          if (d.channel === "email") {
            const to = [r.recipient_email, r.channel_address].find((v) => isEmail(v)) as string | undefined;
            if (!to) throw new Error("Destinatário sem e-mail válido");
            usedAddress = to.trim().toLowerCase();
            const subject = cleanTemplate(d.rendered_subject || "").slice(0, 200) || "ERP Flow — notificação";
            const inner = d.rendered_html
              ? cleanTemplate(d.rendered_html)
              : bodyToHtml(d.rendered_body || "");
            await sendEmail([to.trim().toLowerCase()], subject, renderEmail(subject, inner));
          } else {
            let phone = normalizePhone(r.recipient_phone || (String(r.channel_address || "").includes("@") ? "" : r.channel_address));
            if (!phone) phone = await resolvePhone(admin, r.recipient_email || r.channel_address, r.recipient_name);
            if (!phone) throw new Error("Destinatário sem telefone");
            usedAddress = phone;
            const waTitle = cleanTemplate(d.rendered_subject || "").replace(/^ERP Flow\s*[—-]\s*/i, "");
            const text = [
              waTitle ? `*${waTitle}*` : "",
              cleanTemplate(d.rendered_body || ""),
              "_ERP Flow · mensagem automática_",
            ].filter(Boolean).join("\n\n");
            await sendWhatsApp(phone, text);
          }
          anySent = true;
          await admin.from("notification_dispatch_recipients")
            .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() })
            .eq("id", r.id);
          await logAttempt(admin, {
            dispatch_id: d.id,
            recipient_id: r.id,
            event_key: d.event_key,
            channel: d.channel,
            attempt_no: attempts,
            status: "sent",
            error_message: null,
            recipient_address: usedAddress,
            recipient_name: r.recipient_name,
            company_db: (d as any).company_db ?? null,
            source_module: (d as any).source_module ?? null,
            source_entity_type: (d as any).source_entity_type ?? null,
            source_entity_id: (d as any).source_entity_id ?? null,
            duration_ms: Date.now() - startedAt,
          });
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
          await logAttempt(admin, {
            dispatch_id: d.id,
            recipient_id: r.id,
            event_key: d.event_key,
            channel: d.channel,
            attempt_no: attempts,
            status: finalFail ? "failed" : "retry_scheduled",
            error_message: lastError.slice(0, 400),
            recipient_address: usedAddress,
            recipient_name: r.recipient_name,
            company_db: (d as any).company_db ?? null,
            source_module: (d as any).source_module ?? null,
            source_entity_type: (d as any).source_entity_type ?? null,
            source_entity_id: (d as any).source_entity_id ?? null,
            duration_ms: Date.now() - startedAt,
          });
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
