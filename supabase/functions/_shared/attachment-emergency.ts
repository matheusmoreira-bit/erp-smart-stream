// MEDIDA EMERGENCIAL — 09/09/2026
// O SAP está recusando qualquer upload de anexo ("Attachments folder not
// defined..."). Durante este dia, documentos de compra que falharem SOMENTE por
// causa do anexo devem ser integrados mesmo assim, e um aviso é enviado por
// WhatsApp com os dados do pedido, incluindo o id do documento no SAP.
//
// Passado o dia 09/09/2026 (horário de Brasília) a exceção se desliga sozinha.

const EMERGENCY_DAYS = new Set(["2026-09-09"]);

/** Telefone que recebe os avisos desta contingência (falhas e integrações sem anexo). */
export const EMERGENCY_ALERT_PHONE = "5531997063958";

/** Código do admin que também recebe os avisos. */
export const EMERGENCY_ADMIN_USER_CODE = "matheus.moreira";

const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";

function saoPauloDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** True enquanto a contingência de anexos estiver valendo. */
export function isAttachmentEmergencyActive(date = new Date()): boolean {
  return EMERGENCY_DAYS.has(saoPauloDay(date));
}

export function normalizeEmergencyPhone(p?: string | null): string {
  if (!p) return "";
  const digits = String(p).replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export async function sendEmergencyWhatsApp(to: string, message: string) {
  if (!WHATSAPP_TOKEN || !to) return { ok: false, status: 0 };
  try {
    const resp = await fetch(WHATSAPP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ to, message }).toString(),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    console.warn("[attachment-emergency] WhatsApp falhou:", (e as Error).message);
    return { ok: false, status: 0 };
  }
}

/** Envia o aviso para o telefone de contingência e para o admin (quando cadastrado). */
export async function notifyEmergencyContacts(
  admin: { from: (t: string) => any } | null,
  message: string,
): Promise<string[]> {
  const targets = new Set<string>([EMERGENCY_ALERT_PHONE]);
  if (admin) {
    try {
      const { data } = await admin
        .from("user_phones")
        .select("phone")
        .eq("user_code", EMERGENCY_ADMIN_USER_CODE)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const phone = normalizeEmergencyPhone(data?.phone);
      if (phone) targets.add(phone);
    } catch {
      /* segue apenas com o telefone de contingência */
    }
  }
  const sent: string[] = [];
  for (const to of targets) {
    const res = await sendEmergencyWhatsApp(to, message);
    if (res.ok) sent.push(to);
  }
  return sent;
}
