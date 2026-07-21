import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface UserProfile {
  id?: string;
  /** Mantido apenas para exibição; o cadastro é global por user_code. */
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
    const key = session.userName.toLowerCase();
    const { data } = await supabase
      .from("collaborator_profiles")
      .select("*")
      .eq("user_code", key)
      .maybeSingle();
    setProfile({
      ...defaults(session.companyDB, session.userName),
      ...(data as Partial<UserProfile> | null),
      company_db: session.companyDB,
      user_code: session.userName,
    } as UserProfile);
    setLoading(false);
  }, [session?.companyDB, session?.userName]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (patch: Partial<UserProfile>) => {
    if (!session?.companyDB || !session?.userName) throw new Error("Sem sessão SAP");
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const res = await sapFunctionFetch("user-profile-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_db: session.companyDB,
        user_code: session.userName,
        ...patch,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `Falha ao salvar perfil (${res.status})`);
    const data = json.profile as UserProfile;
    setProfile({ ...data, company_db: session.companyDB, user_code: session.userName });
    return data;
  }, [session?.companyDB, session?.userName]);

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
