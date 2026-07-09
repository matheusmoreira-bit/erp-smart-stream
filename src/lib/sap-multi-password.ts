import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";

export interface MultiCompanyPasswordResult {
  companyDB: string;
  displayName: string;
  status: "success" | "error" | "skipped";
  message?: string;
}

/**
 * Detecta erros do SAP B1 quando a nova senha é igual à anterior.
 * Em lote, tratamos esse caso como "skipped" e seguimos com as demais empresas.
 */
export function isSamePasswordError(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("same as") ||
    m.includes("same password") ||
    m.includes("previous password") ||
    m.includes("igual") ||
    m.includes("já utilizada") ||
    m.includes("ja utilizada") ||
    m.includes("password history") ||
    m.includes("cannot be reused") ||
    m.includes("must differ")
  );
}

interface CompanyRow {
  company_db: string;
  display_name: string;
  erp_type: string;
}

export async function listSapTargetCompanies(excludeCompanyDb?: string): Promise<CompanyRow[]> {
  let q = supabase
    .from("companies")
    .select("company_db, display_name, erp_type")
    .eq("is_active", true)
    .eq("erp_type", "sap")
    .order("display_name");
  if (excludeCompanyDb) q = q.neq("company_db", excludeCompanyDb);
  const { data } = await q;
  return (data || []) as CompanyRow[];
}

/**
 * Change a user's password across multiple SAP companies. Runs server-side
 * via the `sap-change-password` edge function, which uses service-role to read
 * the admin credentials of each company (falling back to the configured
 * `SAP_FALLBACK_ADMIN_*` secrets when a company has no credentials stored).
 * Client-side code has no access to admin credentials by design.
 */
export async function changePasswordInCompanies(
  userCode: string,
  newPassword: string,
  companyDbs: string[],
): Promise<MultiCompanyPasswordResult[]> {
  if (companyDbs.length === 0) return [];

  const companies = await listSapTargetCompanies();
  const nameMap = new Map(companies.map((c) => [c.company_db, c.display_name]));

  try {
    const res = await sapFunctionFetch("sap-change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_code: userCode,
        new_password: newPassword,
        company_dbs: companyDbs,
      }),
    });
    const data = await res.json().catch(() => ({} as { results?: MultiCompanyPasswordResult[]; error?: string }));
    if (!res.ok) {
      const message = (data as { error?: string }).error || `HTTP ${res.status}`;
      return companyDbs.map((db) => ({
        companyDB: db,
        displayName: nameMap.get(db) || db,
        status: "error",
        message,
      }));
    }
    const results = ((data as { results?: MultiCompanyPasswordResult[] }).results) || [];
    // Garante que toda empresa solicitada aparece no resumo (ordem preservada).
    const byDb = new Map(results.map((r) => [r.companyDB, r]));
    return companyDbs.map((db) => byDb.get(db) || {
      companyDB: db,
      displayName: nameMap.get(db) || db,
      status: "error" as const,
      message: "Sem resposta do servidor",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao contatar o servidor";
    return companyDbs.map((db) => ({
      companyDB: db,
      displayName: nameMap.get(db) || db,
      status: "error",
      message,
    }));
  }
}
