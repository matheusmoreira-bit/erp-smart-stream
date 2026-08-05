// Redirecionamento de centros de custo desativados.
//
// Alguns CCs foram desativados no ERP mas continuam sendo escolhidos em
// integrações/lançamentos antigos. Em vez de o documento cair na lacuna da
// matriz (fallback global), redirecionamos o CC (e opcionalmente o projeto)
// para a alçada ativa equivalente, conforme public.cost_center_redirects.
//
// Ex.: CRM BETBET (1.10.4.9) → CC 1.10.2.5 + Projeto BET.BET.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface CcRedirectRow {
  from_cost_center: string;
  to_cost_center: string;
  to_project: string | null;
  reason: string | null;
}

export interface CcRedirectResult {
  costCenter: string | null;
  project: string | null;
  redirected: boolean;
  from?: string;
  reason?: string | null;
}

const norm = (v: unknown) => String(v ?? "").trim();

export async function loadCcRedirects(
  admin: SupabaseClient,
  companyDb: string,
): Promise<Map<string, CcRedirectRow>> {
  const map = new Map<string, CcRedirectRow>();
  if (!companyDb) return map;
  const { data, error } = await admin
    .from("cost_center_redirects")
    .select("from_cost_center, to_cost_center, to_project, reason")
    .eq("company_db", companyDb)
    .eq("is_active", true);
  if (error) return map;
  for (const row of (data || []) as CcRedirectRow[]) {
    const key = norm(row.from_cost_center);
    if (key) map.set(key, row);
  }
  return map;
}

/** Aplica o redirecionamento a um par CC/projeto. Não altera nada quando o CC está ativo. */
export function applyCcRedirect(
  redirects: Map<string, CcRedirectRow>,
  costCenter: unknown,
  project: unknown,
): CcRedirectResult {
  const cc = norm(costCenter);
  const proj = norm(project);
  const hit = cc ? redirects.get(cc) : undefined;
  if (!hit) {
    return { costCenter: cc || null, project: proj || null, redirected: false };
  }
  return {
    costCenter: norm(hit.to_cost_center) || cc,
    // O projeto do redirecionamento só é aplicado quando definido; caso contrário
    // preservamos o projeto original do documento.
    project: norm(hit.to_project) || proj || null,
    redirected: true,
    from: cc,
    reason: hit.reason,
  };
}
