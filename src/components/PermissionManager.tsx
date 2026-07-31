import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Users,
  Shield,
  Search,
  Save,
  Check,
  Info,
  Eye,
  Pencil,
  FilePlus2,
  CheckCircle2,
  Send,
  Download,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  canonicalUserKey,
  directoryDisplayName,
  mergeSapUsers,
  syncDirectoryFromSapUsers,
  unifyPeople,
  useUserDirectory,
  type DirectoryUser,
  type RawSapUser,
} from "@/lib/user-identity";
import {
  usePermissionGroups,
  useUserAssignments,
  MODULES,
  VIEW_ONLY_MODULES,
  CAPABILITIES,
  CAPABILITY_CATEGORIES,
  type PermissionGroup,
  type ModulePerms,
} from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import SapGroupMappingManager from "@/components/SapGroupMappingManager";
import PermissionsEnforcementManager from "@/components/PermissionsEnforcementManager";

interface SapCacheUser {
  UserCode: string;
  UserName: string;
  eMail?: string;
}

type View =
  | { name: "root" }
  | { name: "groups" }
  | { name: "group-detail"; groupId: string | null }
  | { name: "users" }
  | { name: "sap-mapping" }
  | { name: "enforcement" };


const FULL: ModulePerms = { view: true, create: true, edit: true, delete: true, approve: true, integrate: true, export: true };
const VIEW_ONLY: ModulePerms = { view: true, create: false, edit: false, delete: false, approve: false, integrate: false, export: false };
const NONE: ModulePerms = { view: false, create: false, edit: false, delete: false, approve: false, integrate: false, export: false };

/* ── iOS-style list building blocks ────────────────────────── */

function IosList({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
      {children}
    </div>
  );
}

function IosRow({
  onClick,
  disabled,
  children,
  className,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={disabled ? undefined : onClick}
      disabled={disabled as any}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 min-h-[52px] text-left",
        onClick && !disabled && "hover:bg-muted/40 active:bg-muted/60 transition-colors",
        disabled && "opacity-50",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground px-4 pt-6 pb-2">
      {children}
    </p>
  );
}

/* ── Group detail (drill-in) ───────────────────────────────── */

function GroupDetail({
  group,
  onBack,
  onSaved,
}: {
  group: PermissionGroup | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { saveGroup, deleteGroup } = usePermissionGroups();
  const [name, setName] = useState(group?.name || "");
  const [description, setDescription] = useState(group?.description || "");
  const [perms, setPerms] = useState<Record<string, ModulePerms>>(group?.modulePerms || {});
  const [saving, setSaving] = useState(false);
  const isDefault = group?.name === "Usuário";
  const isNew = !group;

  useEffect(() => {
    setName(group?.name || "");
    setDescription(group?.description || "");
    setPerms(group?.modulePerms || {});
  }, [group?.id]);

  const setP = (key: string, next: ModulePerms) => {
    setPerms((prev) => ({ ...prev, [key]: next }));
  };

  const setFlag = (key: string, flag: keyof ModulePerms, value: boolean) => {
    const cur = perms[key] || NONE;
    let next: ModulePerms = { ...cur, [flag]: value };
    // Turning off view turns off everything else
    if (flag === "view" && !value) next = NONE;
    // Turning on any CRUD auto-enables view
    if (flag !== "view" && value) next.view = true;
    setP(key, next);
  };

  const setAccess = (key: string, on: boolean, isViewOnly: boolean) => {
    setP(key, on ? (isViewOnly ? VIEW_ONLY : FULL) : NONE);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nome do grupo é obrigatório"); return; }
    setSaving(true);
    try {
      await saveGroup(name.trim(), description.trim(), perms, group?.id);
      toast.success(isNew ? "Grupo criado" : "Grupo atualizado");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!group) return;
    if (isDefault) { toast.error("O grupo padrão não pode ser excluído"); return; }
    if (!confirm(`Excluir grupo "${group.name}"? Os usuários voltarão ao grupo padrão.`)) return;
    await deleteGroup(group.id);
    toast.success("Grupo excluído");
    onSaved();
  };

  return (
    <div className="space-y-4">
      {/* Sticky-ish header */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-1">
          <ChevronLeft className="w-4 h-4" /> Grupos
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar
        </Button>
      </div>

      {/* Identity */}
      <IosList>
        <div className="p-4 space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isDefault && !isNew}
            placeholder="Nome do grupo"
            className="text-base font-medium"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição"
            rows={2}
            className="text-sm resize-none"
          />
        </div>
      </IosList>

      {/* Capabilities — todas as segregações de função do sistema */}
      <div>
        <SectionTitle>Capacidades do grupo</SectionTitle>
        <p className="text-xs text-muted-foreground px-4 pb-2 flex gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Toda segregação de função (visibilidade, filtros e ações especiais) é
          definida aqui, no grupo — nunca por usuário.
        </p>
        <div className="space-y-4">
          {CAPABILITY_CATEGORIES.map((cat) => {
            const items = CAPABILITIES.filter((c) => c.category === cat.key);
            if (!items.length) return null;
            const onCount = items.filter((c) => (perms[c.key] || NONE).view).length;
            return (
              <div key={cat.key}>
                <div className="flex items-center justify-between px-4 pb-1.5">
                  <p className="text-xs font-semibold text-foreground">{cat.label}</p>
                  <Badge variant={onCount ? "secondary" : "outline"} className="text-[10px]">
                    {onCount}/{items.length}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground px-4 pb-2">{cat.hint}</p>
                <IosList>
                  {items.map((c) => {
                    const p = perms[c.key] || NONE;
                    return (
                      <div key={c.key} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{c.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.hint}</p>
                        </div>
                        <Switch
                          checked={p.view}
                          onCheckedChange={(v) => setAccess(c.key, v, true)}
                        />
                      </div>
                    );
                  })}
                </IosList>
              </div>
            );
          })}
        </div>
      </div>


      {/* Modules with CRUD */}
      <div>
        <SectionTitle>Módulos — Acesso detalhado</SectionTitle>
        <p className="text-xs text-muted-foreground px-4 pb-2">
          Para cada módulo, defina o que o grupo pode <strong>ver, criar, editar, excluir, aprovar, integrar</strong> e <strong>exportar</strong>.
        </p>
        <IosList>
          {MODULES.map((m) => {
            const p = perms[m.key] || NONE;
            return (
              <div key={m.key} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{m.label}</p>
                    {!p.view && (
                      <p className="text-xs text-muted-foreground mt-0.5">Sem acesso</p>
                    )}
                  </div>
                  <Switch
                    checked={p.view}
                    onCheckedChange={(v) => setAccess(m.key, v, false)}
                  />
                </div>
                {p.view && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <CrudChip icon={Eye} label="Ver" checked disabled />
                    <CrudChip
                      icon={FilePlus2}
                      label="Criar"
                      checked={p.create}
                      onChange={(v) => setFlag(m.key, "create", v)}
                    />
                    <CrudChip
                      icon={Pencil}
                      label="Editar"
                      checked={p.edit}
                      onChange={(v) => setFlag(m.key, "edit", v)}
                    />
                    <CrudChip
                      icon={Trash2}
                      label="Excluir"
                      checked={p.delete}
                      onChange={(v) => setFlag(m.key, "delete", v)}
                    />
                    <CrudChip
                      icon={CheckCircle2}
                      label="Aprovar"
                      checked={p.approve}
                      onChange={(v) => setFlag(m.key, "approve", v)}
                    />
                    <CrudChip
                      icon={Send}
                      label="Integrar"
                      checked={p.integrate}
                      onChange={(v) => setFlag(m.key, "integrate", v)}
                    />
                    <CrudChip
                      icon={Download}
                      label="Exportar"
                      checked={p.export}
                      onChange={(v) => setFlag(m.key, "export", v)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </IosList>
      </div>

      {/* View-only modules */}
      <div>
        <SectionTitle>Painéis e relatórios</SectionTitle>
        <IosList>
          {VIEW_ONLY_MODULES.map((m) => {
            const p = perms[m.key] || NONE;
            return (
              <div key={m.key} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{m.label}</p>
                </div>
                <Switch
                  checked={p.view}
                  onCheckedChange={(v) => setAccess(m.key, v, true)}
                />
              </div>
            );
          })}
        </IosList>
      </div>

      {!isDefault && !isNew && (
        <div className="pt-2 pb-4">
          <Button variant="destructive" size="sm" onClick={handleDelete} className="w-full">
            <Trash2 className="w-4 h-4 mr-1" /> Excluir grupo
          </Button>
        </div>
      )}
    </div>
  );
}

function CrudChip({
  icon: Icon,
  label,
  checked,
  disabled,
  onChange,
}: {
  icon: any;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange?.(!checked)}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors",
        checked
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted/40",
        disabled && "opacity-70 cursor-default",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {checked && <Check className="w-3 h-3 ml-auto text-primary" />}
    </button>
  );
}

/* ── Users list ────────────────────────────────────────────── */

function UsersView({
  onBack,
  groups,
}: {
  onBack: () => void;
  groups: PermissionGroup[];
}) {
  const { assignments, loading, assign, remove } = useUserAssignments();
  const { users: directoryUsers, loading: directoryLoading } = useUserDirectory();
  const [cachedPeople, setCachedPeople] = useState<DirectoryUser[]>([]);
  const [sapLoading, setSapLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [sheetUser, setSheetUser] = useState<DirectoryUser | null>(null);

  useEffect(() => {
    setSapLoading(true);
    supabase
      .from("sap_cache")
      .select("data, updated_at, company_db")
      .eq("cache_key", "users")
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        const raw: RawSapUser[] = [];
        for (const row of data || []) {
          if (!Array.isArray((row as any).data)) continue;
          for (const u of (row as any).data as any[]) {
            raw.push({
              UserCode: u.UserCode || u.user_code || "",
              UserName: u.UserName || u.u_name || "",
              eMail: u.eMail || u.E_Mail || u.EMAIL || "",
            });
          }
        }
        // Uma pessoa = um usuário SAP (1 nome, N e-mails).
        setCachedPeople(mergeSapUsers(raw));
        setSapLoading(false);
        void syncDirectoryFromSapUsers(raw);
      });
  }, []);

  const people = useMemo(() => {
    const merged = new Map<string, DirectoryUser>();
    for (const user of [...directoryUsers, ...cachedPeople]) {
      const current = merged.get(user.user_key);
      if (!current) {
        merged.set(user.user_key, { ...user, emails: [...user.emails] });
        continue;
      }
      merged.set(user.user_key, {
        ...current,
        sap_user_code: current.sap_user_code || user.sap_user_code,
        display_name: current.display_name || user.display_name,
        is_active: current.is_active || user.is_active,
        emails: Array.from(new Set([...current.emails, ...user.emails])),
      });
    }
    // Mesma pessoa com variação de grafia no usuário SAP vira uma única entrada.
    return unifyPeople(Array.from(merged.values()));
  }, [directoryUsers, cachedPeople]);

  const defaultGroup = groups.find((g) => g.name === "Usuário");

  /** Força do grupo = quantidade de permissões efetivas. */
  const groupStrength = useCallback(
    (groupId: string) => {
      const g = groups.find((x) => x.id === groupId);
      if (!g) return -1;
      return Object.values(g.modulePerms || {}).reduce(
        (acc, p) => acc + Object.values(p).filter(Boolean).length,
        0,
      );
    },
    [groups],
  );

  const aliasesOf = (person: DirectoryUser) =>
    Array.from(new Set([person.user_key, ...(person.aliasKeys || [])]));

  /** Vínculo vigente: entre entradas duplicadas vence o grupo de maior permissão. */
  const assignmentOf = (person: DirectoryUser | null) => {
    if (!person) return undefined;
    const keys = aliasesOf(person);
    const matches = assignments.filter((a) => keys.includes(canonicalUserKey(a.sap_email)));
    if (matches.length === 0) return undefined;
    return matches.reduce((best, cur) =>
      groupStrength(cur.group_id) > groupStrength(best.group_id) ? cur : best,
    );
  };

  const getUserGroup = (person: DirectoryUser) =>
    groups.find((g) => g.id === assignmentOf(person)?.group_id);

  const filtered = useMemo(() => {
    return people
      .filter((u) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (
          directoryDisplayName(u).toLowerCase().includes(q) ||
          (u.sap_user_code || "").toLowerCase().includes(q) ||
          u.emails.some((e) => e.includes(q))
        );
      })
      .sort((a, b) =>
        directoryDisplayName(a).localeCompare(directoryDisplayName(b), "pt-BR", {
          sensitivity: "base",
        }),
      );
  }, [people, filter]);

  const handlePick = async (groupId: string) => {
    if (!sheetUser) return;
    try {
      // Uma única gravação: limpa todas as chaves equivalentes e grava a canônica.
      await assign(sheetUser.user_key, groupId, aliasesOf(sheetUser));
      toast.success("Permissão atualizada");
      setSheetUser(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o grupo");
    }
  };

  const handleReset = async () => {
    if (!sheetUser) return;
    const keys = aliasesOf(sheetUser);
    const stale = assignments.filter((a) => keys.includes(canonicalUserKey(a.sap_email)));
    try {
      for (const a of stale) {
        await remove(a.id);
      }
      if (stale.length > 0) toast.success("Voltou ao padrão");
      setSheetUser(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível voltar ao padrão");
    }
  };


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-1">
          <ChevronLeft className="w-4 h-4" /> Permissões
        </Button>
        <span className="text-xs text-muted-foreground">{filtered.length} usuários</span>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar por nome, código ou e-mail"
          className="pl-9 h-10 rounded-xl bg-card"
        />
      </div>

      <div className="rounded-xl border border-cactus-amber/30 bg-cactus-amber/5 px-3 py-2 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-cactus-amber" />
        <p className="text-xs text-foreground">
          A permissão de cada usuário vale para <strong>todas as empresas</strong>, independente do ERP.
        </p>
      </div>

      {sapLoading || directoryLoading || loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          Nenhum usuário encontrado.
        </div>
      ) : (
        <IosList>
          {filtered.map((u) => {
            const g = getUserGroup(u);
            return (
              <IosRow key={u.user_key} onClick={() => setSheetUser(u)}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {directoryDisplayName(u)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {u.sap_user_code || u.user_key}
                    {u.emails.length > 0 ? ` · ${u.emails.length} e-mail(s)` : ""}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-cactus-amber/15 text-foreground border-cactus-amber/40"
                >
                  {g?.name || defaultGroup?.name || "Usuário"}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </IosRow>
            );
          })}
        </IosList>
      )}

      {/* Assign sheet */}
      <Sheet open={!!sheetUser} onOpenChange={(o) => !o && setSheetUser(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-left">
              {sheetUser ? directoryDisplayName(sheetUser) : ""}
              <p className="text-xs font-normal text-muted-foreground mt-0.5">
                Usuário SAP: {sheetUser?.sap_user_code || sheetUser?.user_key}
              </p>
              {sheetUser && sheetUser.emails.length > 0 && (
                <p className="text-xs font-normal text-muted-foreground mt-0.5 break-all">
                  {sheetUser.emails.join(", ")}
                </p>
              )}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-1">
            {groups.map((g) => {
              const isCurrent = assignmentOf(sheetUser)?.group_id === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => handlePick(g.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors",
                    isCurrent ? "bg-cactus-amber/15" : "hover:bg-muted/40",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{g.name}</p>
                    {g.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {g.description}
                      </p>
                    )}
                  </div>
                  {isCurrent && <Check className="w-4 h-4 text-cactus-amber" />}
                </button>
              );
            })}
          </div>
          {assignmentOf(sheetUser) && (

            <Button
              variant="ghost"
              className="w-full mt-3 text-destructive hover:text-destructive"
              onClick={handleReset}
            >
              Voltar ao padrão
            </Button>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ── Groups list ───────────────────────────────────────────── */

function GroupsView({
  groups,
  loading,
  onBack,
  onOpen,
  onNew,
}: {
  groups: PermissionGroup[];
  loading: boolean;
  onBack: () => void;
  onOpen: (g: PermissionGroup) => void;
  onNew: () => void;
}) {
  const { assignments } = useUserAssignments();
  const memberCount = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of assignments || []) {
      if (!map.has(a.group_id)) map.set(a.group_id, new Set());
      map.get(a.group_id)!.add(canonicalUserKey(a.sap_email) || a.sap_email);
    }
    return map;
  }, [assignments]);
  const capKeys = useMemo(() => new Set(CAPABILITIES.map((c) => c.key)), []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-1">
          <ChevronLeft className="w-4 h-4" /> Permissões
        </Button>
        <Button size="sm" onClick={onNew} className="gap-1">
          <Plus className="w-4 h-4" /> Novo
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <IosList>
          {groups.map((g) => {
            const enabled = Object.entries(g.modulePerms).filter(([, p]) => p.view);
            const moduleCount = enabled.filter(([k]) => !capKeys.has(k)).length;
            const capCount = enabled.filter(([k]) => capKeys.has(k)).length;
            const members = memberCount.get(g.id)?.size ?? 0;
            return (
              <IosRow key={g.id} onClick={() => onOpen(g)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                    {g.name === "Usuário" && (
                      <Badge variant="secondary" className="text-[10px]">Padrão</Badge>
                    )}
                    {members === 0 && (
                      <Badge variant="outline" className="text-[10px]">Sem usuários</Badge>
                    )}
                  </div>
                  {g.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{g.description}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {members} {members === 1 ? "usuário" : "usuários"} · {moduleCount}{" "}
                    {moduleCount === 1 ? "tela" : "telas"} · {capCount}{" "}
                    {capCount === 1 ? "capacidade" : "capacidades"}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </IosRow>
            );
          })}
        </IosList>
      )}
    </div>
  );
}


/* ── Main Component ────────────────────────────────────────── */

export default function PermissionManager() {
  const { groups, loading, ensureDefaultGroup, refresh } = usePermissionGroups();
  const [view, setView] = useState<View>({ name: "root" });

  useEffect(() => {
    ensureDefaultGroup();
  }, []);

  const currentGroup =
    view.name === "group-detail" && view.groupId
      ? groups.find((g) => g.id === view.groupId) || null
      : null;

  const goRoot = () => setView({ name: "root" });
  const goGroups = () => setView({ name: "groups" });

  return (
    <div className="max-w-2xl mx-auto pb-6">
      {view.name === "root" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Shield className="w-5 h-5 text-cactus-amber" />
            <h3 className="text-lg font-semibold text-foreground">Permissões</h3>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Controle o que cada grupo enxerga e faz. Toda atribuição vale para todas as empresas.
          </p>
          <IosList>
            <IosRow onClick={goGroups}>
              <div className="w-9 h-9 rounded-xl bg-cactus-amber/15 flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4 text-cactus-amber" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Grupos</p>
                <p className="text-xs text-muted-foreground">
                  {groups.length} {groups.length === 1 ? "grupo" : "grupos"}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </IosRow>
            <IosRow onClick={() => setView({ name: "users" })}>
              <div className="w-9 h-9 rounded-xl bg-cactus-amber/15 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-cactus-amber" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Usuários</p>
                <p className="text-xs text-muted-foreground">Atribuir grupo a cada usuário</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </IosRow>
            <IosRow onClick={() => setView({ name: "sap-mapping" })}>
              <div className="w-9 h-9 rounded-xl bg-cactus-amber/15 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4 text-cactus-amber" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Mapeamento SAP × ERP Flow</p>
                <p className="text-xs text-muted-foreground">Vincular grupos do SAP às ações por empresa</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </IosRow>
            <IosRow onClick={() => setView({ name: "enforcement" })}>
              <div className="w-9 h-9 rounded-xl bg-destructive/15 flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Enforcement v2</p>
                <p className="text-xs text-muted-foreground">Shadow log e ativação por empresa</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </IosRow>
          </IosList>
        </div>
      )}

      {view.name === "groups" && (
        <GroupsView
          groups={groups}
          loading={loading}
          onBack={goRoot}
          onOpen={(g) => setView({ name: "group-detail", groupId: g.id })}
          onNew={() => setView({ name: "group-detail", groupId: null })}
        />
      )}

      {view.name === "group-detail" && (
        <GroupDetail
          group={currentGroup}
          onBack={goGroups}
          onSaved={async () => {
            await refresh();
            goGroups();
          }}
        />
      )}

      {view.name === "users" && <UsersView onBack={goRoot} groups={groups} />}

      {view.name === "sap-mapping" && <SapGroupMappingManager onBack={goRoot} />}

      {view.name === "enforcement" && <PermissionsEnforcementManager onBack={goRoot} />}
    </div>
  );
}
