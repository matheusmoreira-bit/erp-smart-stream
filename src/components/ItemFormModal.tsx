import { useEffect, useState } from "react";
import { z } from "zod";
import { Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { parseSapError } from "@/lib/sap-error";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import {
  createItem,
  updateItem,
  fetchItemFromSap,
  type SapItem,
  type ItemInput,
} from "@/hooks/useItems";

const itemSchema = z.object({
  item_code: z.string().trim().min(1, "Código obrigatório").max(50),
  item_name: z.string().trim().min(1, "Nome obrigatório").max(200),
  items_group_code: z.number().int().nullable(),
  is_active: z.boolean(),
});

interface Props {
  open: boolean;
  editing: SapItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ItemFormModal({ open, editing, onClose, onSaved }: Props) {
  const { session } = useSap();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ItemInput>({
    item_code: "",
    item_name: "",
    items_group_code: null,
    is_active: true,
  });

  const { options: groupOptions, isLoading: groupsLoading } = useSapCachedList({
    cacheKey: "item_groups",
    endpoint: "ItemGroups",
    params: { $select: "Number,GroupName", $orderby: "GroupName" },
    mapRow: (r: any) => ({ code: String(r.Number), name: r.GroupName }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (!editing) {
      setForm({ item_code: "", item_name: "", items_group_code: null, is_active: true });
      return;
    }
    // Hydrate from SAP for latest data
    setForm({
      item_code: editing.item_code,
      item_name: editing.item_name,
      items_group_code: editing.items_group_code,
      is_active: editing.is_active,
    });
    if (session && editing.item_code) {
      setLoading(true);
      fetchItemFromSap(editing.item_code, session)
        .then((it) => {
          if (it) {
            setForm({
              item_code: it.item_code,
              item_name: it.item_name,
              items_group_code: it.items_group_code,
              is_active: it.is_active,
            });
          }
        })
        .finally(() => setLoading(false));
    }
  }, [open, editing, session]);

  const handleSave = async () => {
    if (!session) {
      toast.error("Sessão SAP necessária");
      return;
    }
    const parsed = itemSchema.safeParse(form);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message || "Dados inválidos");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateItem(editing.item_code, parsed.data, session);
        toast.success("Item atualizado no SAP");
      } else {
        await createItem(parsed.data, session);
        toast.success("Item criado no SAP");
      }
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar no SAP", { description: parseSapError(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Item" : "Novo Item"}</DialogTitle>
          <DialogDescription>
            {editing ? "Atualiza dados no SAP via Service Layer." : "Cria o item diretamente no SAP."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Código (ItemCode)</Label>
              <Input
                value={form.item_code}
                onChange={(e) => setForm((f) => ({ ...f, item_code: e.target.value }))}
                disabled={!!editing}
                placeholder="Ex: SRV001"
              />
            </div>
            <div className="grid gap-2">
              <Label>Nome (ItemName)</Label>
              <Input
                value={form.item_name}
                onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                placeholder="Descrição do item"
              />
            </div>
            <div className="grid gap-2">
              <Label>Grupo (ItemsGroupCode)</Label>
              <Select
                value={form.items_group_code != null ? String(form.items_group_code) : ""}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, items_group_code: v ? Number(v) : null }))
                }
                disabled={groupsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={groupsLoading ? "Carregando..." : "Selecionar grupo"} />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((g) => (
                    <SelectItem key={g.code} value={g.code}>
                      {g.name} — {g.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label>Ativo</Label>
                <p className="text-xs text-muted-foreground">Valid=tYES e Frozen=tNO</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
