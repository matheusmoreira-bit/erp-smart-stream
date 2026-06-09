import { useState, useEffect } from "react";
import { Loader2, Layers, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SapSearchCombobox, type SapSearchOption } from "@/components/SapSearchCombobox";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

function formatCurrency(value: number, currency: string = "BRL") {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  transactions: PagCorpTransaction[];
  onConfirm: (supplier: SapSearchOption) => Promise<void>;
}

export function PagCorpConsolidateDialog({ open, onClose, transactions, onConfirm }: Props) {
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSupplier(null);
      setSubmitting(false);
    }
  }, [open]);

  const totalsByCurrency: Record<string, number> = {};
  transactions.forEach((t) => {
    const c = t.currency || "BRL";
    totalsByCurrency[c] = (totalsByCurrency[c] || 0) + (Number(t.amount) || 0);
  });

  const currencies = Object.keys(totalsByCurrency);
  const mixedCurrencies = currencies.length > 1;

  const handleSubmit = async () => {
    if (!supplier) return;
    setSubmitting(true);
    try {
      await onConfirm(supplier);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Integrar {transactions.length} transações em 1 Pedido de Compra
          </DialogTitle>
          <DialogDescription>
            Será criado <strong>um único Pedido de Compra</strong> no SAP, com uma linha por
            transação selecionada, todas para o mesmo fornecedor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3 max-h-56 overflow-y-auto space-y-1.5">
            {transactions.map((t) => (
              <div key={t.id} className="flex items-start gap-2 text-sm">
                <CreditCard className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="truncate">{t.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.accountAlias || t.accountName || "—"}
                  </p>
                </div>
                <p className="text-xs font-semibold tabular-nums whitespace-nowrap">
                  {formatCurrency(Number(t.amount) || 0, t.currency)}
                </p>
              </div>
            ))}
          </div>

          <div className="flex justify-end text-sm">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total consolidado</p>
              {currencies.map((c) => (
                <p key={c} className="font-bold tabular-nums">
                  {formatCurrency(totalsByCurrency[c], c)}
                </p>
              ))}
            </div>
          </div>

          {mixedCurrencies && (
            <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded p-2">
              ⚠ Transações em moedas diferentes. O Pedido será emitido na moeda da primeira
              transação. Recomendado consolidar somente uma moeda por vez.
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Fornecedor SAP <span className="text-destructive">*</span>
            </label>
            <SapSearchCombobox
              endpoint="BusinessPartners"
              filterTemplate="CardType eq 'cSupplier' and (contains(CardName,'{q}') or contains(CardCode,'{q}'))"
              selectFields="CardCode,CardName,FederalTaxID"
              mapRow={(row: any) => ({
                code: row.CardCode,
                name: row.CardName,
                extra: row.FederalTaxID || undefined,
              })}
              value={supplier}
              onChange={setSupplier}
              placeholder="Buscar fornecedor por nome ou código…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!supplier || submitting}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Integrar consolidado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
