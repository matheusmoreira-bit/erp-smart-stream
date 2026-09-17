// Integração de cartões corporativos para empresas Omie.
// Regra: no Omie, toda transação de cartão vira CONTA A PAGAR — nunca pedido
// de compra nem lançamento contábil. Em lote, gera uma conta a pagar por
// transação.

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  omieListarCategorias,
  omieListarClientesFornecedores,
  omieListarContasCorrentes,
} from "@/lib/omie-client";
import { pagcorpDisplayDescription } from "@/lib/pagcorp-accountability";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

export interface OmieApSubmitValues {
  supplierCode: string;
  supplierName: string;
  categoryCode: string;
  currentAccountCode: string;
  dueDate: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyDb: string;
  transactions: PagCorpTransaction[];
  submitting?: boolean;
  onConfirm: (values: OmieApSubmitValues) => Promise<void> | void;
}

interface Option {
  value: string;
  label: string;
  hint?: string;
}

function formatCurrency(value: number, currency = "BRL") {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value || 0);
  } catch {
    return `${currency} ${(value || 0).toFixed(2)}`;
  }
}

function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  loading,
  emptyLabel,
  id,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  loading?: boolean;
  emptyLabel: string;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={loading}
        >
          <span className="truncate text-left">
            {loading ? "Carregando…" : selected ? selected.label : placeholder}
          </span>
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar…" />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint || ""}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function PagCorpOmieIntegrateDialog({
  open,
  onOpenChange,
  companyDb,
  transactions,
  submitting = false,
  onConfirm,
}: Props) {
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [supplierCode, setSupplierCode] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [currentAccountCode, setCurrentAccountCode] = useState("");
  const [dueDate, setDueDate] = useState("");

  const total = useMemo(
    () => transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
    [transactions],
  );
  const currency = String(transactions[0]?.currency || "BRL").toUpperCase();

  useEffect(() => {
    if (!open) return;
    const firstDate = String(transactions[0]?.date || "").slice(0, 10);
    setDueDate(/^\d{4}-\d{2}-\d{2}$/.test(firstDate) ? firstDate : new Date().toISOString().slice(0, 10));
  }, [open, transactions]);

  useEffect(() => {
    if (!open || !companyDb) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      omieListarClientesFornecedores(companyDb),
      omieListarCategorias(companyDb, { type: "D" }),
      omieListarContasCorrentes(companyDb),
    ])
      .then(([supplierRows, categoryRows, accountRows]) => {
        if (cancelled) return;
        setSuppliers(
          supplierRows
            .filter((row) => String(row.inativo || "N").toUpperCase() !== "S")
            .map((row) => ({
              value: String(row.codigo_cliente_omie),
              label: String(row.razao_social || row.nome_fantasia || row.codigo_cliente_omie),
              hint: String(row.cnpj_cpf || ""),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
        );
        setCategories(
          categoryRows
            .map((row) => ({
              value: String(row.codigo),
              label: `${row.codigo} · ${row.descricao || row.descricao_padrao || ""}`.trim(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
        );
        setAccounts(
          accountRows
            .map((row) => ({
              value: String(row.nCodCC),
              label: String(row.descricao || row.nCodCC),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Falha ao carregar cadastros do Omie");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, companyDb]);

  const canSubmit = !!supplierCode && !!categoryCode && !!currentAccountCode && !!dueDate && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    await onConfirm({
      supplierCode,
      supplierName: suppliers.find((s) => s.value === supplierCode)?.label || "",
      categoryCode,
      currentAccountCode,
      dueDate,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lançar em Contas a Pagar (Omie)</DialogTitle>
          <DialogDescription>
            {transactions.length === 1
              ? "A transação será lançada como um título em contas a pagar no Omie."
              : `${transactions.length} transações serão lançadas como títulos separados em contas a pagar no Omie.`}
          </DialogDescription>
        </DialogHeader>

        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        )}

        <div className="space-y-4">
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
            {transactions.map((t) => (
              <div
                key={String(t.id)}
                className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0"
              >
                <span className="truncate">{pagcorpDisplayDescription(t) || "Sem descrição"}</span>
                <span className="shrink-0 font-medium">
                  {formatCurrency(Number(t.amount) || 0, String(t.currency || "BRL").toUpperCase())}
                </span>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="omie-ap-supplier" className="mb-1 block text-xs font-medium text-muted-foreground">
                Fornecedor <span className="text-destructive">*</span>
              </label>
              <SearchSelect
                id="omie-ap-supplier"
                options={suppliers}
                value={supplierCode}
                onChange={setSupplierCode}
                placeholder="Selecione o fornecedor"
                loading={loading}
                emptyLabel="Nenhum fornecedor encontrado"
              />
            </div>
            <div>
              <label htmlFor="omie-ap-category" className="mb-1 block text-xs font-medium text-muted-foreground">
                Categoria <span className="text-destructive">*</span>
              </label>
              <SearchSelect
                id="omie-ap-category"
                options={categories}
                value={categoryCode}
                onChange={setCategoryCode}
                placeholder="Selecione a categoria"
                loading={loading}
                emptyLabel="Nenhuma categoria encontrada"
              />
            </div>
            <div>
              <label htmlFor="omie-ap-account" className="mb-1 block text-xs font-medium text-muted-foreground">
                Conta corrente <span className="text-destructive">*</span>
              </label>
              <SearchSelect
                id="omie-ap-account"
                options={accounts}
                value={currentAccountCode}
                onChange={setCurrentAccountCode}
                placeholder="Selecione a conta corrente"
                loading={loading}
                emptyLabel="Nenhuma conta corrente encontrada"
              />
            </div>
            <div>
              <label htmlFor="omie-ap-due" className="mb-1 block text-xs font-medium text-muted-foreground">
                Vencimento <span className="text-destructive">*</span>
              </label>
              <Input
                id="omie-ap-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Total: <span className="font-medium text-foreground">{formatCurrency(total, currency)}</span>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {transactions.length === 1 ? "Criar conta a pagar" : `Criar ${transactions.length} contas a pagar`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
