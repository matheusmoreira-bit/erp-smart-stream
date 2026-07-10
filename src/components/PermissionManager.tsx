import { useState, useEffect, useMemo } from "react";
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
  usePermissionGroups,
  useUserAssignments,
  MODULES,
  VIEW_ONLY_MODULES,
  CAPABILITIES,
  type PermissionGroup,
  type ModulePerms,
} from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

interface SapCacheUser {
  UserCode: string;
  UserName: string;
  eMail?: string;
}

type View =
  | { name: "root" }
  | { name: "groups" }
  | { name: "group-detail"; groupId: string | null }
  | { name: "users" };

const FULL: ModulePerms = { view: true, create: true, edit: true, delete: true };
const VIEW_ONLY: ModulePerms = { view: true, create: false, edit: false, delete: false };
const NONE: ModulePerms = { view: false, create: false, edit: false, delete: false };

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

      {/* Capabilities */}
      <div>
        <SectionTitle>Capacidades</SectionTitle>
        <p className="text-xs text-muted-foreground px-4 pb-2 flex gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Flags transversais que liberam ações específicas dentro das telas.
        </p>
        <IosList>
          {CAPABILITIES.map((c) => {
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

      {/* Modules with CRUD */}
      <div>
        <SectionTitle>Módulos — Acesso detalhado</SectionTitle>
        <p className="text-xs text-muted-foreground px-4 pb-2">
          Para cada módulo, defina o que o grupo pode <strong>ver</strong>, <strong>criar</strong>, <strong>editar</strong> e <strong>excluir</strong>.
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
  const [sapUsers, setSapUsers] = useState<SapCacheUser[]>([]);
  const [sapLoading, setSapLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [sheetUser, setSheetUser] = useState<SapCacheUser | null>(null);

  useEffect(() => {
    setSapLoading(true);
    supabase
      .from("sap_cache")
      .select("data, updated_at, company_db")
      .eq("cache_key", "users")
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        const byKey = new Map<string, SapCacheUser>();
        for (const row of data || []) {
          if (!Array.isArray((row as any).data)) continue;
          for (const u of (row as any).data as any[]) {
            const user: SapCacheUser = {
              UserCode: u.UserCode || u.user_code || "",
              UserName: u.UserName || u.u_name || "",
              eMail: u.eMail || u.E_Mail || u.EMAIL || "",
            };
            const key = (user.eMail || user.UserCode || "").toLowerCase();
            if (!key) continue;
            if (!byKey.has(key)) byKey.set(key, user);
          }
        }
        setSapUsers(Array.from(byKey.values()));
        setSapLoading(false);
      });
  }, []);

  const defaultGroup = groups.find((g) => g.name === "Usuário");

  const getUserGroup = (email: string) =>
    groups.find(
      (g) =>
        g.id ===
        assignments.find((a) => a.sap_email.toLowerCase() === email.toLowerCase())?.group_id,
    );

  const filtered = useMemo(() => {
    return sapUsers
      .filter((u) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (
          (u.UserName || "").toLowerCase().includes(q) ||
          (u.UserCode || "").toLowerCase().includes(q) ||
          (u.eMail || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        (a.UserName || a.UserCode).localeCompare(b.UserName || b.UserCode, "pt-BR", {
          sensitivity: "base",
        }),
      );
  }, [sapUsers, filter]);

  const handlePick = async (groupId: string) => {
    if (!sheetUser) return;
    const email = sheetUser.eMail || sheetUser.UserCode;
    await assign(email, groupId);
    toast.success("Permissão atualizada");
    setSheetUser(null);
  };

  const handleReset = async () => {
    if (!sheetUser) return;
    const email = sheetUser.eMail || sheetUser.UserCode;
    const a = assignments.find((x) => x.sap_email.toLowerCase() === email.toLowerCase());
    if (a) {
      await remove(a.id);
      toast.success("Voltou ao padrão");
    }
    setSheetUser(null);
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

      {sapLoading || loading ? (
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
            const email = u.eMail || u.UserCode;
            const g = getUserGroup(email);
            return (
              <IosRow key={email.toLowerCase()} onClick={() => setSheetUser(u)}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {u.UserName || u.UserCode}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{email}</p>
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
              {sheetUser?.UserName || sheetUser?.UserCode}
              <p className="text-xs font-normal text-muted-foreground mt-0.5">
                {sheetUser?.eMail || sheetUser?.UserCode}
              </p>
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-1">
            {groups.map((g) => {
              const email = sheetUser ? (sheetUser.eMail || sheetUser.UserCode) : "";
              const isCurrent =
                assignments.find((a) => a.sap_email.toLowerCase() === email.toLowerCase())
                  ?.group_id === g.id;
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
          {assignments.find(
            (a) =>
              sheetUser &&
              a.sap_email.toLowerCase() === (sheetUser.eMail || sheetUser.UserCode).toLowerCase(),
          ) && (
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
            const moduleCount = Object.values(g.modulePerms).filter((p) => p.view).length;
            return (
              <IosRow key={g.id} onClick={() => onOpen(g)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                    {g.name === "Usuário" && (
                      <Badge variant="secondary" className="text-[10px]">Padrão</Badge>
                    )}
                  </div>
                  {g.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{g.description}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {moduleCount} {moduleCount === 1 ? "acesso" : "acessos"}
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
    </div>
  );
}
