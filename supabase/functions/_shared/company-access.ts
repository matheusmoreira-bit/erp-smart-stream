// F11: valida no servidor se quem chama pode agir na empresa (company_db) informada.
// Regras:
//  - admin do sistema: pode em qualquer empresa;
//  - sessão SAP comprovada (token HMAC): só na empresa da própria sessão;
//  - usuário logado sem sessão SAP: precisa de vínculo com a empresa
//    (grupo, licença SAP ou e-mail SAP) — ver user_can_access_company.
// O módulo é conferido em modo "sombra" (registra, não bloqueia) enquanto os
// grupos de permissão não cobrem todos os usuários.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { AuthError, requireUser, validateSapSession } from "./auth.ts";

export type CompanyAccessResult = {
  via: "admin" | "sap_session" | "user_link";
  identity: string;
};

// deno-lint-ignore no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export async function assertCompanyAccess(
  req: Request,
  admin: AnyClient,
  companyDb: string | null | undefined,
  moduleKey: string,
  action: "view" | "create" | "edit" | "delete",
): Promise<CompanyAccessResult> {
  const target = String(companyDb ?? "").trim();
  if (!target) throw new AuthError("Empresa não informada", 400);

  let userId: string | null = null;
  let email: string | null = null;
  try {
    const u = await requireUser(req);
    userId = u.id;
    email = u.email ?? null;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }

  if (userId) {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (isAdmin === true) return { via: "admin", identity: email || userId };
  }

  const sap = await validateSapSession(req);
  let result: CompanyAccessResult | null = null;

  if (sap?.companyDB && sap.companyDB.toLowerCase() === target.toLowerCase()) {
    result = { via: "sap_session", identity: sap.userName };
  } else if (email) {
    const { data: linked } = await admin.rpc("user_can_access_company", { _email: email, _company_db: target });
    if (linked === true) result = { via: "user_link", identity: email };
  }

  if (!result) {
    await admin.rpc("insert_audit_log", {
      p_action: "company_access_denied",
      p_entity_type: "company",
      p_entity_id: target,
      p_actor_email: email || sap?.userName || null,
      p_company_db: target,
      p_details: { module: moduleKey, action, session_company: sap?.companyDB ?? null },
    }).then(() => {}, () => {});
    throw new AuthError("Acesso negado: você não tem vínculo com esta empresa.", 403);
  }

  // Módulo em modo sombra (não bloqueia; registra divergências).
  try {
    const { data: hasModule } = await admin.rpc("sap_user_has_module", {
      _sap_username: result.identity,
      _module_key: moduleKey,
    });
    if (hasModule !== true) {
      await admin.from("permission_shadow_log").insert({
        actor_id: userId,
        actor_identifier: result.identity,
        company_db: target,
        module_key: moduleKey,
        action,
        decision: "would_deny",
        mode: "shadow",
        reason: "F11: sem módulo no grupo de permissão",
        context: { via: result.via },
      });
    }
  } catch { /* sombra: nunca derruba a ação */ }

  return result;
}
