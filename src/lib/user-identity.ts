/**
 * Identidade única de usuário — o USUÁRIO SAP é a chave.
 *
 * Regra do produto:
 *   usuário SAP 1:1 nome
 *   usuário SAP 1:N e-mails
 *
 * `canonicalUserKey` é o espelho da função SQL `public.canonical_user_key`:
 * minúsculas, sem domínio de e-mail, sem acentos, sem separadores e sem
 * sufixos de conta externa (.ext/.adm/...). Toda gravação de permissão,
 * alçada e vínculo deve usar essa chave — nunca o e-mail cru.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { displayUserName } from "@/lib/user-display";

const SUFFIX_RE = /[._\-\s]?(ext|externo|terceiro|adm|admin)$/;

export function canonicalUserKey(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const local = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  return local
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SUFFIX_RE, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Duas identidades (e-mail, UserCode, nome de login) são a mesma pessoa? */
export function sameUser(a: unknown, b: unknown): boolean {
  const ka = canonicalUserKey(a);
  const kb = canonicalUserKey(b);
  return !!ka && ka === kb;
}

export interface DirectoryUser {
  user_key: string;
  sap_user_code: string | null;
  display_name: string | null;
  is_active: boolean;
  emails: string[];
}

/** Entrada bruta de usuário vinda do SAP (cache ou Service Layer). */
export interface RawSapUser {
  UserCode?: string | null;
  UserName?: string | null;
  eMail?: string | null;
}

/**
 * Consolida usuários SAP de várias empresas/fontes em uma pessoa por chave
 * canônica, agregando todos os e-mails conhecidos.
 */
export function mergeSapUsers(rows: RawSapUser[]): DirectoryUser[] {
  const byKey = new Map<string, DirectoryUser>();
  for (const row of rows) {
    const key = canonicalUserKey(row.UserCode || row.eMail);
    if (!key) continue;
    const current = byKey.get(key) ?? {
      user_key: key,
      sap_user_code: null,
      display_name: null,
      is_active: true,
      emails: [],
    };
    if (!current.sap_user_code && row.UserCode) current.sap_user_code = row.UserCode.trim();
    if (!current.display_name && row.UserName?.trim()) current.display_name = row.UserName.trim();
    const email = (row.eMail || "").trim().toLowerCase();
    if (email.includes("@") && !current.emails.includes(email)) current.emails.push(email);
    byKey.set(key, current);
  }
  return Array.from(byKey.values());
}

/** Nome de exibição de uma pessoa: sempre nome, nunca e-mail cru. */
export function directoryDisplayName(user: DirectoryUser): string {
  return user.display_name?.trim() || displayUserName(user.sap_user_code || user.user_key);
}

/**
 * Diretório canônico (`sap_user_directory` + `sap_user_emails`).
 * Fonte única para exibir nome e resolver e-mails de um usuário SAP.
 */
export function useUserDirectory() {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: dir }, { data: mails }] = await Promise.all([
      supabase.from("sap_user_directory").select("user_key, sap_user_code, display_name, is_active"),
      supabase.from("sap_user_emails").select("user_key, email"),
    ]);
    const emailsByKey = new Map<string, string[]>();
    for (const m of mails || []) {
      const list = emailsByKey.get(m.user_key) ?? [];
      list.push(m.email);
      emailsByKey.set(m.user_key, list);
    }
    setUsers(
      (dir || []).map((d) => ({
        user_key: d.user_key,
        sap_user_code: d.sap_user_code,
        display_name: d.display_name,
        is_active: d.is_active,
        emails: emailsByKey.get(d.user_key) ?? [],
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const byKey = useCallback(
    (identity: unknown): DirectoryUser | undefined => {
      const key = canonicalUserKey(identity);
      return key ? users.find((u) => u.user_key === key) : undefined;
    },
    [users],
  );

  return { users, loading, refresh, byKey };
}

/**
 * Mantém o diretório em dia a partir dos usuários lidos do SAP.
 * Best-effort: só grava para administradores (RLS bloqueia os demais).
 */
export async function syncDirectoryFromSapUsers(rows: RawSapUser[]): Promise<void> {
  const merged = mergeSapUsers(rows);
  if (merged.length === 0) return;
  try {
    await supabase.from("sap_user_directory").upsert(
      merged.map((u) => ({
        user_key: u.user_key,
        sap_user_code: u.sap_user_code,
        display_name: u.display_name,
      })),
      { onConflict: "user_key" },
    );
    const emailRows = merged.flatMap((u) => u.emails.map((email) => ({ user_key: u.user_key, email })));
    if (emailRows.length > 0) {
      await supabase.from("sap_user_emails").upsert(emailRows, { onConflict: "email" });
    }
  } catch {
    /* diretório é complementar — nunca quebra a tela */
  }
}
