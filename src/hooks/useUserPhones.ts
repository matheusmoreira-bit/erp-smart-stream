import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export type PhoneSource = "manual" | "sap";

export interface UserPhoneRecord {
  user_code: string;
  phone: string;
  source: PhoneSource;
}

export function useUserPhones() {
  const { session } = useSap();
  const [phones, setPhones] = useState<Record<string, UserPhoneRecord>>({});
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!session?.companyDB) {
      setPhones({});
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from("user_phones")
      .select("user_code, phone, source")
      .eq("company_db", session.companyDB);
    const map: Record<string, UserPhoneRecord> = {};
    for (const r of (data || []) as UserPhoneRecord[]) {
      map[r.user_code] = r;
    }
    setPhones(map);
    setIsLoading(false);
  }, [session?.companyDB]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upsertPhone = useCallback(
    async (userCode: string, phone: string, source: PhoneSource = "manual") => {
      if (!session?.companyDB) throw new Error("Sem sessão SAP ativa");
      const cleaned = phone.trim();
      if (!cleaned) {
        await supabase
          .from("user_phones")
          .delete()
          .eq("company_db", session.companyDB)
          .eq("user_code", userCode);
        setPhones((prev) => {
          const next = { ...prev };
          delete next[userCode];
          return next;
        });
        return;
      }
      const { error } = await supabase
        .from("user_phones")
        .upsert(
          { company_db: session.companyDB, user_code: userCode, phone: cleaned, source },
          { onConflict: "company_db,user_code" },
        );
      if (error) throw error;
      setPhones((prev) => ({
        ...prev,
        [userCode]: { user_code: userCode, phone: cleaned, source },
      }));
    },
    [session?.companyDB],
  );

  return { phones, isLoading, refresh, upsertPhone };
}
