import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView, sapQuery, sapQueryAll, sapAction, sapLogin, sapLogout, clearClientCache } from "@/lib/sap-client";
import { sapUsersCache, type SapUser } from "@/lib/cache-repository";
import { supabase } from "@/integrations/supabase/client";

export interface UserCreatePayload {
  UserCode: string;
  UserName: string;
  eMail: string;
  Password: string;
}

export interface ReplicationResult {
  companyDB: string;
  displayName: string;
  status: "success" | "error";
  message?: string;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeLockedValue(value: unknown): SapUser["Locked"] {
  if (value === "tYES" || value === "Y" || value === true || value === 1 || value === "1") {
    return "tYES";
  }
  return "tNO";
}

function normalizeSapUser(row: Record<string, unknown>): SapUser {
  return {
    InternalKey: Number(row.InternalKey ?? row.userid ?? row.USERID ?? 0),
    UserName: pickString(row.UserName, row.u_name, row.U_NAME) ?? "",
    UserCode: pickString(row.UserCode, row.user_code, row.USER_CODE) ?? "",
    eMail: pickString(row.eMail, row.E_Mail, row.EMAIL),
    Locked: normalizeLockedValue(row.Locked),
    LastLoginDate: pickString(row.LastLoginDate, row.lastLogin, row.LASTLOGIN),
    LastLoginTime: pickString(row.LastLoginTime, row.lastLoginTime, row.LASTLOGINTIME),
  };
}

function hasDisplayData(user: SapUser): boolean {
  return Boolean(user.UserName || user.UserCode || user.eMail || user.LastLoginDate);
}

async function fetchUsersFromServiceLayer(session: NonNullable<ReturnType<typeof useSap>["session"]>): Promise<SapUser[]> {
  const { data } = await sapQueryAll(
    session,
    "Users",
    {
      $select: "InternalKey,UserCode,UserName,eMail,Locked,LastLoginDate,LastLoginTime",
    },
    false,
  );

  return (data.value as Record<string, unknown>[]).map((row) => normalizeSapUser(row));
}

async function fetchUsersFromAdminService(session: NonNullable<ReturnType<typeof useSap>["session"]>): Promise<SapUser[]> {
  const { sapFunctionFetch } = await import("@/lib/auth-fetch");
  const res = await sapFunctionFetch("sap-users-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "list_users_for_selection",
      company_db: session.companyDB,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Erro ${res.status}`);

  return ((payload.users || []) as Record<string, unknown>[]).map((row) => normalizeSapUser(row));
}

export function useSapUsers() {
  const { session } = useSap();
  const [users, setUsers] = useState<SapUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchUsers = useCallback(async (forceRefresh = false, signal?: AbortSignal) => {
    if (!session || session.erpType !== "sap") {
      // No SAP session: do NOT read cache without company_db, because that
      // would surface users from another company's base to the current view.
      if (!signal?.aborted) {
        setUsers([]);
        setError(null);
        setIsLoading(false);
      }
      return;
    }

    const companyDB = session.companyDB;
    const cacheKey = `users:${companyDB}`;

    if (!forceRefresh) {
      const cached = sapUsersCache.get(cacheKey);
      if (cached) {
        const normalizedCached = cached.map((user) => normalizeSapUser(user as unknown as Record<string, unknown>));
        if (normalizedCached.some(hasDisplayData)) {
          setUsers(normalizedCached);
          return;
        }
        sapUsersCache.invalidate(cacheKey);
      }

      // Try DB cache as fallback
      try {
        const { data: dbCache } = await supabase
          .from("sap_cache")
          .select("data, expires_at")
          .eq("cache_key", "users")
          .eq("company_db", companyDB)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (signal?.aborted) return;

        if (dbCache?.data && Array.isArray(dbCache.data)) {
          const expired = new Date(dbCache.expires_at) < new Date();
          const userList = (dbCache.data as Record<string, unknown>[]).map(normalizeSapUser);
          if (userList.some(hasDisplayData)) {
            sapUsersCache.set(cacheKey, userList);
            setUsers(userList);
            // If not expired, skip live fetch
            if (!expired) return;
          }
        }
      } catch {
        // ignore
      }
    }

    setIsLoading(true);
    setError(null);
    try {
      if (forceRefresh) {
        sapUsersCache.invalidate(cacheKey);
        clearClientCache();
      }

      const result = await sapQueryView<Record<string, unknown>>(
        session,
        "VW_USERS",
        undefined,
        !forceRefresh,
      );

      if (signal?.aborted) return;

      let userList = result.data.map((row) => normalizeSapUser(row));

      if (!userList.some(hasDisplayData)) {
        userList = await fetchUsersFromServiceLayer(session);
      }

      // Some SAP users cannot query /Users with their own session, and the HANA
      // view may be disabled/misconfigured for a company (returning blank rows).
      // For selectors such as approval rules, fall back to the backend read-only
      // listing that validates the current SAP session and reads users with the
      // company's stored integration credentials.
      if (!userList.some(hasDisplayData)) {
        userList = await fetchUsersFromAdminService(session);
      }

      if (signal?.aborted) return;

      sapUsersCache.set(cacheKey, userList);
      setUsers(userList);

      // Persist to DB cache (30 min TTL)
      if (userList.some(hasDisplayData)) {
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supabase
          .from("sap_cache")
          .upsert(
            [{
              cache_key: "users",
              company_db: companyDB,
              data: JSON.parse(JSON.stringify(userList)),
              expires_at: expiresAt,
            }],
            { onConflict: "cache_key,company_db" }
          )
          .then(({ error: upsertErr }) => {
            if (upsertErr) console.warn("Failed to persist users cache:", upsertErr.message);
          });
      }
    } catch (e) {
      if (signal?.aborted) return;
      console.error("Error fetching SAP users:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar usuários");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [session]);

  const resolveInternalKey = useCallback(async (user: SapUser): Promise<number> => {
    if (!session) throw new Error("Sem sessão ativa");
    if (!user.UserCode) {
      if (user.InternalKey && user.InternalKey > 0) return user.InternalKey;
      throw new Error("UserCode ausente");
    }
    const lookup = await sapQuery(
      session,
      `Users?$filter=UserCode eq '${user.UserCode.replace(/'/g, "''")}'&$select=InternalKey,UserCode`,
      undefined,
      false,
    );
    const rows = (lookup as { data?: { value?: Array<{ InternalKey: number }> } }).data?.value
      ?? (lookup as { value?: Array<{ InternalKey: number }> }).value
      ?? [];
    const key = Number(rows[0]?.InternalKey);
    if (!key) throw new Error(`Usuário '${user.UserCode}' não encontrado no SAP`);
    return key;
  }, [session]);

  const toggleLock = useCallback(async (user: SapUser) => {
    if (!session) return;
    setActionLoading(user.InternalKey);
    try {
      const internalKey = await resolveInternalKey(user);
      const newLocked = user.Locked === "tNO" ? "tYES" : "tNO";
      await sapAction(session, `Users(${internalKey})`, "PATCH", {
        Locked: newLocked,
      });
      sapUsersCache.clear();
      clearClientCache();
      await fetchUsers(true);
    } catch (e) {
      console.error("Error toggling user lock:", e);
      throw e;
    } finally {
      setActionLoading(null);
    }
  }, [session, fetchUsers, resolveInternalKey]);

  const resetPassword = useCallback(async (user: SapUser) => {
    if (!session) return;
    setActionLoading(user.InternalKey);
    try {
      const internalKey = await resolveInternalKey(user);
      await sapAction(session, `Users(${internalKey})`, "PATCH", {
        UserPassword: "Sap@2025",
      });
    } catch (e) {
      console.error("Error resetting password:", e);
      throw e;
    } finally {
      setActionLoading(null);
    }
  }, [session, resolveInternalKey]);

  const createUser = useCallback(async (
    userData: UserCreatePayload,
    targetCompanyDbs?: string[],
  ): Promise<{ created: boolean; replicationResults: ReplicationResult[] }> => {
    if (!session) throw new Error("Sem sessão ativa");

    const erpType = session.erpType || "sap";
    const currentDb = session.companyDB;
    const createInCurrent = !targetCompanyDbs || targetCompanyDbs.includes(currentDb);

    // 1. Create user in current company (if selected)
    if (createInCurrent) {
      await sapAction(session, "Users", "POST", {
        UserCode: userData.UserCode,
        UserName: userData.UserName,
        eMail: userData.eMail,
        UserPassword: userData.Password,
      });
      sapUsersCache.clear();
      clearClientCache();
      fetchUsers(true);
    }

    // 2. Find other companies with same ERP type, filtered by selection
    let q = supabase
      .from("companies")
      .select("company_db, display_name, erp_type")
      .eq("erp_type", erpType)
      .eq("is_active", true)
      .neq("company_db", currentDb);
    const { data: companies } = await q;

    let targets = (companies || []) as { company_db: string; display_name: string; erp_type: string }[];
    if (targetCompanyDbs) {
      const set = new Set(targetCompanyDbs);
      targets = targets.filter((c) => set.has(c.company_db));
    }

    if (targets.length === 0) {
      return { created: createInCurrent, replicationResults: [] };
    }

    // 3. Replicate to each company using stored credentials
    const results: ReplicationResult[] = [];

    for (const company of targets) {
      try {
        const { authFetch } = await import("@/lib/auth-fetch");
        const credsRes = await authFetch(`credentials?system=${erpType}&company_db=${company.company_db}`);

        if (!credsRes.ok) throw new Error("Sem credenciais configuradas");
        const credsData = await credsRes.json();
        const creds = credsData.credentials || [];

        if (erpType === "sap") {
          const getCredVal = (key: string) => creds.find((c: { credential_key: string; credential_value?: string }) => c.credential_key === key)?.credential_value;
          const username = getCredVal("username");
          const password = getCredVal("password");
          if (!username || !password) throw new Error("Credenciais SAP incompletas");

          const tempSession = await sapLogin(username, password, company.company_db);
          try {
            await sapAction(tempSession, "Users", "POST", {
              UserCode: userData.UserCode,
              UserName: userData.UserName,
              eMail: userData.eMail,
              UserPassword: userData.Password,
            });
            results.push({ companyDB: company.company_db, displayName: company.display_name, status: "success" });
          } finally {
            await sapLogout(tempSession).catch(() => {});
          }
        } else {
          results.push({ companyDB: company.company_db, displayName: company.display_name, status: "error", message: "Replicação não suportada para este ERP" });
        }
      } catch (e) {
        results.push({
          companyDB: company.company_db,
          displayName: company.display_name,
          status: "error",
          message: e instanceof Error ? e.message : "Erro desconhecido",
        });
      }
    }

    // Audit
    try {
      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({
        action: "create_user",
        entity_type: "sap_user",
        entity_id: userData.UserCode,
        company_db: session.companyDB,
        details: { userData: { UserCode: userData.UserCode, UserName: userData.UserName, eMail: userData.eMail }, replicationResults: results, targetCompanyDbs },
      });
    } catch {}

    return { created: createInCurrent, replicationResults: results };
  }, [session, fetchUsers]);

  const refresh = useCallback(() => fetchUsers(true), [fetchUsers]);

  useEffect(() => {
    const controller = new AbortController();
    fetchUsers(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchUsers]);

  return { users, isLoading, error, actionLoading, refresh, toggleLock, resetPassword, createUser };
}
