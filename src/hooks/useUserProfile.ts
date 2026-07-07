import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface UserProfile {
  id?: string;
  company_db: string;
  user_code: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  notify_whatsapp_overdue: boolean;
  notify_whatsapp_approvals: boolean;
  notify_email_overdue: boolean;
  notify_email_approvals: boolean;
  sap_synced_at: string | null;
  dismissed_until: string | null;
}

const defaults = (companyDB: string, userCode: string): UserProfile => ({
  company_db: companyDB,
  user_code: userCode,
  display_name: null,
  avatar_url: null,
  email: null,
  phone: null,
  notify_whatsapp_overdue: true,
  notify_whatsapp_approvals: true,
  notify_email_overdue: true,
  notify_email_approvals: true,
  sap_synced_at: null,
  dismissed_until: null,
});

export function useUserProfile() {
  const { session } = useSap();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session?.companyDB || !session?.userName) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("company_db", session.companyDB)
      .eq("user_code", session.userName)
      .maybeSingle();
    // Fallback: também traz telefone salvo em user_phones para migrar.
    let phone: string | null = (data as UserProfile | null)?.phone ?? null;
    if (!phone) {
      const { data: ph } = await supabase
        .from("user_phones")
        .select("phone")
        .eq("company_db", session.companyDB)
        .eq("user_code", session.userName)
        .maybeSingle();
      if (ph?.phone) phone = ph.phone;
    }
    setProfile({
      ...defaults(session.companyDB, session.userName),
      ...(data as Partial<UserProfile> | null),
      phone,
    } as UserProfile);
    setLoading(false);
  }, [session?.companyDB, session?.userName]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (patch: Partial<UserProfile>) => {
    if (!session?.companyDB || !session?.userName) throw new Error("Sem sessão SAP");
    const payload = {
      company_db: session.companyDB,
      user_code: session.userName,
      ...profile,
      ...patch,
    };
    delete (payload as { id?: string }).id;
    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(payload, { onConflict: "company_db,user_code" })
      .select()
      .single();
    if (error) throw error;
    // Espelha telefone em user_phones para reutilizar notificações existentes.
    if (patch.phone !== undefined) {
      const cleaned = (patch.phone || "").trim();
      if (cleaned) {
        await supabase.from("user_phones").upsert(
          { company_db: session.companyDB, user_code: session.userName, phone: cleaned, source: "manual" },
          { onConflict: "company_db,user_code" },
        );
      }
    }
    setProfile(data as UserProfile);
    return data as UserProfile;
  }, [profile, session?.companyDB, session?.userName]);

  const syncFromSap = useCallback(async () => {
    if (!session?.userName) throw new Error("Sem sessão SAP");
    const { data, error } = await supabase.functions.invoke("sap-user-profile-sync", {
      body: { user_code: session.userName },
    });
    if (error) throw error;
    return data as {
      hits: Array<{ company_db: string; display_name: string; user_code: string; user_name: string | null; email: string | null }>;
      aggregate: { display_name: string | null; email: string | null };
    };
  }, [session?.userName]);

  const dismissForWeek = useCallback(async () => {
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await save({ dismissed_until: until });
  }, [save]);

  const isPending = (p: UserProfile | null): boolean => {
    if (!p) return false;
    const hasPhone = !!(p.phone && p.phone.trim());
    const hasEmail = !!(p.email && p.email.trim());
    return !(hasPhone && hasEmail);
  };

  return { profile, loading, refresh, save, syncFromSap, dismissForWeek, isPending: isPending(profile) };
}
