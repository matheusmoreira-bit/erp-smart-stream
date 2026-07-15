import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

/**
 * Retorna o centro de custo do usuário logado, obtido a partir do
 * mapeamento IdP (`idp_user_mapping.cost_center_code`) casando por e-mail
 * (sap_email ou idp_email, case-insensitive).
 *
 * Considera tanto o e-mail do Supabase Auth quanto o userName da sessão SAP
 * (que costuma ser o e-mail ou o local-part).
 *
 * Usado para pré-preencher o CC padrão nos fluxos de compras e para
 * restringir itens sensíveis (IMP%, FOL%) por alçada de CC.
 */
export function useCurrentUserCostCenter() {
  const { session } = useSap();
  const sapUserName = session?.userName || "";
  const [costCenter, setCostCenter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const authEmail = userRes?.user?.email?.toLowerCase().trim() || "";
        const sap = sapUserName.toLowerCase().trim();

        // Build candidate matchers: full email OR local-part (username).
        const candidates = new Set<string>();
        if (authEmail) candidates.add(authEmail);
        if (sap) {
          candidates.add(sap);
          if (!sap.includes("@")) {
            // username only — match sap_email/idp_email starting with "sap@"
            candidates.add(`${sap}@%`);
          }
        }

        if (candidates.size === 0) {
          if (!cancelled) setCostCenter(null);
          return;
        }

        const filters: string[] = [];
        for (const c of candidates) {
          filters.push(`sap_email.ilike.${c}`);
          filters.push(`idp_email.ilike.${c}`);
        }

        const { data } = await supabase
          .from("idp_user_mapping")
          .select("cost_center_code, sap_email, idp_email, attributes_synced_at")
          .or(filters.join(","))
          .order("attributes_synced_at", { ascending: false, nullsFirst: false })
          .limit(10);
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
  }, [sapUserName]);

  return { costCenter, loading };
}

/**
 * Aplica as regras de alçada de itens por centro de custo:
 * - Itens IMP% só liberados para CC 1.2.2.%
 * - Itens FOL% só liberados para CC 1.6.%
 *
 * `bypass` (super-user / admin) libera todos os itens.
 */
export function isItemAllowedForCostCenter(
  itemCode: string | null | undefined,
  costCenter: string | null | undefined,
  bypass?: boolean,
): boolean {
  if (bypass) return true;
  const code = String(itemCode || "").toUpperCase().trim();
  const cc = String(costCenter || "").trim();
  if (code.startsWith("IMP")) return cc.startsWith("1.2.2.");
  if (code.startsWith("FOL")) return cc.startsWith("1.6.");
  return true;
}
