// Avaliação de grupos de permissão no servidor (Edge Functions).
//
// Arquitetura GRUPO > USUÁRIO: nenhuma regra depende do NOME do grupo. Toda
// segregação é uma capacidade configurada no grupo e persistida em
// `permission_group_modules` (can_view = liga/desliga).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Normalização: fonte única em `_shared/text-normalize.ts`.
import {
  canonicalIdentity,
  identityMatches,
  normalizeText,
  tokenizePerson,
} from "./text-normalize.ts";

export { canonicalIdentity, identityMatches };

export function normalizeGroupName(value: unknown): string {
  return normalizeText(value);
}

function personTokens(value: unknown): string[] {
  return tokenizePerson(value);
}

/** Remove sufixos de conta externa/serviço de uma chave já colapsada. */
function stripSuffix(value: string): string {
  return String(value ?? "").replace(/(ext|externo|terceiro|adm|admin)$/, "");
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


/** Nomes dos grupos de permissão associados a uma identidade (exibição/diagnóstico). */
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

/**
 * Cache por instância (60s): a mesma tela dispara várias chamadas seguidas e
 * cada uma refazia duas consultas de grupos/capacidades.
 */
const CAPS_TTL_MS = 60_000;
const capsCache = new Map<string, { expiresAt: number; value: Set<string> }>();

/** Capacidades ligadas em algum grupo da identidade. */
export async function getCapabilities(
  admin: SupabaseClient,
  identities: Array<string | null | undefined>,
): Promise<Set<string>> {
  const wanted = identities.map(canonicalIdentity).filter(Boolean);
  if (!wanted.length) return new Set();

  const cacheKey = [...wanted].sort().join("|");
  const hit = capsCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return new Set(hit.value);
  if (capsCache.size > 500) capsCache.clear();

  const { data } = await admin
    .from("user_group_assignments")
    .select("sap_email, group_id");
  const groupIds = Array.from(
    new Set(
      (data as any[] | null || [])
        .filter((row) => wanted.some((w) => identityMatches(row.sap_email, w)))
        .map((row) => row.group_id)
        .filter(Boolean),
    ),
  );
  if (!groupIds.length) return new Set();
  const { data: rows } = await admin
    .from("permission_group_modules")
    .select("module_key, can_view")
    .in("group_id", groupIds);
  return new Set(
    ((rows as any[] | null) || [])
      .filter((r) => r.can_view !== false)
      .map((r) => String(r.module_key)),
  );
}

export async function hasCapability(
  admin: SupabaseClient,
  identities: Array<string | null | undefined>,
  capability: string,
): Promise<boolean> {
  return (await getCapabilities(admin, identities)).has(capability);
}

/** Visão total de documentos — capacidade do grupo, nunca o nome dele. */
export async function canViewAllDocuments(
  admin: SupabaseClient,
  identities: Array<string | null | undefined>,
): Promise<boolean> {
  const caps = await getCapabilities(admin, identities);
  return caps.has("expenses_view_all") || caps.has("approvals_view_all");
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
 * Diretoria visível para o caller — capacidade `documents_view_directorate`.
 * Retorna null quando o grupo não tem a capacidade ou quando o IdP não define
 * o centro de custo (nesse caso ele continua vendo só os próprios).
 */
export async function resolveDirectorateBranch(
  admin: SupabaseClient,
  identities: Array<string | null | undefined>,
): Promise<string | null> {
  const caps = await getCapabilities(admin, identities);
  if (!caps.has("documents_view_directorate")) return null;
  if (caps.has("expenses_view_all") || caps.has("approvals_view_all")) return null;

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
