import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SapAdminUser {
  InternalKey: number;
  UserCode: string;
  UserName?: string;
  eMail?: string;
  Locked?: "tYES" | "tNO";
  Superuser?: "tYES" | "tNO";
  Department?: number | null;
  UserPermission?: string | null;
}

export interface SapCompanyOption {
  company_db: string;
  display_name: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sap-users-admin", { body });
  if (error) {
    const msg = (data as { error?: string } | null)?.error || error.message || "Erro";
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "error" in (data as object)) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export function useSapUsersAdmin() {
  const [companies, setCompanies] = useState<SapCompanyOption[]>([]);
  const [companyDb, setCompanyDb] = useState<string>("");
  const [users, setUsers] = useState<SapAdminUser[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    setError(null);
    try {
      const data = await invoke<{ companies: SapCompanyOption[] }>({ action: "list_companies" });
      setCompanies(data.companies);
      if (data.companies.length > 0 && !companyDb) setCompanyDb(data.companies[0].company_db);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar empresas");
    } finally {
      setLoadingCompanies(false);
    }
  }, [companyDb]);

  const loadUsers = useCallback(async (db?: string) => {
    const target = db ?? companyDb;
    if (!target) return;
    setLoadingUsers(true);
    setError(null);
    try {
      const data = await invoke<{ users: SapAdminUser[] }>({ action: "list_users", company_db: target });
      setUsers(data.users || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar usuários");
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [companyDb]);

  const updateUser = useCallback(async (internalKey: number, patch: Partial<SapAdminUser> & { UserPassword?: string }) => {
    if (!companyDb) throw new Error("Selecione uma empresa");
    await invoke({ action: "update_user", company_db: companyDb, internal_key: internalKey, patch });
    await loadUsers();
  }, [companyDb, loadUsers]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { if (companyDb) loadUsers(companyDb); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyDb]);

  return {
    companies, companyDb, setCompanyDb,
    users, loadingCompanies, loadingUsers, error,
    refresh: () => loadUsers(),
    updateUser,
  };
}
