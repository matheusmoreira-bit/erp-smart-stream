import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Save,
  Loader2,
  Users,
  Shield,
  UserPlus,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  usePermissionGroups,
  useUserAssignments,
  getModulesForErp,
  type PermissionGroup,
} from "@/hooks/usePermissions";

interface Company {
  company_db: string;
  display_name: string;
  erp_type: string;
}

interface SapCacheUser {
  UserCode: string;
  UserName: string;
  eMail?: string;
}

/* ── Group Dialog ── */

function GroupDialog({
  open,
  onOpenChange,
  group,
  erpType,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  group: PermissionGroup | null;
  erpType: string;
  onSave: (name: string, desc: string, modules: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name || "");
  const [desc, setDesc] = useState(group?.description || "");
  const [modules, setModules] = useState<string[]>(group?.modules || []);
  const [saving, setSaving] = useState(false);

  const availableModules = getModulesForErp(erpType);

  const toggle = (key: string) => {
    setModules((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  };

  useEffect(() => {
    setName(group?.name || "");
    setDesc(group?.description || "");
    setModules(group?.modules || []);
  }, [group]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome do grupo é obrigatório");
      return;
    }
    setSaving(true);
    await onSave(name.trim(), desc.trim(), modules);
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? "Editar Grupo" : "Novo Grupo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Nome</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: financeiro"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Descrição</label>
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Descrição do grupo"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Módulos</label>
            <div className="grid grid-cols-2 gap-2">
              {availableModules.map((mod) => (
                <label
                  key={mod.key}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={modules.includes(mod.key)}
                    onCheckedChange={() => toggle(mod.key)}
                  />
                  <span className="text-sm">{mod.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Save className="w-4 h-4 mr-1" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Component ── */

export default function PermissionManager() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>("");
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [userFilter, setUserFilter] = useState("");

  const company = companies.find((c) => c.company_db === selectedCompany);
  const erpType = company?.erp_type || "sap";

  const { groups, loading: groupsLoading, saveGroup, deleteGroup, ensureDefaultGroup } =
    usePermissionGroups(selectedCompany || undefined);
  const { assignments, loading: assignLoading, assign, remove } =
    useUserAssignments(selectedCompany || undefined);

  const [groupDialog, setGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(null);

  // SAP users from cache
  const [sapUsers, setSapUsers] = useState<SapCacheUser[]>([]);
  const [sapUsersLoading, setSapUsersLoading] = useState(false);

  // Load companies
  useEffect(() => {
    setCompaniesLoading(true);
    supabase
      .from("companies")
      .select("company_db, display_name, erp_type")
      .eq("is_active", true)
      .order("display_name")
      .then(({ data }) => {
        setCompanies(
          (data || []).map((c: any) => ({
            company_db: c.company_db,
            display_name: c.display_name,
            erp_type: c.erp_type || "sap",
          }))
        );
        setCompaniesLoading(false);
      });
  }, []);

  // Load SAP users from cache when company changes
  useEffect(() => {
    if (!selectedCompany) {
      setSapUsers([]);
      return;
    }

    setSapUsersLoading(true);
    supabase
      .from("sap_cache")
      .select("data")
      .eq("cache_key", "users")
      .eq("company_db", selectedCompany)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.data && Array.isArray(data.data)) {
          const users = (data.data as any[]).map((u) => ({
            UserCode: u.UserCode || u.user_code || "",
            UserName: u.UserName || u.u_name || "",
            eMail: u.eMail || u.E_Mail || u.EMAIL || "",
          }));
          setSapUsers(users.filter((u) => u.UserCode || u.UserName));
        } else {
          setSapUsers([]);
        }
        setSapUsersLoading(false);
      });

    // Ensure default group exists
    if (selectedCompany && erpType) {
      ensureDefaultGroup(erpType, selectedCompany);
    }
  }, [selectedCompany, erpType]);

  const openNewGroup = () => {
    setEditingGroup(null);
    setGroupDialog(true);
  };

  const openEditGroup = (g: PermissionGroup) => {
    setEditingGroup(g);
    setGroupDialog(true);
  };

  const handleDeleteGroup = async (g: PermissionGroup) => {
    if (g.name === "Usuário") {
      toast.error("O grupo padrão 'Usuário' não pode ser excluído");
      return;
    }
    if (!confirm(`Excluir grupo "${g.name}"? Os usuários perderão acesso.`)) return;
    await deleteGroup(g.id);
    toast.success("Grupo excluído");
  };

  const handleSaveGroup = async (name: string, desc: string, modules: string[]) => {
    await saveGroup(name, desc, modules, editingGroup?.id, selectedCompany);
    toast.success(editingGroup ? "Grupo atualizado" : "Grupo criado");
  };

  const handleAssignUser = async (userEmail: string, groupId: string) => {
    await assign(userEmail, groupId, selectedCompany);
    toast.success("Permissão atualizada");
  };

  const getUserGroup = (userEmail: string) => {
    const a = assignments.find(
      (a) => a.sap_email.toLowerCase() === userEmail.toLowerCase()
    );
    return a ? groups.find((g) => g.id === a.group_id) : null;
  };

  const defaultGroup = groups.find((g) => g.name === "Usuário");

  const filteredSortedUsers = sapUsers
    .filter((u) => {
      if (!userFilter) return true;
      const q = userFilter.toLowerCase();
      return (
        (u.UserName || "").toLowerCase().includes(q) ||
        (u.UserCode || "").toLowerCase().includes(q) ||
        (u.eMail || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) =>
      (a.UserName || a.UserCode).localeCompare(b.UserName || b.UserCode, "pt-BR", { sensitivity: "base" })
    );

  const getErpBadge = (erp: string) => {
    if (erp === "sap") return "SAP B1";
    if (erp.startsWith("s4hana")) return "S/4HANA";
    if (erp.startsWith("totvs")) return "TOTVS";
    if (erp === "netsuite") return "NetSuite";
    return erp.toUpperCase();
  };

  if (companiesLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Company Selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Permissões por Empresa</h3>
        </div>
        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
          <SelectTrigger className="w-[300px] bg-card">
            <SelectValue placeholder="Selecione uma empresa" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.company_db} value={c.company_db}>
                <div className="flex items-center gap-2">
                  <span>{c.display_name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {getErpBadge(c.erp_type)}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedCompany ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Selecione uma empresa para gerenciar permissões</p>
        </div>
      ) : (
        <>
          {/* Groups Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Grupos de Permissão</h3>
                <Badge variant="outline" className="text-[10px]">
                  {getErpBadge(erpType)}
                </Badge>
              </div>
              <Button size="sm" onClick={openNewGroup}>
                <Plus className="w-4 h-4 mr-1" /> Novo Grupo
              </Button>
            </div>

            {groupsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {groups.map((g) => {
                  const availableModules = getModulesForErp(erpType);
                  return (
                    <div key={g.id} className="glass-card p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground">{g.name}</p>
                            {g.name === "Usuário" && (
                              <Badge variant="secondary" className="text-[10px]">Padrão</Badge>
                            )}
                          </div>
                          {g.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {g.modules.map((m) => {
                              const mod = availableModules.find((am) => am.key === m);
                              return (
                                <Badge key={m} variant="secondary" className="text-[10px]">
                                  {mod?.label || m}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => openEditGroup(g)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {g.name !== "Usuário" && (
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteGroup(g)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Users Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Usuários</h3>
              </div>
              <Input
                placeholder="Filtrar usuários..."
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="w-[260px] h-8 text-sm bg-card"
              />
            </div>

            <p className="text-xs text-muted-foreground mb-3">
              Usuários sem grupo atribuído possuem a permissão padrão <strong>Usuário</strong> (apenas despesas).
            </p>

            {sapUsersLoading || assignLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : sapUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Nenhum usuário encontrado no cache. Faça login na empresa e atualize a lista de usuários.
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden bg-card">
                <div className="grid grid-cols-[1fr_1fr_auto] items-center px-4 py-2.5 border-b border-border bg-muted/30">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Usuário</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Grupo</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-20 text-right">Ação</span>
                </div>

                {filteredSortedUsers.map((user) => {
                  const email = user.eMail || user.UserCode;
                  const currentGroup = getUserGroup(email);
                  const assignment = assignments.find(
                    (a) => a.sap_email.toLowerCase() === email.toLowerCase()
                  );

                  return (
                    <div
                      key={user.UserCode}
                      className="grid grid-cols-[1fr_1fr_auto] items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/20"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {user.UserName || user.UserCode}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{email}</p>
                      </div>

                      <div>
                        <Select
                          value={currentGroup?.id || defaultGroup?.id || ""}
                          onValueChange={(groupId) => handleAssignUser(email, groupId)}
                        >
                          <SelectTrigger className="h-8 text-xs bg-card w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {groups.map((g) => (
                              <SelectItem key={g.id} value={g.id}>
                                {g.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="w-20 flex justify-end">
                        {assignment && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Remover atribuição (voltar ao padrão)"
                            onClick={() => remove(assignment.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* Dialogs */}
      <GroupDialog
        open={groupDialog}
        onOpenChange={setGroupDialog}
        group={editingGroup}
        erpType={erpType}
        onSave={handleSaveGroup}
      />
    </div>
  );
}
