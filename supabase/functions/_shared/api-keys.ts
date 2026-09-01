// Validação centralizada das chaves de API públicas do ERP Flow.
//
// As chaves ficam em `public.api_keys` apenas como hash SHA-256 — o valor em
// claro só é exibido uma vez, no momento da criação.
// Compatibilidade: as chaves legadas guardadas em secrets de ambiente
// (EXTERNAL_APPROVALS_API_KEY, PAGCORP_STATUS_API_KEY) continuam válidas.

// Cliente mínimo aceito (evita conflito entre versões do supabase-js).
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;


export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante (evita timing attack no fallback legado). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function providedKeyFrom(req: Request): string {
  return (
    req.headers.get("x-api-key") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  ).trim();
}

export interface ApiKeyValidation {
  valid: boolean;
  reason?: string;
  keyId?: string;
  keyName?: string;
  projectCodes?: string[];
  legacy?: boolean;
}

/**
 * @param service identificador do serviço (ex.: "external-approvals-api").
 * @param legacyEnvName nome do secret com a chave antiga, mantida funcional.
 */
export async function validateApiKey(
  admin: SupabaseClient,
  req: Request,
  service: string,
  legacyEnvName?: string,
): Promise<ApiKeyValidation> {
  const provided = providedKeyFrom(req);
  if (!provided) return { valid: false, reason: "API key ausente" };

  const hash = await sha256Hex(provided);
  const { data, error } = await admin
    .from("api_keys")
    .select("id, name, service, revoked_at, expires_at, project_codes")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error) console.error("[api-keys] lookup falhou:", error.message);

  if (data) {
    if (data.service !== service) return { valid: false, reason: "API key não autorizada para este serviço" };
    if (data.revoked_at) return { valid: false, reason: "API key revogada" };
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return { valid: false, reason: "API key expirada" };
    }
    // Telemetria de uso — nunca bloqueia a requisição.
    admin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {}, () => {});
    admin.rpc("api_key_register_use", { _id: data.id }).then(() => {}, () => {});
    return {
      valid: true,
      keyId: data.id,
      keyName: data.name,
      projectCodes: Array.isArray(data.project_codes)
        ? data.project_codes.map((code: unknown) => String(code).trim()).filter(Boolean)
        : [],
    };
  }

  // Fallback: chave legada em variável de ambiente (mantida funcional).
  if (legacyEnvName) {
    const legacy = Deno.env.get(legacyEnvName);
    if (legacy && safeEqual(provided, legacy)) {
      return { valid: true, legacy: true, keyName: `${legacyEnvName} (legada)` };
    }
  }

  return { valid: false, reason: "API key inválida ou ausente" };
}
