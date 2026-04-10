import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, sapAction, clearClientCache } from "@/lib/sap-client";
import { sapUsersCache, type SapUser } from "@/lib/cache-repository";

export function useSapUsers() {
  const { session } = useSap();
  const [users, setUsers] = useState<SapUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!session) return;

    const cacheKey = `users:${session.companyDB}`;
    const cached = sapUsersCache.get(cacheKey);
    if (cached) {
      setUsers(cached);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await sapQuery(session, "Users", {
        $select: "InternalKey,UserName,UserCode,eMail,Department,Branch,Locked,LastLoginDate,LastLoginTime",
      }, false);

      const data = result.data as any;
      const userList: SapUser[] = Array.isArray(data)
        ? data
        : data?.value
          ? data.value
          : [];

      sapUsersCache.set(cacheKey, userList);
      setUsers(userList);
    } catch (e) {
      console.error("Error fetching SAP users:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar usuários");
    } finally {
      setIsLoading(false);
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
      // Clear caches and refetch
      sapUsersCache.clear();
      clearClientCache();
      await fetchUsers();
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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return { users, isLoading, error, actionLoading, refresh: fetchUsers, toggleLock, resetPassword };
}
