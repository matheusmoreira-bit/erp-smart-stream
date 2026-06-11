import { useState, useEffect, useMemo, useCallback } from "react";
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
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

function formatCurrency(value: number, currency: string = "BRL") {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
}

export type LineOverrideMap = Record<string, { costCenter?: string | null; project?: string | null }>;

interface Props {
  open: boolean;
  onClose: () => void;
  transactions: PagCorpTransaction[];
  onConfirm: (supplier: SapSearchOption, lineOverrides: LineOverrideMap) => Promise<void>;
}

export function PagCorpConsolidateDialog({ open, onClose, transactions, onConfirm }: Props) {
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [headerCC, setHeaderCC] = useState<SapSearchOption | null>(null);
  const [headerPR, setHeaderPR] = useState<SapSearchOption | null>(null);
  const [perLineCC, setPerLineCC] = useState<Record<string, SapSearchOption | null>>({});
  const [perLinePR, setPerLinePR] = useState<Record<string, SapSearchOption | null>>({});

  useEffect(() => {
    if (open) {
      setSupplier(null);
      setSubmitting(false);
      setHeaderCC(null);
      setHeaderPR(null);
      setPerLineCC({});
      setPerLinePR({});
    }
  }, [open]);

  const ccMap = useCallback((row: any) => ({ code: row.CenterCode, name: row.CenterName }), []);
  const prMap = useCallback((row: any) => ({ code: row.Code, name: row.Name }), []);
  const { options: ccOptions, isLoading: ccLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: ccMap,
  });
  const { options: prOptions, isLoading: prLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: prMap,
  });

  const totalsByCurrency: Record<string, number> = {};
  transactions.forEach((t) => {
    const c = t.currency || "BRL";
    totalsByCurrency[c] = (totalsByCurrency[c] || 0) + (Number(t.amount) || 0);
  });

  const currencies = Object.keys(totalsByCurrency);
  const mixedCurrencies = currencies.length > 1;

  const effectiveLine = (id: string) => ({
    cc: perLineCC[id] ?? headerCC,
    pr: perLinePR[id] ?? headerPR,
  });

  const handleSubmit = async () => {
    if (!supplier) return;
    setSubmitting(true);
    try {
      const map: LineOverrideMap = {};
      transactions.forEach((t) => {
        const id = String(t.id);
        const eff = effectiveLine(id);
        if (eff.cc || eff.pr) {
          map[id] = {
            costCenter: eff.cc?.code || null,
            project: eff.pr?.code || null,
          };
        }
      });
      await onConfirm(supplier, map);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Integrar {transactions.length} transações em 1 Pedido de Compra
          </DialogTitle>
          <DialogDescription>
            Será criado <strong>um único Pedido de Compra</strong> no SAP, com uma linha por
            transação, todas para o mesmo fornecedor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Fornecedor SAP <span className="text-destructive">*</span>
            </label>
            <SapSearchCombobox
              endpoint="BusinessPartners"
              filterTemplate="CardType eq 'cSupplier' and Frozen eq 'tNO' and (contains(tolower(CardName),'{qLower}') or contains(tolower(CardCode),'{qLower}'))"
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

          <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed border-border bg-muted/20 p-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Centro de Custo (padrão)
              </label>
              <CachedSearchCombobox
                options={ccOptions}
                isLoading={ccLoading}
                value={headerCC}
                onChange={setHeaderCC}
                placeholder="Aplicado a todas as linhas…"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Projeto (padrão)
              </label>
              <CachedSearchCombobox
                options={prOptions}
                isLoading={prLoading}
                value={headerPR}
                onChange={setHeaderPR}
                placeholder="Aplicado a todas as linhas…"
              />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              Os valores definidos aqui valem como padrão para todas as transações. Você pode
              ajustar linha a linha abaixo.
            </p>
          </div>

          <div className="rounded-lg border border-border max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 sticky top-0">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Transação</th>
                  <th className="px-2 py-1.5 font-medium">Valor</th>
                  <th className="px-2 py-1.5 font-medium w-44">Centro de Custo</th>
                  <th className="px-2 py-1.5 font-medium w-44">Projeto</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const id = String(t.id);
                  return (
                    <tr key={id} className="border-t border-border align-top">
                      <td className="px-2 py-2">
                        <div className="flex items-start gap-1.5">
                          <CreditCard className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{t.description}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {t.accountAlias || t.accountName || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs tabular-nums whitespace-nowrap">
                        {formatCurrency(Number(t.amount) || 0, t.currency)}
                      </td>
                      <td className="px-2 py-2">
                        <CachedSearchCombobox
                          options={ccOptions}
                          isLoading={ccLoading}
                          value={perLineCC[id] ?? headerCC}
                          onChange={(v) => setPerLineCC((prev) => ({ ...prev, [id]: v }))}
                          placeholder="Herdar do cabeçalho"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <CachedSearchCombobox
                          options={prOptions}
                          isLoading={prLoading}
                          value={perLinePR[id] ?? headerPR}
                          onChange={(v) => setPerLinePR((prev) => ({ ...prev, [id]: v }))}
                          placeholder="Herdar do cabeçalho"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
