import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Search,
  Clock,
  Phone,
  MoreHorizontal,
  UserPlus,
  AlertTriangle,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSapUsers } from "@/hooks/useSapUsers";
import type { SapUser } from "@/lib/cache-repository";
import CreateUserDialog from "@/components/CreateUserDialog";
import AdminUsersManager from "@/components/AdminUsersManager";
import { useSap } from "@/contexts/SapContext";
import { listSapTargetCompanies, changePasswordInCompanies } from "@/lib/sap-multi-password";
import { useUserPhones } from "@/hooks/useUserPhones";
import EditPhoneDialog from "@/components/EditPhoneDialog";
import { toast } from "sonner";
import { PageTitle } from "@/components/PageTitle";
import { ProvisionSapAccessDialog } from "@/components/ProvisionSapAccessDialog";
import { useUserGroupAdmin } from "@/hooks/useUserGroupAdmin";
import { useMyPermissionGroups } from "@/hooks/useMyPermissionGroups";
import {
  useManagementSegments,
  MANAGEMENT_SEGMENT_LABEL,
  segmentsForCompany,
  type ManagementSegment,
} from "@/hooks/useManagementSegments";
import { useUsersDirectoryState } from "@/hooks/useUsersDirectoryState";
import { deriveUserAlerts, alertSeverityScore, IDP_STATE_LABEL, type UserAlert } from "@/lib/user-state";
import UserDetailDrawer, { type UserDrawerData } from "@/components/users/UserDetailDrawer";
import { logAuditAction } from "@/hooks/useAuditLog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type SegmentKey = "all" | "admins" | "sap" | "blocked" | "divergences";

const SEGMENT_LABEL: Record<SegmentKey, string> = {
  all: "Todos",
  admins: "Admins backoffice",
  sap: "Com vínculo SAP",
  blocked: "Bloqueados",
  divergences: "Divergências IdP",
};

type BulkAction =
  | { kind: "segment"; value: ManagementSegment }
  | { kind: "group"; value: string | null }
  | { kind: "lock"; value: boolean }
  | { kind: "license"; value: boolean }
  | null;

function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function fmtDateTime(value: string | null): string {
  if (!value) return "Sem registro";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function UsersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { session } = useSap();
  const { isAdmin: isCloudAdmin } = useAuth();
  const { users, isLoading, error, actionLoading, refresh, toggleLock, resetPassword, createUser } = useSapUsers();
  const { phones, upsertPhone } = useUserPhones();
  const { isPrivileged } = useMyPermissionGroups();
  const { groups: permissionGroups, groupOf, setGroup } = useUserGroupAdmin();
  const { segmentOf, setSegment, refresh: refreshSegments } = useManagementSegments(session?.companyDB);
  const directory = useUsersDirectoryState(session?.companyDB);
  const backofficeMode = !session && isCloudAdmin;
  const [adminUsers, setAdminUsers] = useState<SapUser[]>([]);
  const [adminUserCompanies, setAdminUserCompanies] = useState<Record<string, string[]>>({});
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const loadBackofficeUsers = useCallback(async () => {
    if (!backofficeMode) return;
    setAdminLoading(true);
    setAdminError(null);
    try {
      const { data: companiesPayload, error: companiesError } = await supabase.functions.invoke("sap-users-admin", {
        body: { action: "list_companies" },
      });
      if (companiesError) throw companiesError;
      const companies = ((companiesPayload?.companies || []) as { company_db: string; display_name: string }[]);
      const merged = new Map<string, SapUser>();
      const byCompany: Record<string, Set<string>> = {};
      await Promise.all(companies.map(async (company) => {
        const { data, error: listError } = await supabase.functions.invoke("sap-users-admin", {
          body: { action: "list_users", company_db: company.company_db },
        });
        if (listError) throw listError;
        for (const raw of ((data?.users || []) as Record<string, unknown>[])) {
          const user: SapUser = {
            InternalKey: Number(raw.InternalKey || 0),
            UserCode: String(raw.UserCode || ""),
            UserName: String(raw.UserName || ""),
            eMail: raw.eMail ? String(raw.eMail) : undefined,
            Locked: raw.Locked === "tYES" ? "tYES" : "tNO",
            LastLoginDate: raw.LastLoginDate ? String(raw.LastLoginDate) : undefined,
            LastLoginTime: raw.LastLoginTime ? String(raw.LastLoginTime) : undefined,
          };
          const key = (user.UserCode || user.eMail || "").toLowerCase();
          if (!key) continue;
          if (!merged.has(key)) merged.set(key, user);
          (byCompany[key] ||= new Set()).add(company.company_db);
        }
      }));
      setAdminUsers(Array.from(merged.values()));
      setAdminUserCompanies(Object.fromEntries(Object.entries(byCompany).map(([key, set]) => [key, Array.from(set)])));
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : "Erro ao carregar usuários agregados");
    } finally {
      setAdminLoading(false);
    }
  }, [backofficeMode]);

  useEffect(() => {
    loadBackofficeUsers();
  }, [loadBackofficeUsers]);

  const createUserForBackoffice = useCallback(async (
    userData: { UserCode: string; UserName: string; eMail: string; Password: string },
    targetCompanyDbs?: string[],
  ) => {
    const results = await Promise.all((targetCompanyDbs || []).map(async (db) => {
      try {
        const { data, error: createError } = await supabase.functions.invoke("sap-users-admin", {
          body: {
            action: "create_user",
            company_db: db,
            user_code: userData.UserCode,
            user_name: userData.UserName,
            email: userData.eMail,
            password: userData.Password,
          },
        });
        if (createError || data?.error) throw new Error(data?.error || createError?.message || "Erro");
        return { companyDB: db, displayName: db, status: "success" as const };
      } catch (e) {
        return {
          companyDB: db,
          displayName: db,
          status: "error" as const,
          message: e instanceof Error ? e.message : "Erro desconhecido",
        };
      }
    }));
    await loadBackofficeUsers();
    return { created: false, replicationResults: results };
  }, [loadBackofficeUsers]);

  const segment = (params.get("seg") as SegmentKey) || "all";
  const setSegmentKey = (key: SegmentKey) => {
    const next = new URLSearchParams(params);
    if (key === "all") next.delete("seg");
    else next.set("seg", key);
    setParams(next, { replace: true });
  };

  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<string>("recentes");
  const [managementFilter, setManagementFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>(params.get("company") || "all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [alertFilter, setAlertFilter] = useState<string>("all");

  const [drawerUser, setDrawerUser] = useState<SapUser | null>(null);
  const [phoneUser, setPhoneUser] = useState<SapUser | null>(null);
  const [provisionUser, setProvisionUser] = useState<SapUser | null>(null);
  const [lockUser, setLockUser] = useState<SapUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAction>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  // Multi-company password reset
  const [pwdUser, setPwdUser] = useState<SapUser | null>(null);
  const [otherCompanies, setOtherCompanies] = useState<{ company_db: string; display_name: string }[]>([]);
  const [pwdSelected, setPwdSelected] = useState<Set<string>>(new Set());
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  useEffect(() => {
    if (!pwdUser || !session) return;
    listSapTargetCompanies(session.companyDB).then((cs) =>
      setOtherCompanies(cs.map((c) => ({ company_db: c.company_db, display_name: c.display_name }))),
    );
    setPwdSelected(new Set());
  }, [pwdUser, session]);

  const handleResetPassword = async () => {
    if (!pwdUser) return;
    setPwdSubmitting(true);
    try {
      await resetPassword(pwdUser);
      let extra: Awaited<ReturnType<typeof changePasswordInCompanies>> = [];
      if (pwdSelected.size > 0) {
        extra = await changePasswordInCompanies(pwdUser.UserCode, "Sap@2025", Array.from(pwdSelected));
      }
      const failures = extra.filter((r) => r.status === "error");
      const successes = extra.filter((r) => r.status === "success");
      if (extra.length === 0) toast.success(`Senha de ${pwdUser.UserName} alterada para Sap@2025`);
      else if (failures.length === 0) toast.success(`Senha alterada em ${1 + successes.length} empresa(s).`);
      else toast.warning(`Alterada em ${1 + successes.length} empresa(s). Falhas: ${failures.map((f) => f.displayName).join(", ")}`);
      await logAuditAction({
        action: "user_password_reset",
        entity_type: "user",
        entity_id: pwdUser.UserCode,
        company_db: session?.companyDB,
      });
      setPwdUser(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao redefinir senha");
    } finally {
      setPwdSubmitting(false);
    }
  };

  /** Estado composto por usuário — calculado a partir dos dados do ERP Flow. */
  const rows = useMemo(() => {
    const sourceUsers = backofficeMode ? adminUsers : users;
    return sourceUsers.map((user) => {
      const ids = [user.UserCode, user.eMail];
      const group = groupOf(
        session?.companyDB || (backofficeMode && companyFilter !== "all" ? companyFilter : undefined),
        ...ids,
      );
      const mgmt = segmentOf(...ids);
      const idp = directory.idpOf(...ids);
      const license = directory.licenseOf(...ids);
      const isAdmin = directory.isAdminUser(...ids);
      const login = directory.loginOf(...ids);
      const locked = user.Locked === "tYES";
      const alerts: UserAlert[] = deriveUserAlerts({
        locked,
        sapLinked: !!user.UserCode,
        idp,
        isAdmin,
        hasLicense: license.hasLicense,
        groupName: group?.name ?? null,
      });
      return {
        user,
        locked,
        group,
        mgmt,
        idp,
        license,
        isAdmin,
        lastLogin: login?.lastLogin ?? null,
        companies: backofficeMode
          ? (adminUserCompanies[(user.UserCode || user.eMail || "").toLowerCase()] || [])
          : directory.companiesOf(...ids),
        alerts,
      };
    });
  }, [adminUserCompanies, adminUsers, backofficeMode, companyFilter, directory, groupOf, segmentOf, session?.companyDB, users]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      admins: rows.filter((r) => r.isAdmin).length,
      sap: rows.filter((r) => !!r.user.UserCode).length,
      blocked: rows.filter((r) => r.locked).length,
      divergences: rows.filter((r) => r.alerts.length > 0).length,
    }),
    [rows],
  );

  const companyOptions = useMemo(
    () => backofficeMode
      ? Array.from(new Set(Object.values(adminUserCompanies).flat())).sort()
      : directory.sapCompanies,
    [adminUserCompanies, backofficeMode, directory.sapCompanies],
  );

  const filtered = useMemo(() => {
    let list = rows;
    const q = search.trim().toLowerCase();

    if (segment === "admins") list = list.filter((r) => r.isAdmin);
    else if (segment === "sap") list = list.filter((r) => !!r.user.UserCode);
    else if (segment === "blocked") list = list.filter((r) => r.locked);
    else if (segment === "divergences") list = list.filter((r) => r.alerts.length > 0);

    // "Ativos recentes": login no ERP Flow nos últimos 30 dias.
    if (viewMode === "recentes" && !q && segment !== "blocked") {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const anyLogin = list.some((r) => r.lastLogin);
      if (anyLogin) list = list.filter((r) => r.lastLogin && new Date(r.lastLogin).getTime() >= cutoff);
    }

    if (managementFilter !== "all") list = list.filter((r) => r.mgmt === managementFilter);
    if (companyFilter !== "all")
      list = list.filter((r) => r.companies.includes(companyFilter) || session?.companyDB === companyFilter);
    if (groupFilter !== "all")
      list = list.filter((r) => (groupFilter === "none" ? !r.group : r.group?.id === groupFilter));
    if (alertFilter === "critical") list = list.filter((r) => r.alerts.some((a) => a.severity === "critical"));
    else if (alertFilter === "warning") list = list.filter((r) => r.alerts.length > 0);
    else if (alertFilter === "ok") list = list.filter((r) => r.alerts.length === 0);

    if (q) {
      const norm = (v?: string | null) =>
        (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const nq = norm(q);
      list = list.filter(
        (r) =>
          norm(r.user.UserName).includes(nq) ||
          norm(r.user.UserCode).includes(nq) ||
          norm(r.user.eMail).includes(nq),
      );
    }


    const sorted = [...list];
    if (segment === "divergences") {
      sorted.sort((a, b) => alertSeverityScore(b.alerts) - alertSeverityScore(a.alerts));
    } else {
      sorted.sort((a, b) =>
        (a.user.UserName || a.user.UserCode || "").localeCompare(b.user.UserName || b.user.UserCode || "", "pt-BR", {
          sensitivity: "base",
        }),
      );
    }
    return sorted;
  }, [rows, search, segment, viewMode, managementFilter, companyFilter, groupFilter, alertFilter, session?.companyDB]);

  const toggleSelect = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.user.UserCode)),
    [filtered, selected],
  );

  const runBulk = useCallback(async () => {
    if (!bulk || selectedRows.length === 0) return;
    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const row of selectedRows) {
      try {
        if (bulk.kind === "segment") {
          await setSegment(row.user.UserCode || row.user.eMail, bulk.value);
        } else if (bulk.kind === "group") {
          await setGroup({ userCode: row.user.UserCode, email: row.user.eMail, groupId: bulk.value, companyDb: session?.companyDB ?? null });
        } else if (bulk.kind === "lock") {
          if (row.locked !== bulk.value) await toggleLock(row.user);
        } else if (bulk.kind === "license") {
          const { supabase } = await import("@/integrations/supabase/client");
          const { error: err } = await supabase.from("user_licenses").upsert(
            [
              {
                company_db: session?.companyDB ?? "",
                user_code: row.user.UserCode,
                user_name: row.user.UserName,
                has_license: bulk.value,
                is_locked: row.locked,
              },
            ],
            { onConflict: "company_db,user_code" },
          );
          if (err) throw new Error(err.message);
        }
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    await logAuditAction({
      action: `users_bulk_${bulk.kind}`,
      entity_type: "user",
      company_db: session?.companyDB,
      details: { count: selectedRows.length, ok, fail, value: "value" in bulk ? bulk.value : null },
    });
    if (fail === 0) toast.success(`${ok} usuário(s) atualizados.`);
    else toast.warning(`${ok} atualizados, ${fail} com falha.`);
    setBulk(null);
    setBulkRunning(false);
    setSelected(new Set());
    refreshSegments();
    directory.refresh();
  }, [bulk, selectedRows, setSegment, setGroup, toggleLock, session?.companyDB, refreshSegments, directory]);

  const bulkDescription = () => {
    const n = selectedRows.length;
    if (!bulk) return "";
    if (bulk.kind === "segment") return `Você vai reatribuir ${n} usuário(s) para a gestão ${MANAGEMENT_SEGMENT_LABEL[bulk.value]}.`;
    if (bulk.kind === "group")
      return `Você vai atribuir o grupo "${permissionGroups.find((g) => g.id === bulk.value)?.name ?? "Sem grupo"}" a ${n} usuário(s) nesta empresa.`;
    if (bulk.kind === "lock") return `Você vai ${bulk.value ? "bloquear" : "desbloquear"} o acesso de ${n} usuário(s) no ERP.`;
    return `Você vai ${bulk.value ? "atribuir" : "remover"} licença de ${n} usuário(s) em ${session?.companyDB || "—"}.`;
  };

  const drawerData: UserDrawerData | null = useMemo(() => {
    if (!drawerUser) return null;
    const row = rows.find((r) => r.user.UserCode === drawerUser.UserCode);
    if (!row) return null;
    return {
      user: row.user,
      segment: row.mgmt,
      groupId: row.group?.id ?? null,
      groupName: row.group?.name ?? null,
      idp: row.idp,
      isAdmin: row.isAdmin,
      hasLicense: row.license.hasLicense,
      licenseType: row.license.type,
      phone: phones[row.user.UserCode]?.phone,
      lastLogin: row.lastLogin,
      alerts: row.alerts,
    };
  }, [drawerUser, rows, phones]);

  const handleToggleLock = async (user: SapUser) => {
    try {
      await toggleLock(user);
      await logAuditAction({
        action: user.Locked === "tYES" ? "user_unblocked" : "user_blocked",
        entity_type: "user",
        entity_id: user.UserCode,
        company_db: session?.companyDB,
      });
      toast.success(user.Locked === "tYES" ? "Acesso desbloqueado" : "Acesso bloqueado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao alterar acesso");
    } finally {
      setLockUser(null);
    }
  };

  const pageLoading = backofficeMode ? adminLoading : isLoading;
  const pageError = backofficeMode ? adminError : error;
  const scopedCompanyDb = session?.companyDB || (backofficeMode && companyFilter !== "all" ? companyFilter : undefined);
  const refreshPage = () => {
    if (backofficeMode) void loadBackofficeUsers();
    else {
      refresh();
      directory.refresh();
    }
  };

  return (
    <div className={embedded ? "" : "min-h-screen bg-background"}>
      {!embedded && <PageTitle title="Usuários" />}

      <header className={embedded ? "px-0 pb-4" : "border-b border-border px-6 py-6"}>
        <div className="max-w-6xl mx-auto flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {!embedded && (
              <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/")}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}
            <div className="min-w-0">
              <h1 className={embedded ? "text-lg font-semibold text-foreground" : "text-2xl font-bold text-foreground"}>
                Usuários
              </h1>
              <p className="text-sm text-muted-foreground">
                {counts.all} usuários · {backofficeMode ? "todas as bases" : session?.companyDB || "sem empresa ativa"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!embedded && <ThemeToggle />}
            <CreateUserDialog
              onCreateUser={backofficeMode ? createUserForBackoffice : createUser}
              isLoading={pageLoading}
              adminMode={backofficeMode}
            />
            <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Convidar admin
            </Button>
            <Button variant="outline" size="sm" onClick={refreshPage} disabled={pageLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${pageLoading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Segmentos */}
        <div className="max-w-6xl mx-auto mt-4 flex flex-wrap gap-2">
          {(Object.keys(SEGMENT_LABEL) as SegmentKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSegmentKey(key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                segment === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {SEGMENT_LABEL[key]}
              <span className="ml-1.5 opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
      </header>

      <main className={embedded ? "max-w-6xl mx-auto space-y-4" : "max-w-6xl mx-auto px-6 py-6 space-y-4"}>
        {pageError && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {pageError}
          </div>
        )}

        {segment === "admins" && (
          <div className="rounded-xl border border-border bg-card p-4">
            <AdminUsersManager />
          </div>
        )}

        {/* Barra de filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código, nome, e-mail ou username…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-card border-border"
            />
          </div>

          <Select value={managementFilter} onValueChange={setManagementFilter}>
            <SelectTrigger className="w-[150px] bg-card"><SelectValue placeholder="Gestão" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda gestão</SelectItem>
              {segmentsForCompany(session?.companyDB).map((s) => (
                <SelectItem key={s} value={s}>{MANAGEMENT_SEGMENT_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-[170px] bg-card"><SelectValue placeholder="Empresa SAP" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as empresas</SelectItem>
              {companyOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-[170px] bg-card"><SelectValue placeholder="Grupo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os grupos</SelectItem>
              <SelectItem value="none">Sem grupo</SelectItem>
              {permissionGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={alertFilter} onValueChange={setAlertFilter}>
            <SelectTrigger className="w-[160px] bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer status</SelectItem>
              <SelectItem value="critical">Só críticos</SelectItem>
              <SelectItem value="warning">Com alerta</SelectItem>
              <SelectItem value="ok">Sem alerta</SelectItem>
            </SelectContent>
          </Select>

          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => { if (v) setViewMode(v); }}
            className="border border-border rounded-lg p-0.5 bg-muted/50"
          >
            <ToggleGroupItem value="recentes" className="text-xs px-3 h-8 rounded-md text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              Ativos recentes
            </ToggleGroupItem>
            <ToggleGroupItem value="todos" className="text-xs px-3 h-8 rounded-md text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              Todos
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {pageLoading ? (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 text-center space-y-2">
            <ShieldCheck className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Nenhum usuário neste recorte</p>
            <p className="text-xs text-muted-foreground">
              Ajuste os filtros ou volte para o segmento “Todos”.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden bg-card">
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
              <Checkbox
                aria-label="Selecionar todos (com filtro aplicado)"
                checked={selectedRows.length > 0 && selectedRows.length === filtered.length}
                onCheckedChange={(c) =>
                  setSelected(c ? new Set(filtered.map((r) => r.user.UserCode)) : new Set())
                }
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {filtered.length} usuário(s)
              </span>
            </div>

            {filtered.map((row) => {
              const user = row.user;
              const isActing = actionLoading === user.InternalKey;
              const initials = getInitials(user.UserName || user.UserCode || "?");
              return (
                <div
                  key={user.InternalKey || user.UserCode}
                  className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center"
                >
                  <Checkbox
                    aria-label={`Selecionar ${user.UserName || user.UserCode}`}
                    checked={selected.has(user.UserCode)}
                    onCheckedChange={() => toggleSelect(user.UserCode)}
                  />

                  <button
                    type="button"
                    onClick={() => setDrawerUser(user)}
                    className="flex flex-1 items-center gap-3 text-left min-w-0"
                  >
                    <div className={`flex-shrink-0 w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center ${row.locked ? "opacity-60" : ""}`}>
                      <span className="text-sm font-bold text-primary">{initials}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{user.UserName || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {user.UserCode || "sem username"} · {user.eMail || "sem e-mail"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {phones[user.UserCode]?.phone || <span className="italic">Sem telefone</span>}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">{MANAGEMENT_SEGMENT_LABEL[row.mgmt]}</Badge>
                        <Badge variant="outline" className="text-[10px]">{row.group?.name ?? "Sem grupo"}</Badge>
                        {row.isAdmin && <Badge variant="secondary" className="text-[10px]">Admin</Badge>}
                      </div>
                    </div>
                  </button>

                  <div className="flex w-full flex-col items-start gap-1 sm:w-56 sm:items-center">
                    <Badge
                      variant={row.locked ? "destructive" : "secondary"}
                      className={!row.locked ? "bg-success/20 text-success border-success/30 font-semibold" : "font-semibold"}
                    >
                      {row.locked ? "BLOQUEADO" : "ATIVO"}
                    </Badge>
                    {row.alerts.map((a) => (
                      <button
                        key={a.key}
                        title={a.hint}
                        onClick={() =>
                          a.key === "idp-divergence"
                            ? navigate(`/usuarios/sincronizacao-idp?user=${encodeURIComponent(user.UserCode)}`)
                            : setDrawerUser(user)
                        }
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                          a.severity === "critical"
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-warning/40 bg-warning/10 text-warning"
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {a.label}
                      </button>
                    ))}
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Último login: {fmtDateTime(row.lastLogin)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 sm:w-32 sm:justify-end">
                    {isActing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setDrawerUser(user)}>
                          Abrir
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais ações">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => setDrawerUser(user)}>Editar acesso</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPwdUser(user)}>Redefinir senha</DropdownMenuItem>
                            {user.eMail && (
                              <DropdownMenuItem onClick={() => setProvisionUser(user)}>
                                Provisionar / reenviar credenciais
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => navigate("/usuarios/atividade")}>
                              Ver atividade
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => navigate(`/usuarios/sincronizacao-idp?user=${encodeURIComponent(user.UserCode)}`)}
                            >
                              Vínculos (SAP/IdP) · {IDP_STATE_LABEL[row.idp]}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPhoneUser(user)}>Editar telefone</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setLockUser(user)}
                            >
                              {row.locked ? "Desbloquear acesso" : "Bloquear acesso"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Barra de ações em lote */}
      {selectedRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 px-4">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-lg">
            <span className="text-sm font-medium text-foreground">
              {selectedRows.length} selecionado(s)
            </span>
            <Select onValueChange={(v) => setBulk({ kind: "segment", value: v as ManagementSegment })}>
              <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Reatribuir gestão" /></SelectTrigger>
              <SelectContent>
                {segmentsForCompany(session?.companyDB).map((s) => (
                  <SelectItem key={s} value={s}>{MANAGEMENT_SEGMENT_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => setBulk({ kind: "group", value: v === "none" ? null : v })}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Atribuir grupo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem grupo</SelectItem>
                {permissionGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setBulk({ kind: "lock", value: true })}>Bloquear</Button>
            <Button variant="outline" size="sm" onClick={() => setBulk({ kind: "lock", value: false })}>Desbloquear</Button>
            <Button variant="outline" size="sm" onClick={() => setBulk({ kind: "license", value: true })}>Atribuir licença</Button>
            <Button variant="outline" size="sm" onClick={() => setBulk({ kind: "license", value: false })}>Remover licença</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="w-4 h-4 mr-1" /> Limpar
            </Button>
          </div>
        </div>
      )}

      {/* Confirmação de lote */}
      <Dialog open={!!bulk} onOpenChange={(o) => !o && setBulk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar ação em lote</DialogTitle>
            <DialogDescription>{bulkDescription()} A ação é registrada em auditoria.</DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 text-xs text-muted-foreground">
            {selectedRows.map((r) => (
              <p key={r.user.UserCode}>{r.user.UserName || r.user.UserCode}</p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulk(null)} disabled={bulkRunning}>Cancelar</Button>
            <Button onClick={runBulk} disabled={bulkRunning}>
              {bulkRunning && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bloqueio individual */}
      <Dialog open={!!lockUser} onOpenChange={(o) => !o && setLockUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lockUser?.Locked === "tYES" ? "Desbloquear acesso" : "Bloquear acesso"}</DialogTitle>
            <DialogDescription>
              {lockUser?.Locked === "tYES"
                ? `Restaurar o acesso de "${lockUser?.UserName}" no ERP.`
                : `"${lockUser?.UserName}" perderá o acesso ao ERP imediatamente.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockUser(null)}>Cancelar</Button>
            <Button
              variant={lockUser?.Locked === "tYES" ? "default" : "destructive"}
              onClick={() => lockUser && handleToggleLock(lockUser)}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Redefinição de senha multi-empresa */}
      <Dialog open={!!pwdUser} onOpenChange={(o) => { if (!o) setPwdUser(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir Senha</DialogTitle>
            <DialogDescription>
              A senha de <span className="font-medium text-foreground">{pwdUser?.UserName}</span> será redefinida para{" "}
              <span className="font-mono">Sap@2025</span> na empresa atual.
            </DialogDescription>
          </DialogHeader>
          {otherCompanies.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm font-medium">Aplicar também em outras empresas</p>
              <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border border-border p-2">
                {otherCompanies.map((c) => (
                  <label key={c.company_db} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={pwdSelected.has(c.company_db)}
                      onCheckedChange={() =>
                        setPwdSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.company_db)) next.delete(c.company_db);
                          else next.add(c.company_db);
                          return next;
                        })
                      }
                    />
                    <span className="text-foreground">{c.display_name}</span>
                    <span className="text-xs text-muted-foreground">({c.company_db})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdUser(null)} disabled={pwdSubmitting}>Cancelar</Button>
            <Button onClick={handleResetPassword} disabled={pwdSubmitting}>
              {pwdSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convite de admin backoffice */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Administradores do backoffice</DialogTitle>
            <DialogDescription>
              Convide ou remova administradores. O convite é aplicado imediatamente no ERP Flow.
            </DialogDescription>
          </DialogHeader>
          <AdminUsersManager />
        </DialogContent>
      </Dialog>

      <UserDetailDrawer
        data={drawerData}
        companyDb={scopedCompanyDb}
        groups={permissionGroups}
        onClose={() => setDrawerUser(null)}
        onSetSegment={(identity, seg) => setSegment(identity, seg)}
        onSetGroup={setGroup}
        onToggleLock={toggleLock}
        onResetPassword={(u) => { setDrawerUser(null); setPwdUser(u); }}
        onEditPhone={(u) => { setDrawerUser(null); setPhoneUser(u); }}
        onChanged={() => { refreshPage(); directory.refresh(); refreshSegments(); }}
      />

      {provisionUser?.eMail && (
        <ProvisionSapAccessDialog
          open={!!provisionUser}
          onOpenChange={(o) => { if (!o) setProvisionUser(null); }}
          targetEmail={provisionUser.eMail}
          initialSapUser={provisionUser.UserCode}
          initialCompanyDbs={session ? [session.companyDB] : []}
        />
      )}

      {phoneUser && (
        <EditPhoneDialog
          open={!!phoneUser}
          onOpenChange={(o) => { if (!o) setPhoneUser(null); }}
          userCode={phoneUser.UserCode}
          userName={phoneUser.UserName || phoneUser.UserCode}
          currentPhone={phones[phoneUser.UserCode]?.phone}
          onSave={(phone, source) => upsertPhone(phoneUser.UserCode, phone, source)}
        />
      )}

      {!isPrivileged && null}
    </div>
  );
}
