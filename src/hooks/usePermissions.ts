import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

/* ────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────── */

export interface ModulePerms {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  /** module_keys the group has any access to (view=true) — kept for back-compat */
  modules: string[];
  /** Full CRUD map keyed by module_key */
  modulePerms: Record<string, ModulePerms>;
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

/* ────────────────────────────────────────────────────────────────────
 * Module catalog
 *
 * MODULES → telas com sentido CRUD (ver / criar / editar / excluir).
 * CAPABILITIES → flags transversais (view-only) que ligam funcionalidades
 * específicas dentro das telas.
 * ─────────────────────────────────────────────────────────────────── */

export const MODULES = [
  { key: "expenses", label: "Compras" },
  { key: "sales", label: "Vendas" },
  { key: "approvals", label: "Aprovações — Pendentes" },
  { key: "approval_history", label: "Aprovações — Histórico" },
  { key: "approval_rules", label: "Regras de Aprovação" },
  { key: "financial_review", label: "Adiantamentos" },
  { key: "nf_entrada", label: "NF de Entrada" },
  { key: "suppliers", label: "Fornecedores" },
  { key: "items", label: "Itens" },
  { key: "pagcorp", label: "Cartões Corporativos" },
  { key: "intercompany", label: "Plano de Contas & CC" },
  { key: "synapse", label: "Integrações — Automações" },
  { key: "credentials", label: "Integrações — Credenciais" },
  { key: "users", label: "Usuários" },
] as const;

/** Módulos view-only (dashboards / logs / notificações — sem CRUD). */
export const VIEW_ONLY_MODULES = [
  { key: "analytics", label: "Analytics (Fluxo)" },
  { key: "analytics_payments", label: "Analytics (Pagamentos)" },
  { key: "users_productivity", label: "Usuários — Produtividade" },
  { key: "notifications", label: "Notificações" },
  { key: "integration_history", label: "Integrações — Monitor" },
  { key: "audit_log", label: "Auditoria — Logs do Sistema" },
  { key: "fiscal_audit", label: "Auditoria — Fiscal" },
  { key: "audit_console", label: "Auditoria — SAP" },
] as const;

/** Capabilities: flags explícitas, transversais às telas. */
export const CAPABILITIES = [
  { key: "expenses_view_all", label: "Ver todas as Compras/Vendas", hint: "Não fica limitado ao que o próprio usuário criou." },
  { key: "approvals_view_all", label: "Ver todas as Aprovações", hint: "Enxerga pendências e histórico de todos, somente leitura." },
  { key: "approvals_delegate", label: "Delegar aprovações", hint: "Pode delegar uma aprovação a outro usuário." },
  { key: "approvals_transfer", label: "Transferir aprovações em massa", hint: "Ferramenta administrativa de transferência entre aprovadores." },
  { key: "approvals_override", label: "Aprovar fora do fluxo", hint: "Aprova documentos mesmo sem ser o aprovador designado." },
  { key: "suppliers_reactivate", label: "Reativar fornecedores inativos", hint: "Permite reativar fornecedor bloqueado no ERP." },
  { key: "expenses_cancel", label: "Cancelar documentos", hint: "Cancela pedidos/lançamentos próprios ou de terceiros." },
] as const;

/** Unified list for legacy callers that iterate through all keys. */
export const ALL_MODULES = [
  ...MODULES,
  ...VIEW_ONLY_MODULES,
  ...CAPABILITIES,
] as const;

// Legacy alias
export const SAP_MODULES = ALL_MODULES;

/** Default modules granted when a user has no assignment. */
const DEFAULT_MODULES = [
  "expenses",
  "sales",
  "approvals",
  "approval_history",
  "suppliers",
  "items",
  "financial_review",
  "nf_entrada",
  "notifications",
];

/**
 * Modules that, by default (no group assignment), should be read-only.
 * Users only get write access on these via an explicit group.
 */
const DEFAULT_READ_ONLY_MODULES = new Set<string>([
  "suppliers",
  "items",
]);

const FULL_PERMS: ModulePerms = { view: true, create: true, edit: true, delete: true };
const VIEW_ONLY_PERMS: ModulePerms = { view: true, create: false, edit: false, delete: false };

function isViewOnlyKey(key: string): boolean {
  return (
    VIEW_ONLY_MODULES.some((m) => m.key === key) ||
    CAPABILITIES.some((c) => c.key === key)
  );
}

function defaultPermsFor(key: string): ModulePerms {
  if (isViewOnlyKey(key) || DEFAULT_READ_ONLY_MODULES.has(key)) return VIEW_ONLY_PERMS;
  return FULL_PERMS;
}

/* ────────────────────────────────────────────────────────────────────
 * usePermissionGroups
 * ─────────────────────────────────────────────────────────────────── */

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

    const mapped: PermissionGroup[] = (groupsData || []).map((g: any) => {
      const rows = modulesData.filter((m: any) => m.group_id === g.id);
      const modulePerms: Record<string, ModulePerms> = {};
      for (const r of rows) {
        modulePerms[r.module_key] = {
          view:   r.can_view   ?? true,
          create: r.can_create ?? true,
          edit:   r.can_edit   ?? true,
          delete: r.can_delete ?? true,
        };
      }
      return {
        ...g,
        modules: rows.filter((r: any) => r.can_view ?? true).map((r: any) => r.module_key),
        modulePerms,
      };
    });

    setGroups(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  /**
   * Rich save: pass a full permissions map.
   * Legacy signature (modules: string[]) still accepted — treated as full-CRUD.
   */
  const saveGroup = async (
    name: string,
    description: string,
    perms: Record<string, ModulePerms> | string[],
    id?: string,
  ) => {
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

    // Normalize perms
    let normalized: Record<string, ModulePerms>;
    if (Array.isArray(perms)) {
      normalized = {};
      for (const k of perms) {
        normalized[k] = isViewOnlyKey(k) ? VIEW_ONLY_PERMS : FULL_PERMS;
      }
    } else {
      normalized = perms;
    }

    await supabase.from("permission_group_modules").delete().eq("group_id", id!);
    const rows = Object.entries(normalized)
      .filter(([, p]) => p.view || p.create || p.edit || p.delete)
      .map(([module_key, p]) => ({
        group_id: id!,
        module_key,
        can_view: p.view,
        can_create: p.create,
        can_edit: p.edit,
        can_delete: p.delete,
      }));
    if (rows.length > 0) {
      await supabase.from("permission_group_modules").insert(rows as any);
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

    const { data } = await supabase
      .from("permission_groups")
      .insert({ name: "Usuário", description: "Acesso padrão — fluxo operacional + aprovações" })
      .select()
      .single();
    if (data) {
      const rows = DEFAULT_MODULES.map((m) => ({
        group_id: data.id,
        module_key: m,
        can_view: true,
        can_create: !isViewOnlyKey(m),
        can_edit: !isViewOnlyKey(m),
        can_delete: !isViewOnlyKey(m),
      }));
      await supabase.from("permission_group_modules").insert(rows as any);
      await fetch();
      return { ...data, modules: DEFAULT_MODULES, modulePerms: {} } as PermissionGroup;
    }
    return null;
  };

  return { groups, loading, refresh: fetch, saveGroup, deleteGroup, ensureDefaultGroup };
}

/* ────────────────────────────────────────────────────────────────────
 * useUserAssignments  (global — company-agnostic)
 * ─────────────────────────────────────────────────────────────────── */

export function useUserAssignments(_companyDb?: string) {
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
        company_db: null,
        created_at: d.created_at,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const assign = async (sap_email: string, group_id: string) => {
    const email = sap_email.toLowerCase();
    // Global assignment — remove other groups for this user first.
    await supabase
      .from("user_group_assignments")
      .delete()
      .eq("sap_email", email)
      .neq("group_id", group_id);

    await supabase.from("user_group_assignments").upsert(
      { sap_email: email, group_id, company_db: null },
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

/* ────────────────────────────────────────────────────────────────────
 * useModuleAccess
 * ─────────────────────────────────────────────────────────────────── */

export interface ModuleAccess {
  hasAccess: boolean;
  loading: boolean;
  userModules: string[];
  /** CRUD flags for the queried module. */
  can: ModulePerms;
  /** Full CRUD map (all modules the user has permissions on). */
  perms: Record<string, ModulePerms>;
  /** Convenience predicate for capability flags. */
  hasCapability: (key: string) => boolean;
}

export function useModuleAccess(moduleKey?: string): ModuleAccess {
  const { session } = useSap();
  const [userModules, setUserModules] = useState<string[]>(DEFAULT_MODULES);
  const [perms, setPerms] = useState<Record<string, ModulePerms>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.userName) {
      setUserModules(DEFAULT_MODULES);
      setPerms(Object.fromEntries(DEFAULT_MODULES.map((k) => [k, isViewOnlyKey(k) ? VIEW_ONLY_PERMS : FULL_PERMS])));
      setLoading(false);
      return;
    }

    const allKeys = ALL_MODULES.map((m) => m.key);
    const identifier = session.userName.toLowerCase();

    const grantAll = () => {
      setUserModules(allKeys);
      setPerms(Object.fromEntries(allKeys.map((k) => [k, FULL_PERMS])));
      setLoading(false);
    };

    // SAP superuser, OMIE company, or "manager" account → grant all
    if (session.isSuperUser || session.erpType === "omie" || identifier === "manager") {
      grantAll();
      return;
    }

    (async () => {
      setLoading(true);

      // Cloud admin?
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession?.user) {
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", authSession.user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (roleData) { grantAll(); return; }
      }

      // SAP admin (matched by email/prefix)?
      const { data: isAdminBySap } = await supabase.rpc("is_sap_user_admin", {
        _sap_username: identifier,
      });
      if (isAdminBySap) { grantAll(); return; }

      // Global assignments — one row per (sap_email, group_id).
      const { data: allAssignments } = await supabase
        .from("user_group_assignments")
        .select("group_id, sap_email");

      const mine = (allAssignments || []).filter((a: any) => {
        const sapEmail = a.sap_email.toLowerCase();
        return sapEmail === identifier || sapEmail.startsWith(identifier + "@");
      });

      if (!mine || mine.length === 0) {
        setUserModules(DEFAULT_MODULES);
        setPerms(Object.fromEntries(DEFAULT_MODULES.map((k) => [k, isViewOnlyKey(k) ? VIEW_ONLY_PERMS : FULL_PERMS])));
        setLoading(false);
        return;
      }

      const groupIds = mine.map((a: any) => a.group_id);

      const { data: modules } = await supabase
        .from("permission_group_modules")
        .select("module_key, can_view, can_create, can_edit, can_delete")
        .in("group_id", groupIds);

      // Merge multiple groups via OR
      const merged: Record<string, ModulePerms> = {};
      for (const m of (modules || []) as any[]) {
        const prev = merged[m.module_key] || { view: false, create: false, edit: false, delete: false };
        merged[m.module_key] = {
          view:   prev.view   || (m.can_view   ?? true),
          create: prev.create || (m.can_create ?? true),
          edit:   prev.edit   || (m.can_edit   ?? true),
          delete: prev.delete || (m.can_delete ?? true),
        };
      }

      const keys = Object.keys(merged).filter((k) => merged[k].view);
      setPerms(merged);
      setUserModules(keys.length > 0 ? keys : DEFAULT_MODULES);
      setLoading(false);
    })();
  }, [session?.userName, session?.companyDB, session?.isSuperUser, session?.erpType]);

  const can: ModulePerms = moduleKey
    ? (perms[moduleKey] ?? { view: userModules.includes(moduleKey), create: false, edit: false, delete: false })
    : { view: true, create: false, edit: false, delete: false };

  const hasAccess = moduleKey ? (perms[moduleKey]?.view ?? userModules.includes(moduleKey)) : true;

  const hasCapability = (key: string) => perms[key]?.view ?? userModules.includes(key);

  return { hasAccess, loading, userModules, can, perms, hasCapability };
}
