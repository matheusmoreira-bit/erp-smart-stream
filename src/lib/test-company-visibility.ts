import { supabase } from "@/integrations/supabase/client";
import { identityMatches } from "@/lib/permission-group-utils";
import {
  getIsCloudAdmin,
  getIsSapUserAdmin,
  getGroupAssignments,
  getGroupModules,
} from "@/lib/auth-cache";



/**
 * Capability key (permission_group_modules.module_key) que libera a visão de
 * empresas de teste (TST%/SBO_TESTE%) para os membros do grupo.
 */
export const TEST_COMPANIES_CAPABILITY = "test_companies_view";

let allowed = false;
let resolvedFor: string | null = null;
const listeners = new Set<(v: boolean) => void>();

/** Flag atual (uso fora do React). */
export function canViewTestCompanies(): boolean {
  return allowed;
}

export function subscribeTestCompanyVisibility(cb: (v: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function setAllowed(next: boolean) {
  if (allowed === next) return;
  allowed = next;
  listeners.forEach((cb) => cb(next));
}

/**
 * Resolve se o usuário atual pode enxergar empresas de teste:
 *  - admins (Cloud role admin, admin mapeado no SAP, super-usuário) → sempre;
 *  - membros de grupo com a capability `test_companies_view` ligada.
 */
export async function resolveTestCompanyVisibility(params: {
  identifier: string | null | undefined;
  isSuperUser?: boolean;
}): Promise<boolean> {
  const identifier = (params.identifier || "").toLowerCase();
  const cacheKey = `${identifier}|${params.isSuperUser ? 1 : 0}`;

  if (!identifier) {
    resolvedFor = cacheKey;
    setAllowed(false);
    return false;
  }
  if (resolvedFor === cacheKey) return allowed;
  resolvedFor = cacheKey;

  let can = !!params.isSuperUser || identifier === "manager";

  try {
    if (!can) {
      if (await getIsCloudAdmin()) can = true;
      if (!can && (await getIsSapUserAdmin(identifier))) can = true;
    }


    if (!can) {
      const assignments = await getGroupAssignments();
      const mine = assignments.filter((a) => identityMatches(a.sap_email, identifier));
      const modules = await getGroupModules(
        mine.map((a) => a.group_id).filter(Boolean) as string[],
      );
      can = modules.some(
        (m) => m.module_key === TEST_COMPANIES_CAPABILITY && m.can_view !== false,
      );
    }

  } catch {
    can = false;
  }

  setAllowed(can);
  return can;
}

/** Limpa o estado (logout / troca de usuário). */
export function resetTestCompanyVisibility() {
  resolvedFor = null;
  setAllowed(false);
}
