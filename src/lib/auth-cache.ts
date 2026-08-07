import { supabase } from "@/integrations/supabase/client";

/**
 * Cache compartilhado das consultas de identidade/permissão.
 *
 * Vários hooks (useAuth, usePermissions, useMyCapabilities,
 * useMyPermissionGroups…) são instanciados dezenas de vezes por tela e todos
 * faziam as MESMAS consultas (`user_roles`, `is_sap_user_admin`,
 * `user_group_assignments`, `permission_group_modules`). Isso enfileirava
 * dezenas de requisições antes dos dados de negócio começarem a carregar.
 *
 * Aqui as promessas são memoizadas por chave: chamadas concorrentes
 * compartilham a MESMA requisição e o resultado é reaproveitado por um curto
 * intervalo (TTL). Nenhuma decisão de segurança muda — o servidor (RLS/edge)
 * continua sendo a fonte de verdade.
 */
const TTL_MS = 60_000;

type Entry = { at: number; promise: Promise<unknown> };
const store = new Map<string, Entry>();

function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<T>;
  const promise = fn().catch((e) => {
    // Falhas não são cacheadas: a próxima chamada tenta de novo.
    store.delete(key);
    throw e;
  });
  store.set(key, { at: Date.now(), promise });
  return promise;
}

/** Limpa o cache (login/logout, troca de empresa, mudança de permissões). */
export function clearAuthCache(): void {
  store.clear();
}

// Qualquer mudança de sessão invalida tudo.
try {
  supabase.auth.onAuthStateChange(() => clearAuthCache());
} catch {
  /* ambiente sem auth (testes) */
}

/**
 * `true` quando o usuário logado tem papel admin no Cloud.
 *
 * Durante uma impersonação os privilégios de admin ficam suspensos: o app
 * precisa enxergar exatamente o que o usuário alvo enxerga.
 */
export function getIsCloudAdmin(): Promise<boolean> {
  if (isImpersonating()) return Promise.resolve(false);
  return memo("cloud-admin", async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return false;
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .eq("role", "admin")
      .maybeSingle();
    return !!data;
  });
}

/** `true` quando o usuário do ERP está mapeado como admin. */
export function getIsSapUserAdmin(identifier: string): Promise<boolean> {
  const id = (identifier || "").toLowerCase();
  if (!id) return Promise.resolve(false);
  return memo(`sap-admin:${id}`, async () => {
    const { data } = await supabase.rpc("is_sap_user_admin", { _sap_username: id });
    return !!data;
  });
}

export interface GroupAssignmentRow {
  sap_email: string | null;
  group_id: string | null;
  permission_groups?: { name?: string | null } | null;
}

/** Vínculos usuário × grupo (tabela pequena, lida uma vez por TTL). */
export function getGroupAssignments(): Promise<GroupAssignmentRow[]> {
  return memo("group-assignments", async () => {
    const { data } = await supabase
      .from("user_group_assignments")
      .select("sap_email, group_id, permission_groups(name)");
    return (data || []) as unknown as GroupAssignmentRow[];
  });
}

export interface GroupModuleRow {
  module_key: string;
  group_id: string;
  can_view: boolean | null;
  can_create: boolean | null;
  can_edit: boolean | null;
  can_delete: boolean | null;
  can_approve: boolean | null;
  can_integrate: boolean | null;
  can_export: boolean | null;
}

/** Módulos/capacidades dos grupos informados. */
export function getGroupModules(groupIds: string[]): Promise<GroupModuleRow[]> {
  const ids = Array.from(new Set(groupIds.filter(Boolean))).sort();
  if (ids.length === 0) return Promise.resolve([]);
  return memo(`group-modules:${ids.join(",")}`, async () => {
    const { data } = await supabase
      .from("permission_group_modules")
      .select(
        "module_key, group_id, can_view, can_create, can_edit, can_delete, can_approve, can_integrate, can_export",
      )
      .in("group_id", ids);
    return (data || []) as unknown as GroupModuleRow[];
  });
}
