import { useCallback, useEffect, useState } from "react";
import type { SapUser } from "@/lib/cache-repository";
import { idpUsersCache, type IdpUserCacheEntry } from "@/lib/cache-repository";

export type IdpProvider = "jumpcloud" | "okta";
export type IdpUser = IdpUserCacheEntry;
export type JumpCloudUser = IdpUser;

export const IDP_PROVIDERS: Record<IdpProvider, { label: string; functionName: string }> = {
  jumpcloud: { label: "JumpCloud", functionName: "jumpcloud-proxy" },
  okta: { label: "Okta", functionName: "okta-proxy" },
};

export interface IdpMapping {
  id: string;
  sap_user_code: string;
  sap_user_name: string | null;
  sap_email: string | null;
  idp_provider: string;
  idp_user_id: string | null;
  idp_email: string | null;
  idp_display_name: string | null;
  status: string;
  linked_at: string | null;
  created_at: string;
  updated_at: string;
  employee_id: string | null;
  employee_type: string | null;
  job_title: string | null;
  company_name: string | null;
  department: string | null;
  cost_center_code: string | null;
  cost_center_label: string | null;
  manager_idp_id: string | null;
  attributes_synced_at: string | null;
}

export function parseCostCenterCode(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^([^\s-]+)/);
  return match ? match[1] : trimmed;
}

function idpAttributes(user: IdpUser | undefined | null) {
  if (!user) return {};
  return {
    employee_id: user.employeeIdentifier || null,
    employee_type: user.employeeType || null,
    job_title: user.jobTitle || null,
    company_name: user.company || null,
    department: user.department || null,
    cost_center_code: parseCostCenterCode(user.costCenter),
    cost_center_label: user.costCenter || null,
    manager_idp_id: user.manager || null,
  };
}

function displayName(user: IdpUser): string {
  return user.displayname || `${user.firstname || ""} ${user.lastname || ""}`.trim() || user.username;
}

export function useIdpSync(provider: IdpProvider = "jumpcloud") {
  const [idpUsers, setIdpUsers] = useState<IdpUser[]>([]);
  const [mappings, setMappings] = useState<IdpMapping[]>([]);
  const [isLoadingIdp, setIsLoadingIdp] = useState(false);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerConfig = IDP_PROVIDERS[provider];

  useEffect(() => {
    setIdpUsers([]);
    setMappings([]);
    setError(null);
  }, [provider]);

  const fetchIdpUsers = useCallback(async (forceRefresh = false) => {
    const cacheKey = `${provider}:all`;
    if (!forceRefresh) {
      const cached = idpUsersCache.get(cacheKey);
      if (cached) {
        setIdpUsers(cached);
        return cached;
      }
    }
    setIsLoadingIdp(true);
    setError(null);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const response = await sapFunctionFetch(providerConfig.functionName, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listUsers" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);
      const users = (payload.users || []) as IdpUser[];
      idpUsersCache.set(cacheKey, users);
      setIdpUsers(users);
      return users;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Erro ao buscar usuarios ${providerConfig.label}`);
      return [];
    } finally {
      setIsLoadingIdp(false);
    }
  }, [provider, providerConfig.functionName, providerConfig.label]);

  const fetchMappings = useCallback(async () => {
    setIsLoadingMappings(true);
    setError(null);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const response = await sapFunctionFetch("idp-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", idp_provider: provider }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);
      setMappings((payload.mappings as IdpMapping[]) || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao buscar vinculos IdP");
    } finally {
      setIsLoadingMappings(false);
    }
  }, [provider]);

  const persistRows = useCallback(async (rows: Array<Record<string, unknown>>) => {
    if (rows.length === 0) return;
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const response = await sapFunctionFetch("idp-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsertMany", rows }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Erro ${response.status}`);
    }
    await fetchMappings();
  }, [fetchMappings]);

  const autoSync = useCallback(async (sapUsers: SapUser[], usersList?: IdpUser[]) => {
    const users = usersList || idpUsers;
    if (users.length === 0) return;
    const existing = new Set(mappings.filter((mapping) => mapping.idp_user_id).map((mapping) => mapping.sap_user_code));
    const idpByEmail = new Map<string, IdpUser>();
    for (const user of users) if (user.email) idpByEmail.set(user.email.toLowerCase(), user);
    const rows: Array<Record<string, unknown>> = [];
    for (const sapUser of sapUsers) {
      if (existing.has(sapUser.UserCode)) continue;
      const match = sapUser.eMail ? idpByEmail.get(sapUser.eMail.toLowerCase()) : undefined;
      rows.push({
        sap_user_code: sapUser.UserCode,
        sap_user_name: sapUser.UserName || null,
        sap_email: sapUser.eMail || null,
        idp_provider: provider,
        idp_user_id: match?._id || null,
        idp_email: match?.email || null,
        idp_display_name: match ? displayName(match) : null,
        status: match ? "linked" : "pending",
        linked_at: match ? new Date().toISOString() : null,
        ...idpAttributes(match),
        attributes_synced_at: match ? new Date().toISOString() : null,
      });
    }
    await persistRows(rows);
  }, [idpUsers, mappings, persistRows, provider]);

  const linkManually = useCallback(async (sapUserCode: string, idpUser: IdpUser) => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const response = await sapFunctionFetch("idp-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "link",
        sap_user_code: sapUserCode,
        idp_provider: provider,
        idp_user_id: idpUser._id,
        idp_email: idpUser.email,
        idp_display_name: displayName(idpUser),
        ...idpAttributes(idpUser),
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Erro ${response.status}`);
    }
    await fetchMappings();
  }, [fetchMappings, provider]);

  const syncAttributes = useCallback(async (usersList?: IdpUser[]) => {
    const usersById = new Map((usersList || idpUsers).map((user) => [user._id, user]));
    const now = new Date().toISOString();
    const rows = mappings
      .filter((mapping) => mapping.status === "linked" && mapping.idp_user_id)
      .map((mapping) => {
        const user = usersById.get(mapping.idp_user_id as string);
        return user ? { ...mapping, idp_provider: provider, ...idpAttributes(user), attributes_synced_at: now } : null;
      })
      .filter((row): row is IdpMapping & Record<string, unknown> => row !== null);
    await persistRows(rows);
    return rows.length;
  }, [idpUsers, mappings, persistRows, provider]);

  const unlinkUser = useCallback(async (sapUserCode: string) => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const response = await sapFunctionFetch("idp-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlink", sap_user_code: sapUserCode, idp_provider: provider }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Erro ${response.status}`);
    }
    await fetchMappings();
  }, [fetchMappings, provider]);

  const reprocessUserAttributes = useCallback(async (sapUserCode: string, usersList?: IdpUser[]) => {
    const mapping = mappings.find((entry) => entry.sap_user_code === sapUserCode);
    if (!mapping?.idp_user_id) throw new Error(`Vinculo ${providerConfig.label} nao encontrado para este usuario`);
    const user = (usersList || idpUsers).find((entry) => entry._id === mapping.idp_user_id);
    if (!user) throw new Error(`Usuario nao encontrado no ${providerConfig.label}`);
    const attributes = idpAttributes(user);
    await persistRows([{ ...mapping, idp_provider: provider, ...attributes, attributes_synced_at: new Date().toISOString() }]);
    return attributes;
  }, [idpUsers, mappings, persistRows, provider, providerConfig.label]);

  return {
    idpUsers,
    mappings,
    isLoadingIdp,
    isLoadingMappings,
    error,
    fetchIdpUsers,
    fetchMappings,
    autoSync,
    linkManually,
    syncAttributes,
    reprocessUserAttributes,
    unlinkUser,
  };
}
