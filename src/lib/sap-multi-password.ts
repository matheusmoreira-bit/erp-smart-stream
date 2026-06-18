import { supabase } from "@/integrations/supabase/client";
import { sapLogin, sapLogout, sapAction, sapQuery } from "@/lib/sap-client";
import { authFetch } from "@/lib/auth-fetch";

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

async function getCompanyAdminCreds(companyDb: string): Promise<{ username: string; password: string } | null> {
  try {
    const res = await authFetch(`credentials?system=sap&company_db=${encodeURIComponent(companyDb)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const creds = data.credentials || [];
    const get = (k: string) => creds.find((c: { credential_key: string; credential_value?: string }) => c.credential_key === k)?.credential_value;
    const username = get("username");
    const password = get("password");
    if (!username || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

/**
 * Change a user's password across multiple SAP companies using the configured
 * admin credentials of each company. The user is identified by UserCode.
 */
export async function changePasswordInCompanies(
  userCode: string,
  newPassword: string,
  companyDbs: string[],
): Promise<MultiCompanyPasswordResult[]> {
  const companies = await listSapTargetCompanies();
  const map = new Map(companies.map((c) => [c.company_db, c]));
  const results: MultiCompanyPasswordResult[] = [];

  for (const companyDb of companyDbs) {
    const company = map.get(companyDb);
    const displayName = company?.display_name || companyDb;

    const admin = await getCompanyAdminCreds(companyDb);
    if (!admin) {
      results.push({ companyDB: companyDb, displayName, status: "error", message: "Sem credenciais administrativas configuradas" });
      continue;
    }

    let session;
    try {
      session = await sapLogin(admin.username, admin.password, companyDb);
    } catch (e) {
      results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Falha ao autenticar" });
      continue;
    }

    try {
      // Find user InternalKey by UserCode
      const lookup = await sapQuery(
        session,
        `Users?$filter=UserCode eq '${userCode.replace(/'/g, "''")}'&$select=InternalKey,UserCode`,
        undefined,
        false,
      );
      const rows = Array.isArray(lookup.data)
        ? (lookup.data as Array<{ InternalKey?: number; UserCode?: string }>)
        : (((lookup.data as { value?: Array<{ InternalKey?: number; UserCode?: string }> })?.value) || []);

      if (rows.length === 0 || rows[0].InternalKey == null) {
        results.push({ companyDB: companyDb, displayName, status: "skipped", message: "Usuário não existe nesta empresa" });
      } else {
        await sapAction(session, `Users(${rows[0].InternalKey})`, "PATCH", { UserPassword: newPassword });
        results.push({ companyDB: companyDb, displayName, status: "success" });
      }
    } catch (e) {
      results.push({ companyDB: companyDb, displayName, status: "error", message: e instanceof Error ? e.message : "Erro ao alterar senha" });
    } finally {
      await sapLogout(session).catch(() => {});
    }
  }

  return results;
}
