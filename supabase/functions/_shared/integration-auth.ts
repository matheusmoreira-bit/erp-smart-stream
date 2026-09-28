import { AuthError, requireUserOrSapSession, requireAdminOrSapModule } from "./auth.ts";

export type IntegrationCaller = { technical: boolean; userId: string | null; actor: string };

export function requireIntegrationService(req: Request): IntegrationCaller {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || token !== expected) throw new AuthError("Chamada técnica não autorizada", 401);
  return { technical: true, userId: null, actor: "service:integration-scheduler" };
}

export async function requireIntegrationCaller(req: Request): Promise<IntegrationCaller> {
  try { return requireIntegrationService(req); } catch { /* identidade de usuário */ }
  const user = await requireUserOrSapSession(req);
  return {
    technical: false,
    userId: user.id.startsWith("sap:") ? null : user.id,
    actor: user.email || user.id,
  };
}

export async function authorizeIntegrationCompany(
  req: Request, caller: IntegrationCaller, module: string, companyDb: string | null,
): Promise<void> {
  if (!companyDb) throw new AuthError("Empresa do recurso não informada", 400);
  if (!caller.technical) await requireAdminOrSapModule(req, module, { companyDb, action: "integrate" });
}
