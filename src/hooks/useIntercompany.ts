import { useCallback, useState } from "react";
import { sapFunctionFetch } from "@/lib/auth-fetch";

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

export interface SapBusinessPartnerRow {
  CardCode: string;
  CardName: string;
  CardType?: string;
  FederalTaxID?: string;
  Currency?: string;
  GroupCode?: number;
  Valid?: string;
  Frozen?: string;
}

export interface SapItemRow {
  ItemCode: string;
  ItemName: string;
  ItemsGroupCode?: number;
  ItemType?: string;
  Valid?: string;
  Frozen?: string;
}

export interface SapUserRow {
  UserCode: string;
  UserName: string;
  eMail?: string;
  Superuser?: string;
  Locked?: string;
  Department?: number;
  Branch?: number;
  MobilePhone?: string;
}

async function callIntercompany<T>(body: Record<string, unknown>): Promise<T> {
  const resp = await sapFunctionFetch("intercompany", {
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
  const [loadingBPs, setLoadingBPs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [accountResults, setAccountResults] = useState<PerCompanyResult<SapAccountRow[]>[]>([]);
  const [centerResults, setCenterResults] = useState<PerCompanyResult<SapCostCenterRow[]>[]>([]);
  const [bpResults, setBpResults] = useState<PerCompanyResult<SapBusinessPartnerRow[]>[]>([]);
  const [itemResults, setItemResults] = useState<PerCompanyResult<SapItemRow[]>[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userResults, setUserResults] = useState<PerCompanyResult<SapUserRow[]>[]>([]);

  const loadAccounts = useCallback(async (company_dbs?: string[]) => {
    setLoadingAccounts(true);
    try {
      const r = await callIntercompany<{ results: PerCompanyResult<SapAccountRow[]>[] }>({
        action: "list-accounts",
        company_dbs,
      });
      setAccountResults(r.results || []);
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadCostCenters = useCallback(async (company_dbs?: string[]) => {
    setLoadingCenters(true);
    try {
      const r = await callIntercompany<{ results: PerCompanyResult<SapCostCenterRow[]>[] }>({
        action: "list-cost-centers",
        company_dbs,
      });
      setCenterResults(r.results || []);
    } finally {
      setLoadingCenters(false);
    }
  }, []);

  const createAccount = useCallback(
    async (input: { code: string; name: string; account_type?: string; company_dbs?: string[] }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "create-account",
        ...input,
      });
    },
    [],
  );

  const createCostCenter = useCallback(
    async (input: { center_code: string; center_name: string; group_code?: number; company_dbs?: string[] }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "create-cost-center",
        ...input,
      });
    },
    [],
  );

  const renameAccount = useCallback(
    async (input: { code: string; name: string; company_dbs?: string[] }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "rename-account",
        ...input,
      });
    },
    [],
  );

  const renameCostCenter = useCallback(
    async (input: { center_code: string; center_name: string; company_dbs?: string[] }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "rename-cost-center",
        ...input,
      });
    },
    [],
  );

  const toggleAccount = useCallback(
    async (input: { code: string; active: boolean; company_db: string }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "toggle-account",
        ...input,
      });
    },
    [],
  );

  const toggleCostCenter = useCallback(
    async (input: { center_code: string; active: boolean; company_db: string }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "toggle-cost-center",
        ...input,
      });
    },
    [],
  );

  const loadBusinessPartners = useCallback(async (company_dbs?: string[]) => {
    setLoadingBPs(true);
    try {
      const r = await callIntercompany<{ results: PerCompanyResult<SapBusinessPartnerRow[]>[] }>({
        action: "list-business-partners",
        company_dbs,
      });
      setBpResults(r.results || []);
    } finally {
      setLoadingBPs(false);
    }
  }, []);

  const loadItems = useCallback(async (company_dbs?: string[]) => {
    setLoadingItems(true);
    try {
      const r = await callIntercompany<{ results: PerCompanyResult<SapItemRow[]>[] }>({
        action: "list-items",
        company_dbs,
      });
      setItemResults(r.results || []);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  const replicateBusinessPartner = useCallback(
    async (input: { code: string; source_company_db: string; target_company_db: string }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "replicate-business-partner",
        ...input,
      });
    },
    [],
  );

  const replicateItem = useCallback(
    async (input: { code: string; source_company_db: string; target_company_db: string }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "replicate-item",
        ...input,
      });
    },
    [],
  );

  const loadUsers = useCallback(async (company_dbs?: string[]) => {
    setLoadingUsers(true);
    try {
      const r = await callIntercompany<{ results: PerCompanyResult<SapUserRow[]>[] }>({
        action: "list-users",
        company_dbs,
      });
      setUserResults(r.results || []);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const replicateUser = useCallback(
    async (input: { code: string; source_company_db: string; target_company_db: string; password?: string }) => {
      return await callIntercompany<{ results: PerCompanyResult[] }>({
        action: "replicate-user",
        ...input,
      });
    },
    [],
  );

  return {
    loadingAccounts,
    loadingCenters,
    loadingBPs,
    loadingItems,
    loadingUsers,
    accountResults,
    centerResults,
    bpResults,
    itemResults,
    userResults,
    loadAccounts,
    loadCostCenters,
    loadBusinessPartners,
    loadItems,
    loadUsers,
    createAccount,
    createCostCenter,
    renameAccount,
    renameCostCenter,
    toggleAccount,
    toggleCostCenter,
    replicateBusinessPartner,
    replicateItem,
    replicateUser,
  };
}
