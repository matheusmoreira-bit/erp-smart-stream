import { useCallback, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

export interface PerCompanyResult<T = unknown> {
  company_db: string;
  display_name: string;
  ok: boolean;
  error?: string;
  data?: T;
}

export interface SapAccountRow {
  Code: string;
  Name: string;
  ActiveAccount?: string;
  AccountType?: string;
  FrozenFor?: string;
}

export interface SapCostCenterRow {
  CenterCode: string;
  CenterName: string;
  GroupCode?: number;
  Active?: string;
}

async function callIntercompany<T>(body: Record<string, unknown>): Promise<T> {
  const resp = await authFetch("intercompany", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data as T;
}

export function useIntercompany() {
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCenters, setLoadingCenters] = useState(false);
  const [accountResults, setAccountResults] = useState<PerCompanyResult<SapAccountRow[]>[]>([]);
  const [centerResults, setCenterResults] = useState<PerCompanyResult<SapCostCenterRow[]>[]>([]);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const r = await callIntercompany<{ results: PerCompanyResult<SapAccountRow[]>[] }>({
        action: "list-accounts",
      });
      setAccountResults(r.results || []);
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadCostCenters = useCallback(async () => {
    setLoadingCenters(true);
    try {
      const r = await callIntercompany<{ results: PerCompanyResult<SapCostCenterRow[]>[] }>({
        action: "list-cost-centers",
      });
      setCenterResults(r.results || []);
    } finally {
      setLoadingCenters(false);
    }
  }, []);

  const createAccount = useCallback(
    async (input: { code: string; name: string; account_type?: string }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "create-account",
        ...input,
      });
    },
    [],
  );

  const createCostCenter = useCallback(
    async (input: { center_code: string; center_name: string; group_code?: number }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "create-cost-center",
        ...input,
      });
    },
    [],
  );

  return {
    loadingAccounts,
    loadingCenters,
    accountResults,
    centerResults,
    loadAccounts,
    loadCostCenters,
    createAccount,
    createCostCenter,
  };
}
