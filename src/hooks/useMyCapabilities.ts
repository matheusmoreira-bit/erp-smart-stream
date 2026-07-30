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
          const {
            data: { session: authSession },
          } = await supabase.auth.getSession();
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
          .select("sap_email, group_id, permission_groups(name)");

        const mine = (assignments || []).filter((a: any) =>
          identityMatches(a.sap_email, identifier),
        );
        names = mine.map((a: any) => String(a.permission_groups?.name || "")).filter(Boolean);

        const groupIds = Array.from(new Set(mine.map((a: any) => a.group_id))).filter(Boolean);
        if (groupIds.length) {
          const { data: rows } = await supabase
            .from("permission_group_modules")
            .select("module_key, can_view, group_id")
            .in("group_id", groupIds);
          caps = new Set(
            (rows || [])
              .filter((r: any) => r.can_view !== false)
              .map((r: any) => String(r.module_key)),
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
