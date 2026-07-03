import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { supabase } from "@/integrations/supabase/client";
import type { NfEntradaImport } from "@/hooks/useNfEntrada";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(
    value || 0,
  );
}

interface ItemLine {
  sapItem: SapSearchOption | null;
  item_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sapCostCenter: SapSearchOption | null;
  cost_center: string;
  sapProject: SapSearchOption | null;
  project: string;
}

function emptyItem(): ItemLine {
  return {
    sapItem: null,
    item_code: "",
    description: "",
    quantity: 1,
    unit_price: 0,
    line_total: 0,
    sapCostCenter: null,
    cost_center: "",
    sapProject: null,
    project: "",
  };
}

interface Props {
  item: NfEntradaImport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditNfEntradaDialog({ item, open, onOpenChange, onSaved }: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLDivElement | null>(null);

  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [currency, setCurrency] = useState("BRL");
  const [numero, setNumero] = useState("");
  const [serie, setSerie] = useState("");
  const [docDate, setDocDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [headerCostCenter, setHeaderCostCenter] = useState<SapSearchOption | null>(null);
  const [headerProject, setHeaderProject] = useState<SapSearchOption | null>(null);
  const [items, setItems] = useState<ItemLine[]>([emptyItem()]);
  const [isSaving, setIsSaving] = useState(false);

  // Cached SAP lists — same as CreateExpenseModal
  const supplierMapRow = useCallback(
    (row: any) =>
      ({
        code: row.CardCode,
        name: row.CardName,
        extra: row.FederalTaxID || undefined,
        details: { fantasyName: row.AliasName || undefined, taxId: row.FederalTaxID || undefined },
      }) as SapSearchOption,
    [],
  );
  const { options: supplierOptions, isLoading: suppliersLoading } = useSapCachedList({
    cacheKey: "suppliers_active_v2",
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,FederalTaxID,Currency",
      $filter: "CardType eq 'cSupplier' and Frozen eq 'tNO'",
    },
    mapRow: supplierMapRow,
  });

  const itemMapRow = useCallback(
    (row: any) => ({ code: row.ItemCode, name: row.ItemName }) as SapSearchOption,
    [],
  );
  const { options: itemOptions, isLoading: itemsLoading } = useSapCachedList({
    cacheKey: "items_purchase_active_v3",
    endpoint: "Items",
    params: {
      $filter: "Valid eq 'tYES' and Frozen eq 'tNO'",
      $select: "ItemCode,ItemName",
    },
    mapRow: itemMapRow,
  });

  const costCenterMapRow = useCallback(
    (row: any) => ({ code: row.CenterCode, name: row.CenterName }) as SapSearchOption,
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

  const projectMapRow = useCallback(
    (row: any) => ({ code: row.Code, name: row.Name }) as SapSearchOption,
    [],
  );
  const { options: projectOptions, isLoading: projectsLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: projectMapRow,
  });

  // Hydrate on open
  useEffect(() => {
    if (!open || !item) return;
    setNumero(item.numero_nf || "");
    setSerie(item.serie || "");
    setDocDate(item.data_emissao ? item.data_emissao.slice(0, 10) : "");
    setDueDate(item.data_emissao ? item.data_emissao.slice(0, 10) : "");
    setRemarks("");
    setHeaderCostCenter(null);
    setHeaderProject(null);
    setCurrency("BRL");

    if (item.sap_matched_card_code) {
      const existing = supplierOptions.find((o) => o.code === item.sap_matched_card_code);
      setSupplier(
        existing || {
          code: item.sap_matched_card_code,
          name: item.nome_fornecedor || item.sap_matched_card_code,
          extra: item.cnpj_fornecedor || undefined,
        },
      );
    } else if (item.nome_fornecedor || item.cnpj_fornecedor) {
      setSupplier({
        code: "",
        name: item.nome_fornecedor || "",
        extra: item.cnpj_fornecedor || undefined,
      });
    } else {
      setSupplier(null);
    }

    const valor = Number(item.valor_total) || 0;
    setItems([
      {
        ...emptyItem(),
        description: `NF ${item.numero_nf || "—"}/${item.serie || "—"}`,
        quantity: 1,
        unit_price: valor,
        line_total: valor,
      },
    ]);
  }, [open, item, supplierOptions]);

  const suggestedSupplier = useMemo(() => item?.nome_fornecedor || "", [item]);

  const applyHeaderCostCenter = (val: SapSearchOption | null) => {
    setHeaderCostCenter(val);
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        sapCostCenter: val,
        cost_center: val?.code || "",
      })),
    );
  };

  const applyHeaderProject = (val: SapSearchOption | null) => {
    setHeaderProject(val);
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        sapProject: val,
        project: val?.code || "",
      })),
    );
  };

  const updateItem = <K extends keyof ItemLine>(idx: number, key: K, value: ItemLine[K]) => {
    setItems((prev) => {
      const updated = [...prev];
      const line = { ...updated[idx], [key]: value } as ItemLine;
      if (key === "quantity" || key === "unit_price") {
        line.line_total = (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
      }
      updated[idx] = line;
      return updated;
    });
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  const total = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);

  const handleSave = async () => {
    if (!item) return;
    if (!supplier || !supplier.name.trim()) {
      toast.error("Informe o fornecedor");
      return;
    }
    if (!docDate) {
      toast.error("Informe a data do documento");
      return;
    }
    setIsSaving(true);
    try {
      const patch = {
        numero_nf: numero || null,
        serie: serie || null,
        data_emissao: docDate,
        valor_total: total || null,
        nome_fornecedor: supplier.name || null,
        ...(supplier.extra
          ? { cnpj_fornecedor: supplier.extra.replace(/\D/g, "") || null }
          : {}),
        ...(supplier.code ? { sap_matched_card_code: supplier.code } : {}),
      };
      const { error } = await supabase
        .from("nf_entrada_imports")
        .update(patch)
        .eq("id", item.id);
      if (error) throw error;

      await supabase.from("nf_entrada_logs").insert({
        import_id: item.id,
        step: "manual_edit",
        message: `Edição manual: NF ${numero}/${serie || "-"}, data ${docDate}, valor ${formatCurrency(total, currency)}, fornecedor ${supplier.name}`,
        actor: "manual:user",
        payload: JSON.parse(
          JSON.stringify({
            ...patch,
            due_date: dueDate || null,
            remarks: remarks || null,
            header_cost_center: headerCostCenter?.code || null,
            header_project: headerProject?.code || null,
            items: items.map(({ sapItem, sapCostCenter, sapProject, ...rest }) => rest),
          }),
        ),
      });

      toast.success("NF atualizada com sucesso!");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
    } finally {
      setIsSaving(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        ref={(node) => {
          contentRef.current = node;
          setDialogContainer(node);
        }}
      >
        <DialogHeader>
          <DialogTitle>Editar NF de Entrada</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Supplier */}
          <div>
            <CachedSearchCombobox
              label="Fornecedor *"
              options={supplierOptions}
              isLoading={suppliersLoading}
              value={supplier}
              onChange={setSupplier}
              placeholder="Digite nome, código ou CNPJ do fornecedor..."
              suggestedQuery={suggestedSupplier}
              portalContainer={dialogContainer}
            />
            {supplier?.code && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Código: {supplier.code}
              </p>
            )}
          </div>

          {/* NF number + series + doc date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Número NF *</label>
              <Input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Série</label>
              <Input
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Moeda</label>
              <Input
                value={currency}
                readOnly
                className="text-sm h-9 bg-muted/30 font-medium"
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Data do Documento *
              </label>
              <Input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="text-sm h-9"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Data de Vencimento
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="text-sm h-9"
              />
            </div>
          </div>

          {/* Remarks */}
          <div>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Descrição / observações..."
              rows={2}
            />
          </div>

          {/* Header defaults */}
          <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed border-border bg-muted/20 p-3">
            <CachedSearchCombobox
              label="Centro de Custo (padrão p/ itens)"
              options={costCenterOptions}
              isLoading={costCentersLoading}
              value={headerCostCenter}
              onChange={applyHeaderCostCenter}
              placeholder="Aplica a todos os itens…"
              portalContainer={dialogContainer}
            />
            <CachedSearchCombobox
              label="Projeto (padrão p/ itens)"
              options={projectOptions}
              isLoading={projectsLoading}
              value={headerProject}
              onChange={applyHeaderProject}
              placeholder="Aplica a todos os itens…"
              portalContainer={dialogContainer}
            />
            <p className="col-span-2 text-[11px] text-muted-foreground">
              Definir aqui preenche todas as linhas. Você pode ajustar item a item abaixo.
            </p>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Itens
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={addItem}
                className="gap-1 text-xs h-7"
              >
                <Plus className="w-3 h-3" /> Adicionar Item
              </Button>
            </div>
            <div className="space-y-3">
              {items.map((line, i) => (
                <div
                  key={i}
                  className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">
                      Item {i + 1}
                    </span>
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
                  <CachedSearchCombobox
                    options={itemOptions}
                    isLoading={itemsLoading}
                    value={line.sapItem}
                    onChange={(val) => {
                      setItems((prev) => {
                        const updated = [...prev];
                        const currentDesc = (updated[i].description || "").trim();
                        updated[i] = {
                          ...updated[i],
                          sapItem: val,
                          item_code: val?.code || "",
                          description: currentDesc ? currentDesc : val?.name || "",
                        };
                        return updated;
                      });
                    }}
                    placeholder="Buscar item SAP por nome ou código..."
                    suggestedQuery={!line.sapItem ? line.description || undefined : undefined}
                    portalContainer={dialogContainer}
                  />
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-6">
                      <label className="text-[10px] text-muted-foreground">Descrição *</label>
                      <Input
                        value={line.description}
                        onChange={(e) => updateItem(i, "description", e.target.value)}
                        placeholder="Descrição do item"
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Qtd</label>
                      <Input
                        type="number"
                        value={line.quantity}
                        onChange={(e) =>
                          updateItem(i, "quantity", parseFloat(e.target.value) || 0)
                        }
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Preço Unit.</label>
                      <Input
                        type="number"
                        value={line.unit_price}
                        onChange={(e) =>
                          updateItem(i, "unit_price", parseFloat(e.target.value) || 0)
                        }
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Total</label>
                      <Input
                        value={formatCurrency(line.line_total, currency)}
                        readOnly
                        className="text-sm h-8 bg-muted/30 font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <CachedSearchCombobox
                      label="Centro de Custo (Dimensão)"
                      options={costCenterOptions}
                      isLoading={costCentersLoading}
                      value={line.sapCostCenter}
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
                      placeholder="Buscar centro de custo..."
                      portalContainer={dialogContainer}
                    />
                    <CachedSearchCombobox
                      label="Projeto (Dimensão)"
                      options={projectOptions}
                      isLoading={projectsLoading}
                      value={line.sapProject}
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
                      placeholder="Buscar projeto..."
                      portalContainer={dialogContainer}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <p className="text-sm font-medium text-foreground">
                Total:{" "}
                <span className="text-lg font-bold font-mono">
                  {formatCurrency(total, currency)}
                </span>
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-4 flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
