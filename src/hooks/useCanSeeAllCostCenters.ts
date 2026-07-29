import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

/**
 * Grupos de permissão cujos membros podem ver/selecionar TODOS os centros de
 * custo (e, por consequência, não sofrem as restrições de item por alçada de CC).
 */
const FULL_COST_CENTER_GROUPS = ["facilities", "admin"];

/**
 * Indica se o usuário logado pode enxergar todos os centros de custo:
 * - super-usuário SAP / conta "manager" / bases OMIE
 * - admin do Cloud (user_roles.role = 'admin') ou admin no SAP
 * - membro de um grupo de permissão liberado (ex.: Facilities)
 */
export function useCanSeeAllCostCenters(): { canSeeAll: boolean; loading: boolean } {
  const { session } = useSap();
  const [canSeeAll, setCanSeeAll] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const identifier = (session?.userName || "").toLowerCase();

    if (!identifier) {
      setCanSeeAll(false);
      setLoading(false);
      return;
    }

    if (session?.isSuperUser || session?.erpType === "omie" || identifier === "manager") {
      setCanSeeAll(true);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (authSession?.user) {
          const { data: roleData } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", authSession.user.id)
            .eq("role", "admin")
            .maybeSingle();
          if (roleData) {
            if (!cancelled) { setCanSeeAll(true); setLoading(false); }
            return;
          }
        }

        const { data: isAdminBySap } = await supabase.rpc("is_sap_user_admin", {
          _sap_username: identifier,
        });
        if (isAdminBySap) {
          if (!cancelled) { setCanSeeAll(true); setLoading(false); }
          return;
        }

        const { data: assignments } = await supabase
          .from("user_group_assignments")
          .select("sap_email, permission_groups(name)");

        const allowed = (assignments || []).some((a: any) => {
          const email = String(a.sap_email || "").toLowerCase();
          const matchesUser = email === identifier || email.startsWith(identifier + "@");
          if (!matchesUser) return false;
          const groupName = String(a.permission_groups?.name || "").toLowerCase().trim();
          return FULL_COST_CENTER_GROUPS.includes(groupName);
        });

        if (!cancelled) { setCanSeeAll(allowed); setLoading(false); }
      } catch {
        if (!cancelled) { setCanSeeAll(false); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [session?.userName, session?.isSuperUser, session?.erpType]);

  return { canSeeAll, loading };
}
