import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SapUser } from "@/lib/cache-repository";
import { jumpCloudUsersCache, type JumpCloudCacheEntry } from "@/lib/cache-repository";

export type JumpCloudUser = JumpCloudCacheEntry;

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
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const JC_CACHE_KEY = "jumpcloud:all";

export function useIdpSync() {
  const [jcUsers, setJcUsers] = useState<JumpCloudUser[]>([]);
  const [mappings, setMappings] = useState<IdpMapping[]>([]);
  const [isLoadingJc, setIsLoadingJc] = useState(false);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJumpCloudUsers = useCallback(async (forceRefresh = false) => {
    // Check cache first
    if (!forceRefresh) {
      const cached = jumpCloudUsersCache.get(JC_CACHE_KEY);
      if (cached) {
        setJcUsers(cached);
        return cached;
      }
    }

    setIsLoadingJc(true);
    setError(null);
    try {
      const { authFetch } = await import("@/lib/auth-fetch");
      const res = await authFetch(`jumpcloud-proxy?action=listUsers`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      const data = await res.json();
      const users: JumpCloudUser[] = data.users || [];
      jumpCloudUsersCache.set(JC_CACHE_KEY, users);
      setJcUsers(users);
      return users;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar usuários JumpCloud");
      return [];
    } finally {
      setIsLoadingJc(false);
    }
  }, []);

  const fetchMappings = useCallback(async () => {
    setIsLoadingMappings(true);
    try {
      const { data, error: err } = await supabase
        .from("idp_user_mapping")
        .select("*")
        .eq("idp_provider", "jumpcloud")
        .order("sap_user_code");
      if (err) throw err;
      setMappings((data as IdpMapping[]) || []);
    } catch (e) {
      console.error("Error fetching mappings:", e);
    } finally {
      setIsLoadingMappings(false);
    }
  }, []);

  const autoSync = useCallback(
    async (sapUsers: SapUser[], jcList?: JumpCloudUser[]) => {
      const jumpCloudUsers = jcList || jcUsers;
      if (jumpCloudUsers.length === 0) return;

      const jcByEmail = new Map<string, JumpCloudUser>();
      for (const jc of jumpCloudUsers) {
        if (jc.email) jcByEmail.set(jc.email.toLowerCase(), jc);
      }

      const upserts: Array<Record<string, unknown>> = [];

      for (const sap of sapUsers) {
        const sapEmail = sap.eMail?.toLowerCase();
        const jcMatch = sapEmail ? jcByEmail.get(sapEmail) : undefined;

        upserts.push({
          sap_user_code: sap.UserCode,
          sap_user_name: sap.UserName || null,
          sap_email: sap.eMail || null,
          idp_provider: "jumpcloud",
          idp_user_id: jcMatch?._id || null,
          idp_email: jcMatch?.email || null,
          idp_display_name: jcMatch
            ? jcMatch.displayname || `${jcMatch.firstname || ""} ${jcMatch.lastname || ""}`.trim() || jcMatch.username
            : null,
          status: jcMatch ? "linked" : "pending",
          linked_at: jcMatch ? new Date().toISOString() : null,
        });
      }

      const { error: err } = await supabase
        .from("idp_user_mapping")
        .upsert(upserts as any[], { onConflict: "sap_user_code,idp_provider" });

      if (err) throw err;
      await fetchMappings();
    },
    [jcUsers, fetchMappings]
  );

  const linkManually = useCallback(
    async (sapUserCode: string, jcUser: JumpCloudUser) => {
      const { error: err } = await supabase
        .from("idp_user_mapping")
        .upsert(
          {
            sap_user_code: sapUserCode,
            idp_provider: "jumpcloud",
            idp_user_id: jcUser._id,
            idp_email: jcUser.email,
            idp_display_name:
              jcUser.displayname || `${jcUser.firstname || ""} ${jcUser.lastname || ""}`.trim() || jcUser.username,
            status: "linked",
            linked_at: new Date().toISOString(),
          } as any,
          { onConflict: "sap_user_code,idp_provider" }
        );
      if (err) throw err;
      await fetchMappings();
    },
    [fetchMappings]
  );

  const unlinkUser = useCallback(
    async (sapUserCode: string) => {
      const { error: err } = await supabase
        .from("idp_user_mapping")
        .update({
          idp_user_id: null,
          idp_email: null,
          idp_display_name: null,
          status: "pending",
          linked_at: null,
        } as any)
        .eq("sap_user_code", sapUserCode)
        .eq("idp_provider", "jumpcloud");
      if (err) throw err;
      await fetchMappings();
    },
    [fetchMappings]
  );

  return {
    jcUsers,
    mappings,
    isLoadingJc,
    isLoadingMappings,
    error,
    fetchJumpCloudUsers,
    fetchMappings,
    autoSync,
    linkManually,
    unlinkUser,
  };
}
