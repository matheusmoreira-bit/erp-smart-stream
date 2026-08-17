import { useEffect } from "react";
import { useSap } from "@/contexts/SapContext";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentAuthSession } from "@/lib/fake-auth";
import { resolveTestCompanyVisibility, resetTestCompanyVisibility } from "@/lib/test-company-visibility";

/**
 * Resolve, no login/troca de usuário, se as empresas de teste devem aparecer.
 * Não renderiza nada — apenas mantém a flag global usada por useCompanies.
 */
export function TestCompanyVisibilityGate() {
  const { session } = useSap();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let identifier = session?.userName || null;
      if (!identifier) {
        const { data: { session: authSession } } = await getCurrentAuthSession(() => supabase.auth.getSession());
        identifier = authSession?.user?.email || null;
      }
      if (cancelled) return;
      if (!identifier) {
        resetTestCompanyVisibility();
        return;
      }
      await resolveTestCompanyVisibility({
        identifier,
        isSuperUser: !!session?.isSuperUser,
      });
    })();
    return () => { cancelled = true; };
  }, [session?.userName, session?.isSuperUser]);

  return null;
}
