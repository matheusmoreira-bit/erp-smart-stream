import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SapSearchCombobox, type SapSearchOption } from "@/components/SapSearchCombobox";
import { useCompanies } from "@/hooks/useCompanies";
import { useSap } from "@/contexts/SapContext";
import { useAdvancePayments, type CreateAdvanceInput } from "@/hooks/useAdvancePayments";
import { Loader2, Paperclip, X, Building2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CURRENCIES = ["BRL", "USD", "EUR", "ARS", "GBP"];

interface SupplierOpt extends SapSearchOption {
  details?: { fantasyName?: string; taxId?: string; currency?: string };
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
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>(defaultCurrency);
  const [dueDate, setDueDate] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");
  const [costCenter, setCostCenter] = useState<SapSearchOption | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // Quando o fornecedor é selecionado, força a moeda conforme cadastro do BP.
  // SAP B1: Currency = "##" significa "todas" — aí mantém o default da empresa.
  const supplierCurrency = supplier?.details?.currency || "";
  const currencyLocked = !!supplierCurrency && supplierCurrency !== "##";

  useEffect(() => {
    if (currencyLocked) {
      setCurrency(supplierCurrency);
    } else if (!supplier) {
      setCurrency(defaultCurrency);
    }
  }, [supplier, supplierCurrency, currencyLocked, defaultCurrency]);

  const reset = () => {
    setSupplier(null);
    setAmount("");
    setCurrency(defaultCurrency);
    setDueDate("");
    setRemarks("");
    setCostCenter(null);
    setFiles([]);
  };

  const handleSubmit = async (submit: boolean) => {
    if (!supplier) return toast.error("Selecione um fornecedor");
    if (!companyDb) return toast.error("Sessão sem empresa selecionada");
    const amt = Number(amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Informe um valor válido");
    if (submit && !costCenter?.code) return toast.error("Selecione o centro de custo");

    setSaving(true);
    try {
      const input: CreateAdvanceInput = {
        company_db: companyDb,
        supplier_card_code: supplier.code,
        supplier_name: supplier.name,
        supplier_cnpj: supplier.details?.taxId || supplier.extra,
        amount: amt,
        currency,
        due_date: dueDate || undefined,
        remarks: remarks || undefined,
        cost_center: costCenter?.code || undefined,
        cost_center_name: costCenter?.name || undefined,
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
      <DialogContent className="max-w-2xl">
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
            <div className="space-y-2 col-span-2">
              <Label>Valor</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
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
          </div>

          <div className="space-y-2">
            <Label>Data prevista</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
