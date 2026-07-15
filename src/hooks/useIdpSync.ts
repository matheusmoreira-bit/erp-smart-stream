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
  // Employment info (JumpCloud → SAP)
  employee_id: string | null;
  employee_type: string | null;
  job_title: string | null;
  company_name: string | null;
  department: string | null;
  cost_center_code: string | null;
  cost_center_label: string | null;
  manager_idp_id: string | null;
  attributes_synced_at: string | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const JC_CACHE_KEY = "jumpcloud:all";

/** Cost Center vem como "1.6.1.2 - OPERAÇÕES DE INFRAESTRUTURA"; extraímos o código. */
export function parseCostCenterCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^([^\s-]+)/);
  return m ? m[1] : trimmed;
}

function jcAttrs(jc: JumpCloudUser | undefined | null) {
  if (!jc) return {};
  return {
    employee_id: jc.employeeIdentifier || null,
    employee_type: jc.employeeType || null,
    job_title: jc.jobTitle || null,
    company_name: jc.company || null,
    department: jc.department || null,
    cost_center_code: parseCostCenterCode(jc.costCenter),
    cost_center_label: jc.costCenter || null,
    manager_idp_id: jc.manager || null,
  };
}

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

      // Only sync users that don't already have a defined mapping.
      // To re-link, the user must remove the existing entry first.
      const existing = new Set(
        mappings.filter((m) => m.idp_user_id).map((m) => m.sap_user_code)
      );

      const jcByEmail = new Map<string, JumpCloudUser>();
      for (const jc of jumpCloudUsers) {
        if (jc.email) jcByEmail.set(jc.email.toLowerCase(), jc);
      }

      const upserts: Array<Record<string, unknown>> = [];

      for (const sap of sapUsers) {
        if (existing.has(sap.UserCode)) continue; // skip already-linked
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
          ...jcAttrs(jcMatch),
          attributes_synced_at: jcMatch ? new Date().toISOString() : null,
        });
      }

      if (upserts.length === 0) return;

      const { authFetch } = await import("@/lib/auth-fetch");
      const res = await authFetch("idp-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsertMany", rows: upserts }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchMappings();
    },
    [jcUsers, mappings, fetchMappings]
  );

  const linkManually = useCallback(
    async (sapUserCode: string, jcUser: JumpCloudUser) => {
      const { authFetch } = await import("@/lib/auth-fetch");
      const res = await authFetch("idp-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          sap_user_code: sapUserCode,
          idp_provider: "jumpcloud",
          idp_user_id: jcUser._id,
          idp_email: jcUser.email,
          idp_display_name:
            jcUser.displayname || `${jcUser.firstname || ""} ${jcUser.lastname || ""}`.trim() || jcUser.username,
          ...jcAttrs(jcUser),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchMappings();
    },
    [fetchMappings]
  );

  /**
   * Re-sincroniza os atributos de "Employment Information" de todos os mapeamentos
   * vinculados a partir da lista atual do JumpCloud.
   */
  const syncAttributes = useCallback(
    async (jcList?: JumpCloudUser[]) => {
      const jumpCloudUsers = jcList || jcUsers;
      if (jumpCloudUsers.length === 0) return 0;

      const jcById = new Map<string, JumpCloudUser>();
      for (const jc of jumpCloudUsers) jcById.set(jc._id, jc);

      const linked = mappings.filter((m) => m.status === "linked" && m.idp_user_id);
      if (linked.length === 0) return 0;

      const now = new Date().toISOString();
      const rows = linked
        .map((m) => {
          const jc = jcById.get(m.idp_user_id as string);
          if (!jc) return null;
          return {
            sap_user_code: m.sap_user_code,
            sap_user_name: m.sap_user_name,
            sap_email: m.sap_email,
            idp_provider: "jumpcloud",
            idp_user_id: m.idp_user_id,
            idp_email: m.idp_email,
            idp_display_name: m.idp_display_name,
            status: "linked",
            linked_at: m.linked_at,
            ...jcAttrs(jc),
            attributes_synced_at: now,
          };
        })
        .filter(Boolean);

      if (rows.length === 0) return 0;

      const { authFetch } = await import("@/lib/auth-fetch");
      const res = await authFetch("idp-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsertMany", rows }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchMappings();
      return rows.length;
    },
    [jcUsers, mappings, fetchMappings]
  );

  const unlinkUser = useCallback(
    async (sapUserCode: string) => {
      const { authFetch } = await import("@/lib/auth-fetch");
      const res = await authFetch("idp-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlink",
          sap_user_code: sapUserCode,
          idp_provider: "jumpcloud",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchMappings();
    },
    [fetchMappings]
  );

  /**
   * Reprocessa os atributos (department, cost_center_code, jobTitle, etc.)
   * de um único vínculo já existente — mantém idp_user_id/status e apenas
   * recalcula os campos derivados a partir do JumpCloud.
   */
  const reprocessUserAttributes = useCallback(
    async (sapUserCode: string, jcList?: JumpCloudUser[]) => {
      const jumpCloudUsers = jcList || jcUsers;
      const mapping = mappings.find((m) => m.sap_user_code === sapUserCode);
      if (!mapping || !mapping.idp_user_id) {
        throw new Error("Vínculo JumpCloud não encontrado para este usuário");
      }
      const jc = jumpCloudUsers.find((u) => u._id === mapping.idp_user_id);
      if (!jc) {
        throw new Error("Usuário não encontrado no JumpCloud (talvez tenha sido removido)");
      }

      const row = {
        sap_user_code: mapping.sap_user_code,
        sap_user_name: mapping.sap_user_name,
        sap_email: mapping.sap_email,
        idp_provider: "jumpcloud",
        idp_user_id: mapping.idp_user_id,
        idp_email: mapping.idp_email,
        idp_display_name: mapping.idp_display_name,
        status: "linked",
        linked_at: mapping.linked_at,
        ...jcAttrs(jc),
        attributes_synced_at: new Date().toISOString(),
      };

      const { authFetch } = await import("@/lib/auth-fetch");
      const res = await authFetch("idp-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsertMany", rows: [row] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchMappings();
      return jcAttrs(jc);
    },
    [jcUsers, mappings, fetchMappings]
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
    syncAttributes,
    unlinkUser,
  };
}
