import { useEffect, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import { identityMatches } from "@/lib/permission-group-utils";
import { getIsCloudAdmin, getIsSapUserAdmin, getGroupAssignments } from "@/lib/auth-cache";


export interface MyPermissionGroups {
  /** Nomes dos grupos de permissão do usuário logado. */
  groups: string[];
  /** Admin do Cloud, admin mapeado no SAP, super-usuário ou base OMIE. */
  isPrivileged: boolean;
  loading: boolean;
}

/**
 * Carrega os grupos de permissão do usuário logado (via user_group_assignments),
 * com casamento flexível de identidade (email x usuário SAP, sufixos, acentos).
 */
export function useMyPermissionGroups(): MyPermissionGroups {
  const { session } = useSap();
  const [groups, setGroups] = useState<string[]>([]);
  const [isPrivileged, setIsPrivileged] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const identifier = (session?.userName || "").toLowerCase();

    if (!identifier) {
      setGroups([]);
      setIsPrivileged(false);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      let privileged =
        !!session?.isSuperUser || session?.erpType === "omie" || identifier === "manager";
      let names: string[] = [];

      try {
        if (!privileged) {
          const { data: { session: authSession } } = await supabase.auth.getSession();
          if (authSession?.user) {
            const { data: roleData } = await supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", authSession.user.id)
              .eq("role", "admin")
              .maybeSingle();
            if (roleData) privileged = true;
          }
          if (!privileged) {
            const { data: isAdminBySap } = await supabase.rpc("is_sap_user_admin", {
              _sap_username: identifier,
            });
            if (isAdminBySap) privileged = true;
          }
        }

        const { data: assignments } = await supabase
          .from("user_group_assignments")
          .select("sap_email, permission_groups(name)");

        names = (assignments || [])
          .filter((a: any) => identityMatches(a.sap_email, identifier))
          .map((a: any) => String(a.permission_groups?.name || ""))
          .filter(Boolean);
      } catch {
        /* mantém defaults */
      }

      if (!cancelled) {
        setGroups(names);
        setIsPrivileged(privileged);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [session?.userName, session?.isSuperUser, session?.erpType]);

  return { groups, isPrivileged, loading };
}
