import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { identityMatches } from "@/lib/permission-group-utils";

export type PermissionGroupOption = { id: string; name: string; company_db: string | null };
type Assignment = { id: string; sap_email: string; group_id: string };

/**
 * Administração do grupo de permissão de um usuário a partir da tela de Usuários.
 * O vínculo é GLOBAL: alterar o grupo em uma empresa altera para todas.
 */
export function useUserGroupAdmin() {
  const [groups, setGroups] = useState<PermissionGroupOption[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: g }, { data: a }] = await Promise.all([
      supabase.from("permission_groups").select("id, name, company_db").order("name"),
      supabase.from("user_group_assignments").select("id, sap_email, group_id"),
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
    (...identities: (string | null | undefined)[]) => {
      const match = assignments.find((as) =>
        identities.some((id) => id && identityMatches(as.sap_email, id)),
      );
      if (!match) return null;
      const group = groups.find((g) => g.id === match.group_id);
      return group ? { id: group.id, name: group.name } : null;
    },
    [assignments, groups],
  );

  /**
   * Define o grupo do usuário globalmente: remove todos os vínculos das
   * identidades equivalentes e grava as chaves de username e e-mail.
   */
  const setGroup = useCallback(
    async (opts: { userCode: string; email?: string | null; groupId: string | null }) => {
      const identities = [opts.userCode, opts.email].filter(Boolean) as string[];
      const stale = assignments.filter((as) =>
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
        const keys = Array.from(
          new Set(identities.map((i) => i.toLowerCase().trim()).filter(Boolean)),
        );
        const { error } = await supabase.from("user_group_assignments").upsert(
          keys.map((sap_email) => ({ sap_email, group_id: opts.groupId!, company_db: null })),
          { onConflict: "sap_email,group_id" },
        );
        if (error) throw new Error(error.message);
      }

      await refresh();
    },
    [assignments, refresh],
  );

  return { groups, loading, groupOf, setGroup, refresh };
}
