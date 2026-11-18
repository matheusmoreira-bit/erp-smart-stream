import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { AuthError, requireAdminOrSapModule, type ModuleAction } from "./auth.ts";
import { normalizeIdentity, resolveCallerAliases } from "./user-aliases.ts";

export async function authorizeCompany(req: Request, companyDb: unknown, module: string, action: ModuleAction) {
  if (typeof companyDb !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(companyDb)) {
    throw new AuthError("Empresa inválida ou não informada", 400);
  }
  return requireAdminOrSapModule(req, module, { companyDb, action });
}

export async function authorizeDocument(
  req: Request, client: unknown, document: Record<string, unknown>,
  module: string, action: ModuleAction, options: { ownerOnly?: boolean; expenseId?: string } = {},
) {
  // Existing handlers use multiple SDK versions; this trusted server client is not request input.
  const sb = client as SupabaseClient;
  const caller = await authorizeCompany(req, document.company_db, module, "view");
  const source = "source" in caller ? String(caller.source) : "cloud_admin";
  if (source === "cloud_admin" || source === "sap_admin") return caller;
  const aliases = await resolveCallerAliases(sb, {
    id: caller.id, email: caller.email ?? undefined,
    userName: "userName" in caller ? caller.userName : undefined,
  });
  const matches = (value: unknown) => typeof value === "string" && aliases.has(normalizeIdentity(value));
  const owns = document.requester_id === caller.id ||
    [document.requester_email, document.created_by_email].some(matches);
  let responsible = owns;
  if (!options.ownerOnly) {
    responsible ||= String(document.current_approver || "").split(/[\/;,|]+/).some(matches);
    responsible ||= document.approved_by === caller.id;
    if (!responsible && options.expenseId) {
      const { data, error } = await sb.from("expense_approval_log")
        .select("approver_email").eq("expense_id", options.expenseId).eq("decision", "approved");
      if (error) throw new AuthError("Não foi possível verificar o responsável", 503);
      responsible = (data || []).some((row: { approver_email: string | null }) => matches(row.approver_email));
    }
  }
  if (options.ownerOnly && !owns) throw new AuthError("Sem permissão para alterar documento de outro responsável", 403);
  // Owners/approvers retain their existing workflow; other operators need an explicit action grant.
  if (responsible) return caller;
  return authorizeCompany(req, document.company_db, module, action);
}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AuthError(`${label} inválido`, 400);
  }
  return value;
}