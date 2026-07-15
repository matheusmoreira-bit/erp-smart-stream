import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna o centro de custo do usuário logado, obtido a partir do
 * mapeamento IdP (`idp_user_mapping.cost_center_code`) casando por e-mail
 * (sap_email ou idp_email, case-insensitive).
 *
 * Usado para pré-preencher o CC padrão nos fluxos de compras e para
 * restringir itens sensíveis (IMP%, FOL%) por alçada de CC.
 */
export function useCurrentUserCostCenter() {
  const [costCenter, setCostCenter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const email = userRes?.user?.email?.toLowerCase().trim();
        if (!email) {
          if (!cancelled) setCostCenter(null);
          return;
        }
        const { data } = await supabase
          .from("idp_user_mapping")
          .select("cost_center_code, sap_email, idp_email, attributes_synced_at")
          .or(`sap_email.ilike.${email},idp_email.ilike.${email}`)
          .order("attributes_synced_at", { ascending: false, nullsFirst: false })
          .limit(5);
        if (cancelled) return;
        const row = (data || []).find((r: any) => r.cost_center_code);
        setCostCenter(row?.cost_center_code || null);
      } catch {
        if (!cancelled) setCostCenter(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { costCenter, loading };
}

/**
 * Aplica as regras de alçada de itens por centro de custo:
 * - Itens IMP% só liberados para CC 1.2.2.%
 * - Itens FOL% só liberados para CC 1.6.%
 */
export function isItemAllowedForCostCenter(itemCode: string | null | undefined, costCenter: string | null | undefined): boolean {
  const code = String(itemCode || "").toUpperCase().trim();
  const cc = String(costCenter || "").trim();
  if (code.startsWith("IMP")) return cc.startsWith("1.2.2.");
  if (code.startsWith("FOL")) return cc.startsWith("1.6.");
  return true;
}
