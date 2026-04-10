import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  modules: string[];
}

export interface UserAssignment {
  id: string;
  sap_email: string;
  group_id: string;
  group_name?: string;
  created_at: string;
}

// All available module keys
export const ALL_MODULES = [
  { key: "analytics", label: "Analytics (Fluxo)" },
  { key: "analytics_payments", label: "Analytics (Pagamentos)" },
  { key: "expenses", label: "Despesas" },
  { key: "approvals", label: "Aprovações" },
  { key: "approval_rules", label: "Regras de Aprovação" },
  { key: "pagcorp", label: "PagCorp" },
  { key: "users", label: "Usuários" },
  { key: "synapse", label: "Synapse" },
  { key: "credentials", label: "Credenciais" },
  { key: "audit_log", label: "Logs de Auditoria" },
] as const;

// Default modules for users with no group
const DEFAULT_MODULES = ["analytics", "expenses"];

export function usePermissionGroups() {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data: groupsData } = await supabase
      .from("permission_groups")
      .select("*")
      .order("name");

    const { data: modulesData } = await supabase
      .from("permission_group_modules")
      .select("*");

    const mapped: PermissionGroup[] = (groupsData || []).map((g: any) => ({
      ...g,
      modules: (modulesData || [])
        .filter((m: any) => m.group_id === g.id)
        .map((m: any) => m.module_key),
    }));

    setGroups(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const saveGroup = async (name: string, description: string, modules: string[], id?: string) => {
    if (id) {
      await supabase.from("permission_groups").update({ name, description }).eq("id", id);
    } else {
      const { data } = await supabase.from("permission_groups").insert({ name, description }).select().single();
      if (!data) return;
      id = data.id;
    }

    // Sync modules
    await supabase.from("permission_group_modules").delete().eq("group_id", id!);
    if (modules.length > 0) {
      await supabase.from("permission_group_modules").insert(
        modules.map((m) => ({ group_id: id!, module_key: m }))
      );
    }
    await fetch();
  };

  const deleteGroup = async (id: string) => {
    await supabase.from("permission_groups").delete().eq("id", id);
    await fetch();
  };

  return { groups, loading, refresh: fetch, saveGroup, deleteGroup };
}

export function useUserAssignments() {
  const [assignments, setAssignments] = useState<UserAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("user_group_assignments")
      .select("*, permission_groups(name)")
      .order("sap_email");

    setAssignments(
      (data || []).map((d: any) => ({
        id: d.id,
        sap_email: d.sap_email,
        group_id: d.group_id,
        group_name: d.permission_groups?.name,
        created_at: d.created_at,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const assign = async (sap_email: string, group_id: string) => {
    await supabase.from("user_group_assignments").upsert(
      { sap_email: sap_email.toLowerCase(), group_id },
      { onConflict: "sap_email,group_id" }
    );
    await fetch();
  };

  const remove = async (id: string) => {
    await supabase.from("user_group_assignments").delete().eq("id", id);
    await fetch();
  };

  return { assignments, loading, refresh: fetch, assign, remove };
}

/**
 * Hook to check if the current SAP user has access to a specific module.
 * Returns { hasAccess, loading, userModules }
 */
export function useModuleAccess(moduleKey?: string) {
  const { session } = useSap();
  const [userModules, setUserModules] = useState<string[]>(DEFAULT_MODULES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.userName) {
      setUserModules(DEFAULT_MODULES);
      setLoading(false);
      return;
    }

    const email = session.userName.toLowerCase();

    (async () => {
      setLoading(true);

      // Get all groups the user belongs to
      const { data: assignments } = await supabase
        .from("user_group_assignments")
        .select("group_id")
        .eq("sap_email", email);

      if (!assignments || assignments.length === 0) {
        setUserModules(DEFAULT_MODULES);
        setLoading(false);
        return;
      }

      const groupIds = assignments.map((a: any) => a.group_id);

      const { data: modules } = await supabase
        .from("permission_group_modules")
        .select("module_key")
        .in("group_id", groupIds);

      const keys = [...new Set((modules || []).map((m: any) => m.module_key))];
      setUserModules(keys.length > 0 ? keys : DEFAULT_MODULES);
      setLoading(false);
    })();
  }, [session?.userName]);

  const hasAccess = moduleKey ? userModules.includes(moduleKey) : true;

  return { hasAccess, loading, userModules };
}
