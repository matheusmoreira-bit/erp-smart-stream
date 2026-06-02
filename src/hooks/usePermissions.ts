import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  modules: string[];
  erp_type: string | null;
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

// Unified module definitions — same for all ERP types / companies
export const ALL_MODULES = [
  { key: "analytics", label: "Analytics (Fluxo)" },
  { key: "analytics_payments", label: "Analytics (Pagamentos)" },
  { key: "expenses", label: "Compras" },
  { key: "sales", label: "Vendas" },
  { key: "approvals", label: "Aprovações" },
  { key: "approval_history", label: "Histórico de Aprovações" },
  { key: "approval_rules", label: "Regras de Aprovação" },
  { key: "pagcorp", label: "PagCorp" },
  { key: "users", label: "Usuários" },
  { key: "users_productivity", label: "Produtividade de Usuários" },
  { key: "suppliers", label: "Fornecedores" },
  { key: "synapse", label: "Synapse" },
  { key: "credentials", label: "Credenciais" },
  { key: "audit_log", label: "Logs de Auditoria" },
  { key: "notifications", label: "Notificações" },
  { key: "integration_history", label: "Monitor de Integrações" },
  { key: "intercompany", label: "Intercompany" },
  { key: "financial_review", label: "Avaliação Financeira" },
] as const;

// Legacy compat aliases
export const SAP_MODULES = ALL_MODULES;

// Default modules for users with no group
const DEFAULT_MODULES = ["expenses"];

export function usePermissionGroups() {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data: groupsData } = await supabase
      .from("permission_groups")
      .select("*")
      .order("name");

    const groupIds = (groupsData || []).map((g: any) => g.id);
    let modulesData: any[] = [];
    if (groupIds.length > 0) {
      const { data } = await supabase
        .from("permission_group_modules")
        .select("*")
        .in("group_id", groupIds);
      modulesData = data || [];
    }

    const mapped: PermissionGroup[] = (groupsData || []).map((g: any) => ({
      ...g,
      modules: modulesData
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
      const { data } = await supabase
        .from("permission_groups")
        .insert({ name, description })
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

  const ensureDefaultGroup = async () => {
    const existing = groups.find((g) => g.name === "Usuário");
    if (existing) return existing;

    const defaultModules = ["expenses"];
    const { data } = await supabase
      .from("permission_groups")
      .insert({ name: "Usuário", description: "Acesso padrão — apenas despesas" })
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

    const allKeys = ALL_MODULES.map((m) => m.key);
    const identifier = session.userName.toLowerCase();

    // SAP superuser, OMIE company, or "manager" account → grant all modules
    if (session.isSuperUser || session.erpType === "omie" || identifier === "manager") {
      setUserModules(allKeys);
      setLoading(false);
      return;
    }
    const companyDB = session.companyDB;

    (async () => {
      setLoading(true);

      // Check if Supabase user is admin — if so, grant all modules (admin in all companies)
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession?.user) {
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", authSession.user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (roleData) {
          setUserModules(allKeys);
          setLoading(false);
          return;
        }
      }

      // Also check if the SAP username matches a backoffice admin (by email/email prefix)
      const { data: isAdminBySap } = await supabase.rpc("is_sap_user_admin", {
        _sap_username: identifier,
      });
      if (isAdminBySap) {
        setUserModules(allKeys);
        setLoading(false);
        return;
      }

      // Get assignments for this user filtered by current company
      let query = supabase
        .from("user_group_assignments")
        .select("group_id, sap_email, company_db");

      if (companyDB) {
        // Get assignments for this specific company OR global (null company_db)
        query = query.or(`company_db.eq.${companyDB},company_db.is.null`);
      }

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
  }, [session?.userName, session?.companyDB, session?.isSuperUser, session?.erpType]);

  const hasAccess = moduleKey ? userModules.includes(moduleKey) : true;

  return { hasAccess, loading, userModules };
}
