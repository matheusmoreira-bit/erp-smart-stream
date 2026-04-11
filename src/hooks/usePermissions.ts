import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  modules: string[];
  company_db: string | null;
}

export interface UserAssignment {
  id: string;
  sap_email: string;
  group_id: string;
  group_name?: string;
  company_db: string | null;
  created_at: string;
}

// Module definitions per ERP type
export const SAP_MODULES = [
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

export const OMIE_MODULES = [
  { key: "expenses", label: "Despesas" },
  { key: "approvals", label: "Aprovações" },
  { key: "credentials", label: "Credenciais" },
  { key: "audit_log", label: "Logs de Auditoria" },
] as const;

export const S4HANA_MODULES = [
  { key: "analytics", label: "Analytics" },
  { key: "expenses", label: "Despesas" },
  { key: "approvals", label: "Aprovações" },
  { key: "users", label: "Usuários" },
  { key: "credentials", label: "Credenciais" },
  { key: "audit_log", label: "Logs de Auditoria" },
] as const;

export const TOTVS_MODULES = [
  { key: "expenses", label: "Despesas" },
  { key: "approvals", label: "Aprovações" },
  { key: "credentials", label: "Credenciais" },
  { key: "audit_log", label: "Logs de Auditoria" },
] as const;

export const NETSUITE_MODULES = [
  { key: "expenses", label: "Despesas" },
  { key: "approvals", label: "Aprovações" },
  { key: "credentials", label: "Credenciais" },
  { key: "audit_log", label: "Logs de Auditoria" },
] as const;

// Legacy compat
export const ALL_MODULES = SAP_MODULES;

export function getModulesForErp(erpType: string): readonly { key: string; label: string }[] {
  if (erpType === "sap") return SAP_MODULES;
  if (erpType === "omie") return OMIE_MODULES;
  if (erpType.startsWith("s4hana")) return S4HANA_MODULES;
  if (erpType.startsWith("totvs")) return TOTVS_MODULES;
  if (erpType === "netsuite") return NETSUITE_MODULES;
  return SAP_MODULES;
}

// Default modules for users with no group
const DEFAULT_MODULES = ["expenses"];

export function usePermissionGroups(companyDb?: string) {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("permission_groups").select("*").order("name");
    if (companyDb) {
      query = query.eq("company_db", companyDb);
    }
    const { data: groupsData } = await query;

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
  }, [companyDb]);

  useEffect(() => { fetch(); }, [fetch]);

  const saveGroup = async (name: string, description: string, modules: string[], id?: string, groupCompanyDb?: string) => {
    if (id) {
      await supabase.from("permission_groups").update({ name, description }).eq("id", id);
    } else {
      const { data } = await supabase
        .from("permission_groups")
        .insert({ name, description, company_db: groupCompanyDb || companyDb || null })
        .select()
        .single();
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

  const ensureDefaultGroup = async (erpType: string, targetCompanyDb: string) => {
    // Check if "Usuário" group exists for this company
    const existing = groups.find(
      (g) => g.name === "Usuário" && g.company_db === targetCompanyDb
    );
    if (existing) return existing;

    // Create default "Usuário" group with only expenses
    const defaultModules = ["expenses"];
    const { data } = await supabase
      .from("permission_groups")
      .insert({ name: "Usuário", description: "Acesso padrão — apenas despesas", company_db: targetCompanyDb })
      .select()
      .single();
    if (data) {
      await supabase.from("permission_group_modules").insert(
        defaultModules.map((m) => ({ group_id: data.id, module_key: m }))
      );
      await fetch();
      return { ...data, modules: defaultModules } as PermissionGroup;
    }
    return null;
  };

  return { groups, loading, refresh: fetch, saveGroup, deleteGroup, ensureDefaultGroup };
}

export function useUserAssignments(companyDb?: string) {
  const [assignments, setAssignments] = useState<UserAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("user_group_assignments")
      .select("*, permission_groups(name)")
      .order("sap_email");

    if (companyDb) {
      query = query.eq("company_db", companyDb);
    }

    const { data } = await query;

    setAssignments(
      (data || []).map((d: any) => ({
        id: d.id,
        sap_email: d.sap_email,
        group_id: d.group_id,
        group_name: d.permission_groups?.name,
        company_db: d.company_db,
        created_at: d.created_at,
      }))
    );
    setLoading(false);
  }, [companyDb]);

  useEffect(() => { fetch(); }, [fetch]);

  const assign = async (sap_email: string, group_id: string, targetCompanyDb?: string) => {
    const cdb = targetCompanyDb || companyDb || null;
    await supabase.from("user_group_assignments").upsert(
      { sap_email: sap_email.toLowerCase(), group_id, company_db: cdb },
      { onConflict: "sap_email,group_id,company_db" }
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

    const identifier = session.userName.toLowerCase();
    const companyDB = session.companyDB;

    (async () => {
      setLoading(true);

      // Get assignments for this company (or global)
      let query = supabase
        .from("user_group_assignments")
        .select("group_id, sap_email");

      const { data: allAssignments } = await query;

      const assignments = (allAssignments || []).filter((a: any) => {
        const sapEmail = a.sap_email.toLowerCase();
        return sapEmail === identifier || sapEmail.startsWith(identifier + "@");
      });

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
  }, [session?.userName, session?.companyDB]);

  const hasAccess = moduleKey ? userModules.includes(moduleKey) : true;

  return { hasAccess, loading, userModules };
}
