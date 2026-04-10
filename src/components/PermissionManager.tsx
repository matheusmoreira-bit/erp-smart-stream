import { useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Save,
  Loader2,
  Users,
  Shield,
  UserPlus,
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
import {
  usePermissionGroups,
  useUserAssignments,
  ALL_MODULES,
  type PermissionGroup,
} from "@/hooks/usePermissions";

/* ── Group Dialog ── */

function GroupDialog({
  open,
  onOpenChange,
  group,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  group: PermissionGroup | null;
  onSave: (name: string, desc: string, modules: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name || "");
  const [desc, setDesc] = useState(group?.description || "");
  const [modules, setModules] = useState<string[]>(group?.modules || []);
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => {
    setModules((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  };

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
              {ALL_MODULES.map((mod) => (
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

/* ── Assign User Dialog ── */

function AssignDialog({
  open,
  onOpenChange,
  groups,
  onAssign,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groups: PermissionGroup[];
  onAssign: (email: string, groupId: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [groupId, setGroupId] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!email.trim() || !groupId) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSaving(true);
    await onAssign(email.trim(), groupId);
    toast.success("Usuário atribuído ao grupo");
    setSaving(false);
    setEmail("");
    setGroupId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir Usuário a Grupo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">E-mail SAP</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@empresa.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Grupo</label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="bg-card">
                <SelectValue placeholder="Selecione um grupo" />
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <UserPlus className="w-4 h-4 mr-1" />
            )}
            Atribuir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Component ── */

export default function PermissionManager() {
  const { groups, loading: groupsLoading, saveGroup, deleteGroup } = usePermissionGroups();
  const { assignments, loading: assignLoading, assign, remove } = useUserAssignments();

  const [groupDialog, setGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(null);
  const [assignDialog, setAssignDialog] = useState(false);

  const openNewGroup = () => {
    setEditingGroup(null);
    setGroupDialog(true);
  };

  const openEditGroup = (g: PermissionGroup) => {
    setEditingGroup(g);
    setGroupDialog(true);
  };

  const handleDeleteGroup = async (g: PermissionGroup) => {
    if (!confirm(`Excluir grupo "${g.name}"? Os usuários perderão acesso.`)) return;
    await deleteGroup(g.id);
    toast.success("Grupo excluído");
  };

  const handleSaveGroup = async (name: string, desc: string, modules: string[]) => {
    await saveGroup(name, desc, modules, editingGroup?.id);
    toast.success(editingGroup ? "Grupo atualizado" : "Grupo criado");
  };

  return (
    <div className="space-y-8">
      {/* Groups Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Grupos de Permissão</h3>
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
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="glass-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{g.name}</p>
                    {g.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {g.modules.map((m) => {
                        const mod = ALL_MODULES.find((am) => am.key === m);
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
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteGroup(g)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* User Assignments Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Usuários & Grupos</h3>
          </div>
          <Button size="sm" onClick={() => setAssignDialog(true)}>
            <UserPlus className="w-4 h-4 mr-1" /> Atribuir
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Usuários sem grupo atribuído acessam apenas <strong>Analytics (Fluxo)</strong> e{" "}
          <strong>Despesas</strong>.
        </p>

        {assignLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhum usuário atribuído a grupos ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {assignments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{a.sap_email}</p>
                </div>
                <Badge variant="outline">{a.group_name}</Badge>
                <Button variant="ghost" size="icon" onClick={() => remove(a.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Dialogs */}
      <GroupDialog
        open={groupDialog}
        onOpenChange={setGroupDialog}
        group={editingGroup}
        onSave={handleSaveGroup}
      />
      <AssignDialog
        open={assignDialog}
        onOpenChange={setAssignDialog}
        groups={groups}
        onAssign={assign}
      />
    </div>
  );
}
