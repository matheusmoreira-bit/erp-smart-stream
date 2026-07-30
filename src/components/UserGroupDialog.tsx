import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { PermissionGroupOption } from "@/hooks/useUserGroupAdmin";

const NONE = "__none__";

type Props = {
  open: boolean;
  onClose: () => void;
  userName: string;
  userCode: string;
  email?: string | null;
  groups: PermissionGroupOption[];
  currentGroupId: string | null;
  onSave: (groupId: string | null) => Promise<void>;
};

export default function UserGroupDialog({
  open,
  onClose,
  userName,
  userCode,
  email,
  groups,
  currentGroupId,
  onSave,
}: Props) {
  const [value, setValue] = useState<string>(currentGroupId ?? NONE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(currentGroupId ?? NONE);
  }, [open, currentGroupId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(value === NONE ? null : value);
      toast.success(`Grupo de ${userName} atualizado em todas as empresas`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o grupo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grupo de permissão</DialogTitle>
          <DialogDescription>
            {userName} ({userCode}
            {email ? ` · ${email}` : ""}). O grupo é global: a alteração vale para todas as
            empresas.
          </DialogDescription>
        </DialogHeader>

        <Select value={value} onValueChange={setValue}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione o grupo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem grupo</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
                {g.company_db ? ` · ${g.company_db}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
