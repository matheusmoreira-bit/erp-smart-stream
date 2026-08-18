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
          if (await getIsCloudAdmin()) privileged = true;
          if (!privileged && (await getIsSapUserAdmin(identifier))) privileged = true;
        }

        const assignments = await getGroupAssignments();

        names = assignments
          .filter((a) =>
            (a.company_db === null || a.company_db === session?.companyDB) &&
            identityMatches(a.sap_email, identifier),
          )
          .map((a) => String(a.permission_groups?.name || ""))
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
  }, [session?.companyDB, session?.userName, session?.isSuperUser, session?.erpType]);

  return { groups, isPrivileged, loading };
}
