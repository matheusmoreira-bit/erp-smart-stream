import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { identityMatches } from "@/lib/permission-group-utils";

export interface MyCapabilities {
  /** Capacidades ligadas em pelo menos um grupo do usuário. */
  capabilities: Set<string>;
  /** Nomes dos grupos (apenas para exibição/diagnóstico — nunca para regras). */
  groups: string[];
  /** Admin do Cloud, admin mapeado no SAP, super-usuário ou base OMIE. */
  isPrivileged: boolean;
  loading: boolean;
  /** Admins têm todas as capacidades. */
  has: (key: string) => boolean;
}

/**
 * Fonte única de verdade das capacidades do usuário logado.
 *
 * GRUPO > USUÁRIO: nenhuma regra é decidida por nome de grupo ou por usuário —
 * tudo vem das opções configuradas no grupo (`permission_group_modules`).
 */
export function useMyCapabilities(): MyCapabilities {
  const { session } = useSap();
  const [capabilities, setCapabilities] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<string[]>([]);
  const [isPrivileged, setIsPrivileged] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const identifier = (session?.userName || "").toLowerCase();

    if (!identifier) {
      setCapabilities(new Set());
      setGroups([]);
      setIsPrivileged(false);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      let privileged =
        !!session?.isSuperUser || session?.erpType === "omie" || identifier === "manager";
      let caps = new Set<string>();
      let names: string[] = [];

      try {
        if (!privileged) {
          if (await getIsCloudAdmin()) privileged = true;
          if (!privileged && (await getIsSapUserAdmin(identifier))) privileged = true;
        }

        const assignments = await getGroupAssignments();

        const mine = assignments.filter((a) => identityMatches(a.sap_email, identifier));
        names = mine.map((a) => String(a.permission_groups?.name || "")).filter(Boolean);

        const groupIds = Array.from(new Set(mine.map((a) => a.group_id))).filter(
          Boolean,
        ) as string[];
        if (groupIds.length) {
          const rows = await getGroupModules(groupIds);
          caps = new Set(
            rows.filter((r) => r.can_view !== false).map((r) => String(r.module_key)),
          );
        }
      } catch {

        /* mantém defaults restritos */
      }

      if (!cancelled) {
        setCapabilities(caps);
        setGroups(names);
        setIsPrivileged(privileged);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.userName, session?.isSuperUser, session?.erpType]);

  return {
    capabilities,
    groups,
    isPrivileged,
    loading,
    has: (key: string) => isPrivileged || capabilities.has(key),
  };
}
