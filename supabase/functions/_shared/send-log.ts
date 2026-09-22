// Registro unificado de envios (e-mail, push, WhatsApp, Slack, in-app…).
//
// Best-effort: nunca lança exceção nem bloqueia o envio real.
// Grava em `public.message_send_log` via REST com a service role.
// deno-lint-ignore-file no-explicit-any

export type SendChannel = "email" | "push" | "whatsapp" | "slack" | "in_app" | "sms";
export type SendStatus = "sent" | "failed" | "skipped";

export interface SendLogEntry {
  channel: SendChannel;
  recipient: string;
  status: SendStatus;
  subject?: string | null;
  errorMessage?: string | null;
  /** Função/rotina que originou o envio. */
  source?: string | null;
  companyDb?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

function maskRecipient(channel: SendChannel, raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (channel === "push") {
    // endpoints são URLs longas; guardamos só o host para não virar PII/segredo
    try {
      return new URL(v).host;
    } catch {
      return v.slice(0, 80);
    }
  }
  return v.slice(0, 200);
}

/** Grava uma linha de envio. Nunca lança. */
export async function logSend(entry: SendLogEntry): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !entry?.channel) return;
    const row = {
      channel: entry.channel,
      recipient: maskRecipient(entry.channel, entry.recipient) || "—",
      status: entry.status,
      subject: entry.subject ? String(entry.subject).slice(0, 300) : null,
      error_message: entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null,
      source: entry.source ?? null,
      company_db: entry.companyDb ?? null,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ? String(entry.entityId).slice(0, 120) : null,
      metadata: entry.metadata ?? {},
    };
    await fetch(`${url}/rest/v1/message_send_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch (e) {
    console.warn("[send-log] falhou:", e instanceof Error ? e.message : String(e));
  }
}

/** Atalho para registrar vários destinatários do mesmo envio. */
export function logSendMany(
  recipients: string[],
  entry: Omit<SendLogEntry, "recipient">,
): Promise<void[]> {
  return Promise.all((recipients || []).map((r) => logSend({ ...entry, recipient: r })));
}
