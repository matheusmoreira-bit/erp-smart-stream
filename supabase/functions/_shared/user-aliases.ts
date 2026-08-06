// Resolução flexível de identidade: mapeia o caller (cloud user ou sessão SAP)
// para todos os UserCodes SAP que pertencem a ele.
//
// Motivação: o e-mail corporativo muda ao longo da vida do colaborador
// (ex.: blenda.pinheiro@) enquanto o usuário SAP permanece com o nome inicial
// (blenda.pinheiro.ext) — o SAP não permite renomear UserCode. Comparar
// e-mail x UserCode diretamente gera falsos "não é você".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

// Fonte única de normalização: `_shared/text-normalize.ts`.
import { canonicalUserKey } from "./text-normalize.ts";

export function normalizeIdentity(value: string | null | undefined): string {
  return canonicalUserKey(value);
}

/**
 * Cache por instância (60s): a resolução de aliases custa 5 consultas e é
 * repetida por várias chamadas seguidas da mesma tela.
 */
const ALIASES_TTL_MS = 60_000;
const aliasesCache = new Map<string, { expiresAt: number; value: Set<string> }>();

/**
 * Conjunto de identificadores (normalizados) que representam o caller.
 * Inclui e-mail/local-part, mapeamentos IdP↔SAP, credenciais gerenciadas e
 * perfis de colaborador.
 */
export async function resolveCallerAliases(
  admin: SupabaseClient,
  caller: { id?: string; email?: string; userName?: string },
): Promise<Set<string>> {
  const cacheKey = `${caller.id || ""}|${caller.email || ""}|${caller.userName || ""}`;
  const hit = aliasesCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return new Set(hit.value);
  if (aliasesCache.size > 500) aliasesCache.clear();

  const aliases = new Set<string>();
  const add = (v?: string | null) => {
    const n = normalizeIdentity(v);
    if (n) aliases.add(n);
  };

  add(caller.userName);
  add(caller.email);

  const emails = [caller.email, caller.userName].filter(
    (v): v is string => typeof v === "string" && v.includes("@"),
  );

  const orParts: string[] = [];
  for (const e of emails) {
    const safe = e.replace(/[,()]/g, "");
    orParts.push(`idp_email.eq.${safe}`, `sap_email.eq.${safe}`);
  }
  if (caller.userName && !caller.userName.includes("@")) {
    orParts.push(`sap_user_code.eq.${caller.userName.replace(/[,()]/g, "")}`);
  }

  const safe = async <T>(p: Promise<T>): Promise<T | null> => {
    try { return await p; } catch { return null; }
  };

  // Estágio 1 — consultas independentes em paralelo.
  const [idpRes, dirByEmail, creds, profiles] = await Promise.all([
    orParts.length
      ? safe(
          admin.from("idp_user_mapping")
            .select("sap_user_code, sap_email, idp_email")
            .or(orParts.join(",")) as unknown as Promise<{ data: any[] | null }>,
        )
      : Promise.resolve(null),
    emails.length
      ? safe(
          admin.from("sap_user_emails")
            .select("user_key")
            .in("email", emails.map((e) => e.toLowerCase())) as unknown as Promise<{ data: any[] | null }>,
        )
      : Promise.resolve(null),
    caller.id && !caller.id.startsWith("sap:")
      ? safe(
          admin.from("user_sap_credentials")
            .select("sap_user")
            .eq("user_id", caller.id) as unknown as Promise<{ data: any[] | null }>,
        )
      : Promise.resolve(null),
    emails.length
      ? safe(
          admin.from("collaborator_profiles")
            .select("user_code, email")
            .in("email", emails) as unknown as Promise<{ data: any[] | null }>,
        )
      : Promise.resolve(null),
  ]);

  (idpRes?.data || []).forEach((r: Record<string, string | null>) => {
    add(r.sap_user_code);
    add(r.sap_email);
    add(r.idp_email);
  });
  (dirByEmail?.data || []).forEach((r: { user_key: string }) => add(r.user_key));
  (creds?.data || []).forEach((r: { sap_user: string | null }) => add(r.sap_user));
  (profiles?.data || []).forEach((r: { user_code: string | null }) => add(r.user_code));

  // Estágio 2 — depende dos aliases já descobertos.
  const keys = Array.from(aliases);
  if (keys.length) {
    const dirEmails = await safe(
      admin.from("sap_user_emails")
        .select("user_key, email")
        .in("user_key", keys) as unknown as Promise<{ data: any[] | null }>,
    );
    (dirEmails?.data || []).forEach((r: { user_key: string; email: string }) => {
      add(r.user_key);
      add(r.email);
    });
  }

  aliasesCache.set(cacheKey, { expiresAt: Date.now() + ALIASES_TTL_MS, value: new Set(aliases) });
  return aliases;
}

export async function callerOwnsUserCode(
  admin: SupabaseClient,
  caller: { id?: string; email?: string; userName?: string },
  userCode: string,
): Promise<boolean> {
  const target = normalizeIdentity(userCode);
  if (!target) return false;
  const aliases = await resolveCallerAliases(admin, caller);
  return aliases.has(target);
}
