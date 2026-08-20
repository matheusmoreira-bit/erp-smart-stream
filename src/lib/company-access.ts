import { supabase } from "@/integrations/supabase/client";

/**
 * Validação de acesso à empresa usando APENAS a identidade já autenticada
 * (Google / Lovable Cloud). Nenhuma credencial do ERP é necessária para
 * entrar/trocar de empresa — a sessão do ERP é criada sob demanda, somente
 * quando uma ação exigir a identidade do usuário no Service Layer.
 *
 * As checagens rodam em RPCs SECURITY DEFINER no servidor.
 */

export async function isEmailAllowedForCompany(email: string, companyDb: string): Promise<boolean> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc("is_email_allowed_for_company", { _email: email, _company_db: companyDb });
  if (error) {
    console.error("[company-allowlist] rpc failed:", error);
    return false;
  }
  return data === true;
}

export async function isEmailAllowedForOmieCompany(email: string, companyDb: string): Promise<boolean> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc("is_email_allowed_for_omie_company", { _email: email, _company_db: companyDb });
  if (error) {
    console.error("[omie-allowlist] rpc failed:", error);
    return false;
  }
  return data === true;
}

/**
 * Regra única de acesso à empresa: admin entra em qualquer base; os demais
 * dependem da allowlist da empresa (grupo/permissões), validada no servidor.
 */
export async function canEnterCompany(params: {
  email: string;
  companyDb: string;
  erpType?: string | null;
  isAdmin?: boolean;
}): Promise<boolean> {
  const { email, companyDb, erpType, isAdmin } = params;
  if (isAdmin) return true;
  if (!email || !companyDb) return false;
  return (erpType || "").toLowerCase() === "omie"
    ? isEmailAllowedForOmieCompany(email, companyDb)
    : isEmailAllowedForCompany(email, companyDb);
}
