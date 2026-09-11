// Ponte entre os fluxos de notificação existentes e o motor de notificações
// (`notification_events` → triggers → rules → dispatches).
//
// Regras:
//   - Best-effort: nunca lança exceção para o fluxo de negócio.
//   - Não substitui os envios legados (e-mail/WhatsApp/in-app). Ele apenas
//     registra o evento no motor; a entrega pelo motor só acontece se um
//     admin tiver criado uma regra ativa para o `event_key`.
//   - Idempotente: `idempotencyKey` evita duplicidade em retries.
// deno-lint-ignore-file no-explicit-any

export interface NotificationEventInput {
  /** Chave canônica do evento, ex.: "document.pending_approval". */
  eventKey: string;
  /** Módulo de origem: approvals, sales, cards, integration, identity… */
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  companyDb?: string | null;
  payload?: Record<string, unknown>;
  /** Chave de deduplicação (retries não geram novo disparo). */
  idempotencyKey?: string | null;
}

function sanitize(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/**
 * Registra um evento no motor de notificações.
 * Retorna true quando o evento foi aceito pelo motor.
 */
export async function emitNotificationEvent(
  admin: any,
  input: NotificationEventInput,
): Promise<boolean> {
  try {
    if (!admin?.rpc || !input?.eventKey) return false;
    const { error } = await admin.rpc("enqueue_notification_event", {
      p_event_key: input.eventKey,
      p_source_module: input.sourceModule ?? null,
      p_source_entity_type: input.sourceEntityType ?? null,
      p_source_entity_id: input.sourceEntityId ?? null,
      p_company_db: input.companyDb ?? null,
      p_payload: sanitize(input.payload),
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error) {
      console.warn("[notification-engine] enqueue falhou:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(
      "[notification-engine] erro inesperado:",
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

/** Converte lista de detalhes label/valor em objeto simples para o payload. */
export function detailsToPayload(
  details: Array<{ label: string; value: unknown }> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of details ?? []) {
    if (!d?.label) continue;
    if (d.value === null || d.value === undefined || String(d.value).trim() === "") continue;
    out[d.label] = d.value;
  }
  return out;
}
