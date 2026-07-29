// Avaliação de grupos de permissão no servidor (Edge Functions).
//
// Regra do produto: apenas membros do grupo "Usuário" ficam restritos aos
// próprios documentos. Qualquer outro grupo (Facilities, Fiscal, Financeiro,
// Contas a Pagar/Receber, CFO, Contábil, PagCorp, Admin...) pode ver todos os
// documentos — e, por consequência, todos os anexos.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const BASIC_GROUPS = new Set(["usuario", "usuarios", "user", "users"]);

export function normalizeGroupName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function canonicalIdentity(value: unknown): string {
  const raw = String(value ?? "").toLowerCase().trim();
  const prefix = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  return prefix
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function stripSuffix(v: string): string {
  return v.replace(/(ext|externo|terceiro)$/, "");
}

export function identityMatches(a: unknown, b: unknown): boolean {
  const ca = canonicalIdentity(a);
  const cb = canonicalIdentity(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  return stripSuffix(ca) === stripSuffix(cb);
}

/** Nomes dos grupos de permissão associados a uma identidade. */
export async function getPermissionGroups(
  admin: SupabaseClient,
  identities: Array<string | null | undefined>,
): Promise<string[]> {
  const wanted = identities.map(canonicalIdentity).filter(Boolean);
  if (!wanted.length) return [];
  const { data, error } = await admin
    .from("user_group_assignments")
    .select("sap_email, permission_groups(name)");
  if (error || !data) return [];
  return (data as any[])
    .filter((row) => wanted.some((w) => identityMatches(row.sap_email, w)))
    .map((row) => String(row.permission_groups?.name || ""))
    .filter(Boolean);
}

/** True quando a identidade pertence a algum grupo que não seja "Usuário". */
export async function canViewAllDocuments(
  admin: SupabaseClient,
  identities: Array<string | null | undefined>,
): Promise<boolean> {
  const groups = await getPermissionGroups(admin, identities);
  return groups.some((g) => !BASIC_GROUPS.has(normalizeGroupName(g)));
}
