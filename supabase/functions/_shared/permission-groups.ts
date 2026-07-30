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
  return v.replace(/(ext|externo|terceiro|adm|admin)$/, "");
}

export function identityMatches(a: unknown, b: unknown): boolean {
  const ca = canonicalIdentity(a);
  const cb = canonicalIdentity(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  return stripSuffix(ca) === stripSuffix(cb);
}

function personTokens(value: unknown): string[] {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/@[^\s]*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    // conectivos de nomes próprios não identificam ninguém
    .filter((t) => !["de", "da", "do", "das", "dos", "e"].includes(t));
}

/**
 * Comparação de PESSOAS tolerante ao formato: `expenses.current_approver`
 * ora guarda o UserCode SAP (`andresa.carvalho`), ora o e-mail, ora o nome
 * completo ("Andresa De Carvalho"). Além do match canônico, aceita quando
 * todos os tokens de um lado estão contidos no outro (mínimo 2 tokens, ou
 * 1 token quando o outro lado também tem só 1).
 */
export function personMatches(a: unknown, b: unknown): boolean {
  if (identityMatches(a, b)) return true;
  const ta = personTokens(a);
  const tb = personTokens(b);
  if (!ta.length || !tb.length) return false;

  // Um dos lados pode chegar já "colapsado" (alias normalizado sem separadores:
  // "andresacarvalho"), enquanto o outro é o nome completo ("Andresa De
  // Carvalho"). Comparar as concatenações resolve esse caso.
  const ja = ta.join("");
  const jb = tb.join("");
  if (ja === jb) return true;
  if (stripSuffix(ja) === stripSuffix(jb)) return true;

  // Lado colapsado contendo os tokens do outro (mínimo 2 tokens para evitar
  // falsos positivos com nomes curtos).
  if (ta.length === 1 && tb.length >= 2 && ja.includes(jb)) return true;
  if (tb.length === 1 && ta.length >= 2 && jb.includes(ja)) return true;

  const subset = (x: string[], y: string[]) => x.every((t) => y.includes(t));
  if (ta.length >= 2 && subset(ta, tb)) return true;
  if (tb.length >= 2 && subset(tb, ta)) return true;
  if (ta.length === 1 && tb.length === 1) return ta[0] === tb[0];
  return false;
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
  // "Usuário Administrativo" não é visão total: é escopo por diretoria.
  return groups.some(
    (g) => !BASIC_GROUPS.has(normalizeGroupName(g)) && !isDirectorateGroup(g),
  );
}

/**
 * Grupo "Usuário Administrativo": vê todos os documentos da própria diretoria
 * (centro de custo de 2º nível informado pelo IdP), e não a base inteira.
 */
export function isDirectorateGroup(name: unknown): boolean {
  const n = normalizeGroupName(name);
  return n === "usuario administrativo" || n === "usuarios administrativos";
}

/** Ramo (diretoria) de um centro de custo: "1.6.1.2" → "1.6". */
export function costCenterBranch(costCenter: unknown): string | null {
  const cc = String(costCenter ?? "").trim();
  if (!cc) return null;
  const parts = cc.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[1]}`;
}

export function costCenterInBranch(costCenter: unknown, branch: string | null): boolean {
  if (!branch) return false;
  const cc = String(costCenter ?? "").trim();
  if (!cc) return false;
  return cc === branch || cc.startsWith(`${branch}.`);
}

/**
 * Diretoria visível para o caller quando ele pertence ao grupo
 * "Usuário Administrativo". Retorna null quando não é do grupo ou quando o IdP
 * não define o centro de custo (nesse caso ele continua vendo só os próprios).
 */
export async function resolveDirectorateBranch(
  admin: SupabaseClient,
  identities: Array<string | null | undefined>,
): Promise<string | null> {
  const groups = await getPermissionGroups(admin, identities);
  if (!groups.some((g) => isDirectorateGroup(g))) return null;

  const wanted = identities.map(canonicalIdentity).filter(Boolean);
  if (!wanted.length) return null;
  const { data } = await admin
    .from("idp_user_mapping")
    .select("sap_email, idp_email, sap_user_code, cost_center_code");
  for (const row of (data || []) as any[]) {
    const hit = [row.sap_email, row.idp_email, row.sap_user_code].some((v) =>
      wanted.some((w) => identityMatches(v, w)),
    );
    if (hit) {
      const branch = costCenterBranch(row.cost_center_code);
      if (branch) return branch;
    }
  }
  return null;
}
