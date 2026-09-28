// Empresa, módulo e ação são autorizados pelo mesmo guard dos handlers sensíveis.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { AuthError, requireAdminOrSapModule } from "./auth.ts";
export type CompanyAccessResult = { via: "admin" | "sap_session" | "user_link"; identity: string };

export async function assertCompanyAccess(
  req: Request,
  _admin: SupabaseClient<any, any, any>,
  companyDb: string | null | undefined,
  moduleKey: string,
  action: "view" | "create" | "edit" | "delete",
): Promise<CompanyAccessResult> {
  const target = String(companyDb ?? "").trim();
  if (!target) throw new AuthError("Empresa não informada", 400);
  const caller = await requireAdminOrSapModule(req, moduleKey, { companyDb: target, action });
  const source = (caller as { source?: string }).source ?? "cloud_admin";
  return {
    via: source === "cloud_module" ? "user_link" : source === "sap_module" || source === "sap_admin" ? "sap_session" : "admin",
    identity: caller.email || caller.id,
  };
}
