// Resolução flexível de identidade: mapeia o caller (cloud user ou sessão SAP)
// para todos os UserCodes SAP que pertencem a ele.
//
// Motivação: o e-mail corporativo muda ao longo da vida do colaborador
// (ex.: blenda.pinheiro@) enquanto o usuário SAP permanece com o nome inicial
// (blenda.pinheiro.ext) — o SAP não permite renomear UserCode. Comparar
// e-mail x UserCode diretamente gera falsos "não é você".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

export function normalizeIdentity(value: string | null | undefined): string {
  if (!value) return "";
  const raw = String(value).trim().toLowerCase();
  const local = raw.includes("@") ? raw.split("@")[0] : raw;
  return local
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // sufixos comuns de contas de terceiros/externos e separadores
    .replace(/[._\-\s]?(ext|externo|terceiro|adm|admin)$/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Conjunto de identificadores (normalizados) que representam o caller.
 * Inclui e-mail/local-part, mapeamentos IdP↔SAP, credenciais gerenciadas e
 * perfis de colaborador.
 */
export async function resolveCallerAliases(
  admin: SupabaseClient,
  caller: { id?: string; email?: string; userName?: string },
): Promise<Set<string>> {
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

  try {
    const orParts: string[] = [];
    for (const e of emails) {
      const safe = e.replace(/[,()]/g, "");
      orParts.push(`idp_email.eq.${safe}`, `sap_email.eq.${safe}`);
    }
    if (caller.userName && !caller.userName.includes("@")) {
      orParts.push(`sap_user_code.eq.${caller.userName.replace(/[,()]/g, "")}`);
    }
    if (orParts.length) {
      const { data } = await admin
        .from("idp_user_mapping")
        .select("sap_user_code, sap_email, idp_email")
        .or(orParts.join(","));
      (data || []).forEach((r: Record<string, string | null>) => {
        add(r.sap_user_code);
        add(r.sap_email);
        add(r.idp_email);
      });
    }
  } catch { /* mapeamento opcional */ }

  // Diretório canônico: usuário SAP 1:N e-mails.
  try {
    const keys = Array.from(aliases);
    if (keys.length) {
      const { data: dirEmails } = await admin
        .from("sap_user_emails")
        .select("user_key, email")
        .in("user_key", keys);
      (dirEmails || []).forEach((r: { user_key: string; email: string }) => {
        add(r.user_key);
        add(r.email);
      });
    }
    if (emails.length) {
      const { data: byEmail } = await admin
        .from("sap_user_emails")
        .select("user_key")
        .in("email", emails.map((e) => e.toLowerCase()));
      (byEmail || []).forEach((r: { user_key: string }) => add(r.user_key));
    }
  } catch { /* diretório é complementar */ }

  try {
    if (caller.id && !caller.id.startsWith("sap:")) {
      const { data } = await admin
        .from("user_sap_credentials")
        .select("sap_user")
        .eq("user_id", caller.id);
      (data || []).forEach((r: { sap_user: string | null }) => add(r.sap_user));
    }
  } catch { /* opcional */ }

  try {
    if (emails.length) {
      const { data } = await admin
        .from("collaborator_profiles")
        .select("user_code, email")
        .in("email", emails);
      (data || []).forEach((r: { user_code: string | null }) => add(r.user_code));
    }
  } catch { /* opcional */ }

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
