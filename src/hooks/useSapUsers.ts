import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView, sapAction, clearClientCache } from "@/lib/sap-client";
import { sapUsersCache, type SapUser } from "@/lib/cache-repository";

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

export function useSapUsers() {
  const { session } = useSap();
  const [users, setUsers] = useState<SapUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchUsers = useCallback(async (forceRefresh = false, signal?: AbortSignal) => {
    if (!session) {
      setUsers([]);
      return;
    }

    const cacheKey = `users:${session.companyDB}`;

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

      const userList = result.data.map((row) => normalizeSapUser(row));

      sapUsersCache.set(cacheKey, userList);
      setUsers(userList);
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

  const toggleLock = useCallback(async (user: SapUser) => {
    if (!session) return;
    setActionLoading(user.InternalKey);
    try {
      const newLocked = user.Locked === "tNO" ? "tYES" : "tNO";
      await sapAction(session, `Users(${user.InternalKey})`, "PATCH", {
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
  }, [session, fetchUsers]);

  const resetPassword = useCallback(async (user: SapUser) => {
    if (!session) return;
    setActionLoading(user.InternalKey);
    try {
      await sapAction(session, `Users(${user.InternalKey})`, "PATCH", {
        Password: "Sap@2025",
      });
    } catch (e) {
      console.error("Error resetting password:", e);
      throw e;
    } finally {
      setActionLoading(null);
    }
  }, [session]);

  const refresh = useCallback(() => fetchUsers(true), [fetchUsers]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return { users, isLoading, error, actionLoading, refresh, toggleLock, resetPassword };
}
