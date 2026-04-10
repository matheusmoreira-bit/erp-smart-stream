import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView, sapAction, clearClientCache } from "@/lib/sap-client";
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
      const result = await sapQueryView<Record<string, unknown>>(
        session,
        "VW_USERS",
      );

      const userList: SapUser[] = result.data.map((row) => ({
        InternalKey: Number(row.userid ?? 0),
        UserName: String(row.u_name ?? ""),
        UserCode: String(row.user_code ?? ""),
        eMail: row.E_Mail != null ? String(row.E_Mail) : undefined,
        Locked: row.Locked === "Y" ? "tYES" : "tNO",
        LastLoginDate: row.lastLogin != null ? String(row.lastLogin) : undefined,
        LastLoginTime: undefined,
      }));

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
