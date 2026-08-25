import { useState, useEffect, useCallback } from "react";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { canonicalUserKey } from "@/lib/user-identity";

export type PhoneSource = "manual" | "sap";

export interface UserPhoneRecord {
  user_code: string;
  phone: string | null;
  source: PhoneSource;
  display_name: string | null;
  email: string | null;
}

export function useUserPhones() {
  const [phones, setPhones] = useState<Record<string, UserPhoneRecord>>({});
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await sapFunctionFetch("user-profile-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.warn("Falha ao carregar perfis globais:", payload?.error || response.status);
        return;
      }
      const map: Record<string, UserPhoneRecord> = {};
      for (const row of payload.profiles || []) {
        const key = canonicalUserKey(row.user_code || row.email);
        if (!key) continue;
        map[key] = {
          user_code: key,
          phone: row.phone,
          source: "manual",
          display_name: row.display_name,
          email: row.email,
        };
      }
      setPhones(map);
    } catch (error) {
      console.warn("Falha ao carregar perfis globais:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upsertPhone = useCallback(
    async (userCode: string, phone: string, source: PhoneSource = "manual") => {
      const key = canonicalUserKey(userCode);
      if (!key) throw new Error("Identidade do usuário inválida");
      const cleaned = phone.trim();
      const response = await sapFunctionFetch("user-profile-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_code: key, phone: cleaned || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar telefone (${response.status})`);
      const profile = payload.profile as {
        user_code: string;
        phone: string | null;
        display_name: string | null;
        email: string | null;
      };
      setPhones((prev) => ({
        ...prev,
        [key]: {
          user_code: key,
          phone: profile.phone,
          source,
          display_name: profile.display_name,
          email: profile.email,
        },
      }));
    },
    [],
  );

  return { phones, isLoading, refresh, upsertPhone };
}
