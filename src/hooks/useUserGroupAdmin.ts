import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { identityMatches } from "@/lib/permission-group-utils";
import { canonicalUserKey } from "@/lib/user-identity";

export type PermissionGroupOption = { id: string; name: string; company_db: string | null };
type Assignment = { id: string; sap_email: string; group_id: string; company_db: string | null };

/**
 * Administração do grupo de permissão/acesso de um usuário.
 * company_db NULL é legado/global; quando informado, o vínculo vale só naquela empresa.
 */
export function useUserGroupAdmin() {
  const [groups, setGroups] = useState<PermissionGroupOption[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: g }, { data: a }] = await Promise.all([
      supabase.from("permission_groups").select("id, name, company_db").order("name"),
      supabase.from("user_group_assignments").select("id, sap_email, group_id, company_db"),
    ]);
    setGroups((g || []) as PermissionGroupOption[]);
    setAssignments((a || []) as Assignment[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Nome do grupo atual do usuário (considera aliases: username, e-mail, .ext, acentos). */
  const groupOf = useCallback(
    (companyDb: string | null | undefined, ...identities: (string | null | undefined)[]) => {
      const scoped = assignments.find((as) =>
        as.company_db === companyDb &&
        identities.some((id) => id && identityMatches(as.sap_email, id)),
      );
      const match = scoped || assignments.find((as) =>
        as.company_db === null &&
        identities.some((id) => id && identityMatches(as.sap_email, id)),
      );
      if (!match) return null;
      const group = groups.find((g) => g.id === match.group_id);
      return group ? { id: group.id, name: group.name, company_db: match.company_db } : null;
    },
    [assignments, groups],
  );

  /**
   * Define o grupo/acesso do usuário no escopo informado.
   */
  const setGroup = useCallback(
    async (opts: { userCode: string; email?: string | null; groupId: string | null; companyDb?: string | null }) => {
      const identities = [opts.userCode, opts.email].filter(Boolean) as string[];
      const companyDb = opts.companyDb ?? null;
      const stale = assignments.filter((as) =>
        as.company_db === companyDb &&
        identities.some((id) => identityMatches(as.sap_email, id)),
      );
      if (stale.length > 0) {
        const { error } = await supabase
          .from("user_group_assignments")
          .delete()
          .in("id", stale.map((s) => s.id));
        if (error) throw new Error(error.message);
      }

      if (opts.groupId) {
        // Uma pessoa = um usuário SAP: grava SEMPRE a chave canônica única.
        const key = canonicalUserKey(opts.userCode || opts.email);
        if (!key) throw new Error("Usuário SAP inválido");
        const { error } = await supabase.from("user_group_assignments").insert(
          [{ sap_email: key, group_id: opts.groupId, company_db: companyDb }],
        );
        if (error) throw new Error(error.message);
      }

      await refresh();
    },
    [assignments, refresh],
  );

  return { groups, loading, groupOf, setGroup, refresh };
}
