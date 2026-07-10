import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SapSearchCombobox, type SapSearchOption } from "@/components/SapSearchCombobox";
import { useCompanies } from "@/hooks/useCompanies";
import { useSap } from "@/contexts/SapContext";
import { useAdvancePayments, type CreateAdvanceInput, type AdvanceItem } from "@/hooks/useAdvancePayments";
import { Loader2, Paperclip, X, Building2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  validateAttachments,
  ALLOWED_ATTACHMENT_ACCEPT,
  ALLOWED_ATTACHMENT_HINT,
} from "@/lib/attachment-validation";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CURRENCIES = ["BRL", "USD", "EUR", "ARS", "GBP"];

interface SupplierOpt extends SapSearchOption {
  details?: { fantasyName?: string; taxId?: string; currency?: string };
}

interface LineRow {
  itemSap?: SapSearchOption | null;
  item_code?: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  costCenterSap?: SapSearchOption | null;
  projectSap?: SapSearchOption | null;
}

function newLine(): LineRow {
  return { description: "", quantity: 1, unit_price: 0, line_total: 0 };
}

export function CreateAdvanceModal({ open, onClose }: Props) {
  const { session } = useSap();
  const { companies } = useCompanies(true);
  const { create } = useAdvancePayments();

  const companyDb = session?.companyDB || "";
  const company = useMemo(
    () => companies.find((c) => c.company_db === companyDb),
    [companies, companyDb],
  );
  const defaultCurrency = company?.default_currency || "BRL";

  const [supplier, setSupplier] = useState<SupplierOpt | null>(null);
  const [currency, setCurrency] = useState<string>(defaultCurrency);
  const [dueDate, setDueDate] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const supplierCurrency = supplier?.details?.currency || "";
  const currencyLocked = !!supplierCurrency && supplierCurrency !== "##";

  useEffect(() => {
    if (currencyLocked) setCurrency(supplierCurrency);
    else if (!supplier) setCurrency(defaultCurrency);
  }, [supplier, supplierCurrency, currencyLocked, defaultCurrency]);

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0),
    [lines],
  );

  const reset = () => {
    setSupplier(null);
    setCurrency(defaultCurrency);
    setDueDate("");
    setRemarks("");
    setLines([newLine()]);
    setFiles([]);
  };

  const updateLine = (idx: number, patch: Partial<LineRow>) => {
    setLines((prev) => {
      const next = [...prev];
      const merged = { ...next[idx], ...patch };
      // recompute line_total when qty or unit_price changes
      if ("quantity" in patch || "unit_price" in patch) {
        merged.line_total = Number((Number(merged.quantity) * Number(merged.unit_price)).toFixed(2));
      }
      next[idx] = merged;
      return next;
    });
  };

  const handleSubmit = async (submit: boolean) => {
    if (!supplier) return toast.error("Selecione um fornecedor");
    if (!companyDb) return toast.error("Sessão sem empresa selecionada");
    if (!lines.length) return toast.error("Adicione ao menos um item");

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.description?.trim() && !l.itemSap?.code)
        return toast.error(`Linha ${i + 1}: informe descrição ou selecione um item`);
      if (!Number(l.quantity) || Number(l.quantity) <= 0)
        return toast.error(`Linha ${i + 1}: quantidade inválida`);
      if (!Number(l.unit_price) || Number(l.unit_price) <= 0)
        return toast.error(`Linha ${i + 1}: valor unitário inválido`);
      if (submit && !l.costCenterSap?.code)
        return toast.error(`Linha ${i + 1}: selecione o centro de custo`);
    }

    setSaving(true);
    try {
      const items: AdvanceItem[] = lines.map((l) => ({
        item_code: l.itemSap?.code || l.item_code || null,
        description: l.itemSap?.name || l.description,
        quantity: Number(l.quantity) || 1,
        unit_price: Number(l.unit_price) || 0,
        line_total: Number(l.line_total) || 0,
        cost_center: l.costCenterSap?.code || null,
        cost_center_name: l.costCenterSap?.name || null,
        project: l.projectSap?.code || null,
        project_name: l.projectSap?.name || null,
      }));

      const input: CreateAdvanceInput = {
        company_db: companyDb,
        supplier_card_code: supplier.code,
        supplier_name: supplier.name,
        supplier_cnpj: supplier.details?.taxId || supplier.extra,
        currency,
        due_date: dueDate || undefined,
        remarks: remarks || undefined,
        items,
        files,
        submit,
      };
      await create(input);
      toast.success(submit ? "Adiantamento enviado para aprovação" : "Rascunho salvo");
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar adiantamento");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Adiantamento a Fornecedor</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border text-sm">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Empresa:</span>
            <span className="font-medium text-foreground">
              {company?.display_name || companyDb || "—"}
            </span>
          </div>

          <div className="space-y-2">
            <Label>Fornecedor</Label>
            <SapSearchCombobox
              endpoint="BusinessPartners"
              filterTemplate="CardType eq 'cSupplier' and Frozen ne 'tYES' and (contains(CardName,'{q}') or contains(CardCode,'{q}') or contains(FederalTaxID,'{q}'))"
              selectFields="CardCode,CardName,FederalTaxID,Currency"
              topResults={50}
              mapRow={(r) => ({
                code: r.CardCode,
                name: r.CardName,
                extra: r.FederalTaxID || "",
                details: {
                  taxId: r.FederalTaxID || "",
                  currency: r.Currency || "",
                },
              })}
              value={supplier}
              onChange={(v) => setSupplier(v as SupplierOpt | null)}
              placeholder="Buscar fornecedor por nome, código ou CNPJ"
            />
            {supplier && (
              <p className="text-xs text-muted-foreground">
                {supplier.code} · {supplier.name}
                {supplier.details?.taxId && ` · CNPJ ${supplier.details.taxId}`}
                {supplierCurrency && ` · Moeda ${supplierCurrency === "##" ? "Todas" : supplierCurrency}`}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>
                Moeda
                {currencyLocked && (
                  <span className="ml-1 text-[10px] text-muted-foreground">(do fornecedor)</span>
                )}
              </Label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={currencyLocked}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {(currencyLocked ? [supplierCurrency] : CURRENCIES).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Data prevista</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Items grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Itens</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((p) => [...p, newLine()])}
              >
                <Plus className="w-4 h-4 mr-1" /> Adicionar linha
              </Button>
            </div>

            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="rounded-md border border-border p-3 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Linha {i + 1}</span>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Item / Descrição</Label>
                    <SapSearchCombobox
                      endpoint="Items"
                      filterTemplate="Valid eq 'tYES' and Frozen eq 'tNO' and (contains(ItemCode,'{q}') or contains(ItemName,'{q}'))"
                      selectFields="ItemCode,ItemName"
                      topResults={50}
                      mapRow={(r) => ({ code: r.ItemCode, name: r.ItemName })}
                      value={l.itemSap || null}
                      onChange={(v) =>
                        updateLine(i, {
                          itemSap: v,
                          item_code: v?.code || "",
                          description: v?.name || l.description,
                        })
                      }
                      placeholder="Buscar item (opcional — deixe em branco para linha de serviço)"
                    />
                    {!l.itemSap && (
                      <Input
                        placeholder="Descrição (para linha de serviço)"
                        value={l.description}
                        onChange={(e) => updateLine(i, { description: e.target.value })}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Quantidade</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.quantity}
                        onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Valor unitário</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.unit_price}
                        onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Total</Label>
                      <Input readOnly value={l.line_total.toFixed(2)} className="bg-muted/60" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Centro de custo</Label>
                      <SapSearchCombobox
                        endpoint="ProfitCenters"
                        filterTemplate="Active eq 'tYES' and (contains(CenterCode,'{q}') or contains(CenterName,'{q}'))"
                        selectFields="CenterCode,CenterName"
                        topResults={50}
                        mapRow={(r) => ({ code: r.CenterCode, name: r.CenterName })}
                        value={l.costCenterSap || null}
                        onChange={(v) => updateLine(i, { costCenterSap: v })}
                        placeholder="Buscar centro de custo"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Projeto</Label>
                      <SapSearchCombobox
                        endpoint="Projects"
                        filterTemplate="Active eq 'tYES' and (contains(Code,'{q}') or contains(Name,'{q}'))"
                        selectFields="Code,Name"
                        topResults={50}
                        mapRow={(r) => ({ code: r.Code, name: r.Name })}
                        value={l.projectSap || null}
                        onChange={(v) => updateLine(i, { projectSap: v })}
                        placeholder="Buscar projeto (opcional)"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end items-center gap-3 pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">Total do adiantamento:</span>
              <span className="text-lg font-semibold">
                {currency} {total.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observação / justificativa</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Justificativa do adiantamento"
            />
          </div>

          <div className="space-y-2">
            <Label>Anexos (comprovantes)</Label>
            <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-md border border-dashed border-border hover:border-primary/50 text-sm">
              <Paperclip className="w-4 h-4" />
              <span>Selecionar arquivos</span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </label>
            {files.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span>{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={() => handleSubmit(false)} disabled={saving}>
            Salvar Rascunho
          </Button>
          <Button onClick={() => handleSubmit(true)} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Enviar para Aprovação
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
