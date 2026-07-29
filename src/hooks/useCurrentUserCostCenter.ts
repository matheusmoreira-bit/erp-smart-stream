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
        const { data, error } = await supabase.rpc("get_my_idp_cost_center", {
          _sap_user_name: sapUserName || null,
        } as any);
        if (cancelled) return;
        if (error) {
          setCostCenter(null);
        } else {
          const cc = typeof data === "string" ? data.trim() : "";
          setCostCenter(cc || null);
        }
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
 * - Itens FOL% liberados para CC de Pessoas e Cultura (1.5.1.3) OU quando o
 *   CC do usuário estiver vazio (evita falso negativo por falha/ausência de
 *   vínculo no IdP).
 * - Itens IMP% liberados para CC 1.2.2.% OU quando o CC do usuário estiver
 *   vazio (mesma lógica de tolerância a falso negativo).
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
  // CC vazio (usuário sem vínculo no IdP) → não bloqueia (evita falso negativo).
  if (!cc) return true;
  if (code.startsWith("IMP")) return cc.startsWith("1.2.2.");
  if (code.startsWith("FOL")) return cc === "1.5.1.3" || cc.startsWith("1.5.1.3.");
  return true;
}

/**
 * Ramo (alçada) de centros de custo do usuário: os dois primeiros níveis do
 * código. Ex.: "1.6.1.2" → "1.6". Retorna null quando não há CC definido ou
 * quando o código não tem o formato esperado.
 */
export function costCenterBranch(costCenter: string | null | undefined): string | null {
  const cc = String(costCenter || "").trim();
  if (!cc) return null;
  const parts = cc.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[1]}`;
}

/**
 * Alçada de lançamento por centro de custo:
 * - Usuário do CC 1.6.1.2 pode lançar em qualquer CC 1.6.%
 * - `bypass` (super-user/admin ou grupos com visão total: Facilities,
 *   Contábil, Fiscal, Financeiro, Contas a Pagar, CFO...) libera todos.
 * - Usuário sem CC vinculado no IdP não é bloqueado (evita falso negativo).
 */
export function isCostCenterAllowedForUser(
  targetCostCenter: string | null | undefined,
  userCostCenter: string | null | undefined,
  bypass?: boolean,
): boolean {
  if (bypass) return true;
  const branch = costCenterBranch(userCostCenter);
  if (!branch) return true;
  const target = String(targetCostCenter || "").trim();
  if (!target) return true;
  return target === branch || target.startsWith(`${branch}.`);
}
