// Revogação de sessões ERP (SAP B1) — pentest 3.3.
//
// O Service Layer mantém o B1SESSION válido mesmo após a troca de senha.
// Aqui registramos o hash das sessões que devem morrer imediatamente; o
// validador de sessão (`_shared/auth.ts`) recusa qualquer requisição que
// apresente uma sessão revogada, forçando novo login.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { sha256Hex } from "./csrf.ts";

export { sha256Hex };

export interface RevokeParams {
  sapSession: string;
  userKey: string;
  companyDb?: string | null;
  reason?: string;
}

export async function revokeErpSession(admin: SupabaseClient, params: RevokeParams): Promise<void> {
  const sid = (params.sapSession || "").trim();
  if (!sid) return;
  try {
    const { error } = await admin.from("erp_session_revocations").upsert({
      sid_hash: await sha256Hex(sid),
      user_key: (params.userKey || "").toLowerCase(),
      company_db: params.companyDb || null,
      reason: params.reason || "password_change",
      revoked_at: new Date().toISOString(),
    }, { onConflict: "sid_hash" });
    if (error) console.error("[session-revocation] upsert error", error.message);
  } catch (e) {
    console.error("[session-revocation] exception", e instanceof Error ? e.message : String(e));
  }
}

const revokedCache = new Map<string, { until: number; revoked: boolean }>();
const CACHE_TTL_MS = 30_000;

/** Falha aberta em erro de infraestrutura: o objetivo é revogar, não derrubar o app. */
export async function isErpSessionRevoked(admin: SupabaseClient, sapSession: string): Promise<boolean> {
  const sid = (sapSession || "").trim();
  if (!sid) return false;
  const hash = await sha256Hex(sid);
  const cached = revokedCache.get(hash);
  if (cached && cached.until > Date.now()) return cached.revoked;
  try {
    const { data, error } = await admin.rpc("is_erp_session_revoked", { _sid_hash: hash });
    if (error) {
      console.error("[session-revocation] check error", error.message);
      return false;
    }
    const revoked = data === true;
    revokedCache.set(hash, { until: Date.now() + (revoked ? 300_000 : CACHE_TTL_MS), revoked });
    if (revokedCache.size > 500) {
      for (const [k, v] of revokedCache) if (v.until <= Date.now()) revokedCache.delete(k);
    }
    return revoked;
  } catch {
    return false;
  }
}
