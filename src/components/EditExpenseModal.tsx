import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Network, CheckCircle2, AlertTriangle } from "lucide-react";
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
import { type RateioType, RATEIO_TYPE_LABELS } from "@/hooks/useExpenses";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RelationsMap } from "@/components/RelationsMap";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { useSap } from "@/contexts/SapContext";

function formatCurrency(value: number, currency: string = "BRL") {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
}

// Estilos para campos válidos/obrigatórios — mesmo padrão do CreateExpenseModal.
const validClass = "bg-green-500/5 border-green-500/50";
const requiredClass = "bg-amber-500/5 border-amber-500/50";
function fieldClass(filled: boolean) {
  return filled ? validClass : requiredClass;
}

function findSapOption(options: SapSearchOption[], value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  return (
    options.find((o) => (o.code || "").trim().toLowerCase() === normalized) ||
    options.find((o) => (o.name || "").trim().toLowerCase() === normalized) ||
    null
  );
}

function normalizeSapTextValue(value: string) {
  return value.trim().replace(/\s+—\s+.*$/, "");
}

function ValidLabel({
  children,
  filled,
  required = true,
}: {
  children: React.ReactNode;
  filled: boolean;
  required?: boolean;
}) {
  return (
    <label className="text-[10px] text-muted-foreground flex items-center gap-1">
      <span>{children}</span>
      {filled ? (
        <CheckCircle2 className="w-3 h-3 text-green-500" aria-label="Preenchido" />
      ) : required ? (
        <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" aria-label="Obrigatório" />
      ) : null}
    </label>
  );
}

interface EditItem extends Omit<ExpenseItem, "id"> {
  sapItem?: SapSearchOption | null;
  sapCostCenter?: SapSearchOption | null;
  sapProject?: SapSearchOption | null;
}

interface Props {
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: {
    supplier_name?: string;
    supplier_code?: string | null;
    remarks?: string | null;
    doc_date?: string | null;
    due_date?: string | null;
    rateio_type?: RateioType | null;
    items?: Omit<ExpenseItem, "id">[];
  }) => Promise<void>;
  mode?: "purchase" | "sales";
}

export function EditExpenseModal({ expense, open, onClose, onSave, mode = "purchase" }: Props) {
  const isSales = mode === "sales";
  const bpLabel = isSales ? "Cliente" : "Fornecedor";
  const { session: sapSession } = useSap();
  const isOpenGaming = sapSession?.companyDB === "open_gaming_sa";

  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [docDate, setDocDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [rateioType, setRateioType] = useState<RateioType>("padrao");
  const initialRateioTypeRef = useRef<RateioType>("padrao");
  const [isSaving, setIsSaving] = useState(false);
  const [showRelationsMap, setShowRelationsMap] = useState(false);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setDialogContainer(dialogContentRef.current);
  }, [open]);

  // === SAP cached lists (mesma origem do formulário de criação) ===
  const supplierMapRow = useCallback(
    (row: any) =>
      ({
        code: row.CardCode,
        name: row.CardName,
        extra: row.FederalTaxID || undefined,
        details: {
          fantasyName: row.AliasName || undefined,
          taxId: row.FederalTaxID || undefined,
        },
      }) as SapSearchOption,
    [],
  );
  const { options: supplierOptions, isLoading: suppliersLoading } = useSapCachedList({
    cacheKey: isSales ? "customers_active_v2" : "suppliers_active_v2",
    endpoint: "BusinessPartners",
    params: isSales
      ? { $select: "CardCode,CardName,AliasName,FederalTaxID,Currency", $filter: "CardType eq 'cCustomer' and Frozen eq 'tNO'" }
      : { $select: "CardCode,CardName,AliasName,FederalTaxID,Currency", $filter: "CardType eq 'cSupplier' and Frozen eq 'tNO'" },
    mapRow: supplierMapRow,
  });

  const itemMapRow = useCallback((row: any) => ({ code: row.ItemCode, name: row.ItemName }), []);
  const { options: itemOptions, isLoading: itemsLoading } = useSapCachedList({
    cacheKey: isSales ? "items_sales_active_v3" : "items_purchase_active_v3",
    endpoint: "Items",
    params: { $filter: "Valid eq 'tYES' and Frozen eq 'tNO'", $select: "ItemCode,ItemName" },
    mapRow: itemMapRow,
  });

  const costCenterMapRow = useCallback(
    (row: any) => ({ code: row.CenterCode, name: row.CenterName }),
    [],
  );
  const { options: rawCostCenterOptions, isLoading: costCentersLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: costCenterMapRow,
  });
  const costCenterOptions = useMemo(
    () => rawCostCenterOptions.filter((o) => !o.name?.toLowerCase().startsWith("centro geral")),
    [rawCostCenterOptions],
  );

  const projectMapRow = useCallback((row: any) => ({ code: row.Code, name: row.Name }), []);
  const { options: projectOptions, isLoading: projectsLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: projectMapRow,
  });

  // Popula estado inicial ao abrir / trocar despesa
  useEffect(() => {
    if (open && expense) {
      setSupplierName(expense.supplier_name || "");
      setRemarks(expense.remarks || "");
      setDocDate(expense.doc_date ? expense.doc_date.slice(0, 10) : "");
      setDueDate(expense.due_date ? expense.due_date.slice(0, 10) : "");
      setItems(
        (expense.items || []).map((it) => ({
          item_code: it.item_code,
          description: it.description,
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          line_total: Number(it.line_total) || 0,
          cost_center: it.cost_center,
          project: it.project,
          sapItem: findSapOption(itemOptions, it.item_code),
          sapCostCenter: findSapOption(costCenterOptions, it.cost_center),
          sapProject: findSapOption(projectOptions, it.project),
        })),
      );
      const rt = (expense.rateio_type as RateioType | null) || "padrao";
      const validRt: RateioType = (["padrao","folha","imposto","reembolso","viagens"] as RateioType[]).includes(rt) ? rt : "padrao";
      setRateioType(validRt);
      initialRateioTypeRef.current = validRt;
      setSupplier(null);
    }
  }, [open, expense]);

  // Resolve o fornecedor no cache quando as opções carregarem
  useEffect(() => {
    if (!expense || supplier) return;
    if (supplierOptions.length === 0) return;
    const code = (expense.supplier_code || "").trim();
    const found =
      (code && supplierOptions.find((o) => o.code === code)) ||
      supplierOptions.find(
        (o) => o.name.toLowerCase() === (expense.supplier_name || "").toLowerCase(),
      );
    if (found) {
      setSupplier(found);
      setSupplierName(found.name);
    }
  }, [expense, supplier, supplierOptions]);

  // Resolve item/centro/projeto por linha quando as opções carregarem
  useEffect(() => {
    if (!open) return;
    setItems((prev) => {
      let changed = false;
      const resolved = prev.map((it) => {
        let next = it;
        const sapItem = !it.sapItem ? findSapOption(itemOptions, it.item_code) : null;
        const sapCostCenter = !it.sapCostCenter ? findSapOption(costCenterOptions, it.cost_center) : null;
        const sapProject = !it.sapProject ? findSapOption(projectOptions, it.project) : null;

        if (sapItem || sapCostCenter || sapProject) {
          next = {
            ...it,
            ...(sapItem ? { sapItem } : {}),
            ...(sapCostCenter ? { sapCostCenter } : {}),
            ...(sapProject ? { sapProject } : {}),
          };
          changed = true;
        }
        return next;
      });
      return changed ? resolved : prev;
    });
  }, [open, expense?.id, itemOptions, costCenterOptions, projectOptions]);

  if (!expense) return null;

  const updateItem = (i: number, field: keyof EditItem, value: string | number) => {
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
      {
        description: "",
        quantity: 1,
        unit_price: 0,
        line_total: 0,
        cost_center: "",
        project: "",
        sapItem: null,
        sapCostCenter: null,
        sapProject: null,
      },
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
    if (!docDate) {
      toast.error("Informe a data do documento");
      return;
    }
    if (!dueDate) {
      toast.error("Informe a data de vencimento");
      return;
    }
    if (items.some((i) => !i.description.trim())) {
      toast.error("Todos os itens devem ter descrição");
      return;
    }
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const n = idx + 1;
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
      if (isOpenGaming && (!it.project || !String(it.project).trim())) {
        toast.error(`Item ${n}: projeto é obrigatório para Open Gaming`);
        return;
      }
    }
    setIsSaving(true);
    try {
      await onSave({
        supplier_name: supplierName.trim(),
        supplier_code: supplier?.code || null,
        remarks: remarks || null,
        doc_date: docDate || null,
        due_date: dueDate || null,
        rateio_type: !isSales ? rateioType : undefined,
        items: items.map((it) => ({
          item_code: it.item_code,
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          line_total: it.line_total,
          cost_center: it.cost_center,
          project: it.project,
        })),
      });
      const rateioChanged = !isSales && rateioType !== initialRateioTypeRef.current;
      if (rateioChanged) {
        toast.success("Pedido atualizado e fluxo de aprovação reiniciado.");
      } else {
        toast.success("Pedido atualizado com sucesso!");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent ref={dialogContentRef} className="max-w-2xl max-h-[85vh] overflow-y-auto">
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
          {/* Fornecedor / Cliente com busca */}
          <div>
            <CachedSearchCombobox
              label={`${bpLabel} *`}
              options={supplierOptions}
              isLoading={suppliersLoading}
              value={supplier}
              onChange={(val) => {
                setSupplier(val);
                setSupplierName(val?.name || "");
              }}
              placeholder={`Digite nome, código ou CNPJ do ${bpLabel.toLowerCase()}...`}
              suggestedQuery={!supplier && supplierName ? supplierName : undefined}
              portalContainer={dialogContainer}
              required
            />
            {(supplier?.code || expense.supplier_code) && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Código: {supplier?.code || expense.supplier_code}
              </p>
            )}
          </div>

          {/* Datas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                <span>Data do Documento *</span>
                {docDate ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-label="Preenchido" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-label="Obrigatório" />
                )}
              </label>
              <Input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className={`text-sm h-9 ${fieldClass(!!docDate)}`}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                <span>Data de Vencimento *</span>
                {dueDate ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-label="Preenchido" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-label="Obrigatório" />
                )}
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={`text-sm h-9 ${fieldClass(!!dueDate)}`}
              />
            </div>
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
              {items.map((item, i) => {
                const descFilled = !!(item.description || "").trim();
                const qtyFilled = Number(item.quantity) > 0;
                const priceFilled = Number(item.unit_price) > 0;
                const ccFilled = !!(item.cost_center || "").trim();
                const projFilled = !!(item.project || "").trim();
                return (
                  <div key={i} className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/10">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase">Item {i + 1}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(i)}
                        disabled={items.length <= 1}
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* Busca item SAP */}
                    <CachedSearchCombobox
                      label="Item SAP (opcional)"
                      options={itemOptions}
                      isLoading={itemsLoading}
                      value={item.sapItem || null}
                      onChange={(val) => {
                        setItems((prev) => {
                          const updated = [...prev];
                          const currentDesc = (updated[i].description || "").trim();
                          const nextDesc = currentDesc ? currentDesc : (val?.name || "");
                          updated[i] = {
                            ...updated[i],
                            sapItem: val,
                            item_code: val?.code || "",
                            description: nextDesc,
                          };
                          return updated;
                        });
                      }}
                      placeholder="Buscar item SAP por nome ou código..."
                      suggestedQuery={!item.sapItem && item.item_code ? item.item_code : undefined}
                      portalContainer={dialogContainer}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Deixe o Código SAP em branco para enviar como linha de serviço (sem item).
                    </p>

                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-6">
                        <ValidLabel filled={descFilled}>Descrição *</ValidLabel>
                        <Input
                          value={item.description}
                          onChange={(e) => updateItem(i, "description", e.target.value)}
                          className={`text-sm h-8 ${fieldClass(descFilled)}`}
                        />
                      </div>
                      <div className="col-span-2">
                        <ValidLabel filled={qtyFilled}>Qtd</ValidLabel>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)}
                          className={`text-sm h-8 ${fieldClass(qtyFilled)}`}
                        />
                      </div>
                      <div className="col-span-2">
                        <ValidLabel filled={priceFilled}>Preço Unit.</ValidLabel>
                        <Input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)}
                          className={`text-sm h-8 ${fieldClass(priceFilled)}`}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] text-muted-foreground">Total</label>
                        <Input
                          value={formatCurrency(item.line_total, expense.currency)}
                          readOnly
                          className="text-sm h-8 bg-muted/30 font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <CachedSearchCombobox
                        label="Centro de Custo *"
                        options={costCenterOptions}
                        isLoading={costCentersLoading}
                        value={item.sapCostCenter || null}
                        onChange={(val) => {
                          setItems((prev) => {
                            const updated = [...prev];
                            updated[i] = {
                              ...updated[i],
                              sapCostCenter: val,
                              cost_center: val?.code || "",
                            };
                            return updated;
                          });
                        }}
                        onRawValueChange={(val) => {
                          setItems((prev) => {
                            const updated = [...prev];
                            updated[i] = {
                              ...updated[i],
                              sapCostCenter: null,
                              cost_center: normalizeSapTextValue(val),
                            };
                            return updated;
                          });
                        }}
                        placeholder="Buscar centro de custo..."
                        suggestedQuery={!item.sapCostCenter && item.cost_center ? item.cost_center : undefined}
                        portalContainer={dialogContainer}
                        required
                      />
                      <CachedSearchCombobox
                        label={isOpenGaming ? "Projeto *" : "Projeto"}
                        options={projectOptions}
                        isLoading={projectsLoading}
                        value={item.sapProject || null}
                        onChange={(val) => {
                          setItems((prev) => {
                            const updated = [...prev];
                            updated[i] = {
                              ...updated[i],
                              sapProject: val,
                              project: val?.code || "",
                            };
                            return updated;
                          });
                        }}
                        onRawValueChange={(val) => {
                          setItems((prev) => {
                            const updated = [...prev];
                            updated[i] = {
                              ...updated[i],
                              sapProject: null,
                              project: normalizeSapTextValue(val),
                            };
                            return updated;
                          });
                        }}
                        placeholder="Buscar projeto..."
                        suggestedQuery={!item.sapProject && item.project ? item.project : undefined}
                        portalContainer={dialogContainer}
                        required={isOpenGaming}
                      />
                    </div>
                  </div>
                );
              })}
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
