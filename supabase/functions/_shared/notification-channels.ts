/**
 * Canais de notificação configuráveis por empresa e por tipo de evento.
 * Regra global (company_db IS NULL) é o padrão; a regra da empresa sobrescreve.
 */
export type NotificationChannel = "in_app" | "email" | "push" | "slack" | "whatsapp";

export type ChannelSettings = Record<NotificationChannel, boolean>;

const DEFAULTS: ChannelSettings = {
  in_app: true,
  email: true,
  push: true,
  slack: true,
  whatsapp: true,
};

const cache = new Map<string, { at: number; value: ChannelSettings }>();
const TTL_MS = 60_000;

function fromRow(row: any, base: ChannelSettings): ChannelSettings {
  if (!row) return base;
  return {
    in_app: row.in_app_enabled ?? base.in_app,
    email: row.email_enabled ?? base.email,
    push: row.push_enabled ?? base.push,
    slack: row.slack_enabled ?? base.slack,
    whatsapp: row.whatsapp_enabled ?? base.whatsapp,
  };
}

export async function getChannelSettings(
  admin: any,
  companyDb: string | null | undefined,
  eventKey: string,
): Promise<ChannelSettings> {
  const db = (companyDb || "").trim();
  const key = `${db}|${eventKey}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = DEFAULTS;
  try {
    const { data } = await admin
      .from("notification_channel_settings")
      .select("company_db, in_app_enabled, email_enabled, push_enabled, slack_enabled, whatsapp_enabled")
      .eq("event_key", eventKey)
      .or(db ? `company_db.is.null,company_db.eq.${db}` : "company_db.is.null");

    const rows: any[] = data || [];
    const global = rows.find((r) => !r.company_db);
    const company = db ? rows.find((r) => r.company_db === db) : null;
    value = fromRow(company, fromRow(global, DEFAULTS));
  } catch (e) {
    console.warn("[notification-channels] falha ao ler configuração:", e instanceof Error ? e.message : String(e));
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}
