import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView, sapAction, sapLogin, sapLogout, clearClientCache } from "@/lib/sap-client";
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

export function useSapUsers() {
  const { session } = useSap();
  const [users, setUsers] = useState<SapUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchUsers = useCallback(async (forceRefresh = false, signal?: AbortSignal) => {
    if (!session || session.erpType !== "sap") {
      // No session: try loading from DB cache
      setIsLoading(true);
      setError(null);
      try {
        const { data: dbCache } = await supabase
          .from("sap_cache")
          .select("data, expires_at")
          .eq("cache_key", "users")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (signal?.aborted) return;

        if (dbCache?.data && Array.isArray(dbCache.data)) {
          const userList = (dbCache.data as Record<string, unknown>[]).map(normalizeSapUser);
          if (userList.some(hasDisplayData)) {
            setUsers(userList);
            return;
          }
        }
      } catch {
        // ignore DB cache errors
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
      setUsers([]);
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

      const userList = result.data.map((row) => normalizeSapUser(row));

      sapUsersCache.set(cacheKey, userList);
      setUsers(userList);

      // Persist to DB cache (30 min TTL)
      if (userList.length > 0) {
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
    const controller = new AbortController();
    fetchUsers(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchUsers]);

  return { users, isLoading, error, actionLoading, refresh, toggleLock, resetPassword };
}
