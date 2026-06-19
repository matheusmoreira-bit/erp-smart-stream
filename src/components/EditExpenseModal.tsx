import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Expense, ExpenseItem } from "@/hooks/useExpenses";
import { RelationsMap } from "@/components/RelationsMap";

function formatCurrency(value: number, currency: string = "BRL") {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
}

interface Props {
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: {
    supplier_name?: string;
    remarks?: string | null;
    items?: Omit<ExpenseItem, "id">[];
  }) => Promise<void>;
  mode?: "purchase" | "sales";
}

export function EditExpenseModal({ expense, open, onClose, onSave, mode = "purchase" }: Props) {
  const isSales = mode === "sales";
  const bpLabel = isSales ? "Cliente" : "Fornecedor";
  const [supplierName, setSupplierName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState<Omit<ExpenseItem, "id">[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showRelationsMap, setShowRelationsMap] = useState(false);

  useEffect(() => {
    if (open && expense) {
      setSupplierName(expense.supplier_name || "");
      setRemarks(expense.remarks || "");
      setItems(
        (expense.items || []).map((it) => ({
          item_code: it.item_code,
          description: it.description,
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          line_total: Number(it.line_total) || 0,
          cost_center: it.cost_center,
          project: it.project,
        }))
      );
    }
  }, [open, expense]);

  if (!expense) return null;

  const updateItem = (i: number, field: keyof ExpenseItem, value: string | number) => {
    setItems((prev) => {
      const next = [...prev];
      (next[i] as any)[field] = value;
      if (field === "quantity" || field === "unit_price") {
        next[i].line_total = Number(next[i].quantity) * Number(next[i].unit_price);
      }
      return next;
    });
  };

  const addItem = () =>
    setItems((p) => [
      ...p,
      { description: "", quantity: 1, unit_price: 0, line_total: 0, cost_center: "", project: "" },
    ]);

  const removeItem = (i: number) => {
    if (items.length <= 1) return;
    setItems((p) => p.filter((_, idx) => idx !== i));
  };

  const total = items.reduce((s, i) => s + i.line_total, 0);

  const handleSave = async () => {
    if (!supplierName.trim()) {
      toast.error(`Informe o ${bpLabel.toLowerCase()}`);
      return;
    }
    if (items.some((i) => !i.description.trim())) {
      toast.error("Todos os itens devem ter descrição");
      return;
    }
    for (let idx = 0; idx < items.length; idx++) {
      const it: any = items[idx];
      const n = idx + 1;
      if (!it.item_code || !String(it.item_code).trim()) {
        toast.error(`Item ${n}: código do item é obrigatório`);
        return;
      }
      if (!Number(it.quantity) || Number(it.quantity) <= 0) {
        toast.error(`Item ${n}: quantidade deve ser maior que zero`);
        return;
      }
      if (!Number(it.unit_price) || Number(it.unit_price) <= 0) {
        toast.error(`Item ${n}: valor unitário deve ser maior que zero`);
        return;
      }
      if (!it.cost_center || !String(it.cost_center).trim()) {
        toast.error(`Item ${n}: centro de custo é obrigatório`);
        return;
      }
    }
    setIsSaving(true);
    try {
      await onSave({
        supplier_name: supplierName.trim(),
        remarks: remarks || null,
        items,
      });
      toast.success("Pedido atualizado com sucesso!");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span>Editar {isSales ? "Pedido de Venda" : "Pedido de Compra"}</span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7"
              onClick={() => setShowRelationsMap(true)}
            >
              <Network className="w-3.5 h-3.5" /> Mapa de relações
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{bpLabel} *</label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="h-9 text-sm" />
            {expense.supplier_code && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">Código: {expense.supplier_code}</p>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Itens</p>
              <Button variant="ghost" size="sm" onClick={addItem} className="gap-1 text-xs h-7">
                <Plus className="w-3 h-3" /> Adicionar Item
              </Button>
            </div>
            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={i} className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Item {i + 1}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(i)} disabled={items.length <= 1} className="h-6 w-6 text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground">
                        Código SAP <span className="opacity-60">(opcional)</span>
                      </label>
                      <Input
                        value={item.item_code || ""}
                        onChange={(e) => updateItem(i, "item_code", e.target.value)}
                        placeholder="Ex.: 10001"
                        className="text-sm h-8 font-mono"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground">Descrição *</label>
                      <Input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} className="text-sm h-8" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Qtd</label>
                      <Input type="number" value={item.quantity} onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)} className="text-sm h-8" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Preço Unit.</label>
                      <Input type="number" value={item.unit_price} onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)} className="text-sm h-8" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Total</label>
                      <Input value={formatCurrency(item.line_total, expense.currency)} readOnly className="text-sm h-8 bg-muted/30 font-mono" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Deixe o Código SAP em branco para enviar como linha de serviço (sem item).
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Centro de Custo</label>
                      <Input value={item.cost_center || ""} onChange={(e) => updateItem(i, "cost_center", e.target.value)} className="text-sm h-8" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Projeto</label>
                      <Input value={item.project || ""} onChange={(e) => updateItem(i, "project", e.target.value)} className="text-sm h-8" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <p className="text-sm font-medium text-foreground">
                Total: <span className="text-lg font-bold font-mono">{formatCurrency(total, expense.currency)}</span>
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-4 flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </div>
        </div>
      </DialogContent>
      <RelationsMap
        open={showRelationsMap}
        onClose={() => setShowRelationsMap(false)}
        expense={expense as any}
        title={isSales ? "Mapa de Relações — Pedido de Venda" : "Mapa de Relações — Pedido de Compra"}
      />
    </Dialog>
  );
}
