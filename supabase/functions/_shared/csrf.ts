// Tokens anti-CSRF de uso único (defesa em profundidade — pentest 3.3).
//
// Fluxo:
//   1. O cliente autenticado chama `security-csrf-token` e recebe um token
//      aleatório (128 bits) válido por poucos minutos.
//   2. O token é enviado no header `x-csrf-token` da operação sensível.
//   3. O servidor consome o token de forma atômica (`consume_csrf_token`);
//      qualquer replay do mesmo HTML/requisição falha com 403.
//
// O valor em claro nunca é persistido: guardamos apenas o SHA-256.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const CSRF_HEADER = "x-csrf-token";
const DEFAULT_TTL_SECONDS = 600;

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeSubject(subject: string): string {
  return (subject || "").trim().toLowerCase();
}

export interface IssuedCsrfToken {
  token: string;
  expiresAt: string;
}

export async function issueCsrfToken(
  admin: SupabaseClient,
  purpose: string,
  subject: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<IssuedCsrfToken> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await admin.from("security_csrf_tokens").insert({
    token_hash: await sha256Hex(token),
    purpose,
    subject: normalizeSubject(subject),
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Falha ao emitir token CSRF: ${error.message}`);
  return { token, expiresAt };
}

/** Consome o token. Retorna false para token ausente, expirado, de outro sujeito ou já usado. */
export async function consumeCsrfToken(
  admin: SupabaseClient,
  token: string | null | undefined,
  purpose: string,
  subject: string,
): Promise<boolean> {
  const value = (token || "").trim();
  if (!value || !/^[a-f0-9]{32,128}$/i.test(value)) return false;
  const { data, error } = await admin.rpc("consume_csrf_token", {
    _token_hash: await sha256Hex(value),
    _purpose: purpose,
    _subject: normalizeSubject(subject),
  });
  if (error) {
    console.error("[csrf] consume error", error.message);
    return false;
  }
  return data === true;
}
