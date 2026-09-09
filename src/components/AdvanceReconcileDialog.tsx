import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Wallet, AlertTriangle } from "lucide-react";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { DateInputBR } from "@/components/DateInputBR";
import type { AdvancePayment } from "@/hooks/useAdvancePayments";

/** Contas contábeis liberadas para recebimento (bancos de entrada). */
const RECEIVING_ACCOUNT_CODES = ["1.1.1.02.000019", "1.1.1.02.000018"];

function fmt(v: number, ccy = "BRL") {
  const code = /^[A-Z]{3}$/.test(ccy) ? ccy : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(v || 0);
}

interface Props {
  open: boolean;
  advance: AdvancePayment | null;
  onClose: () => void;
  onConfirm: (params: { data_recebimento: string; conta_codigo: string; conta_nome?: string | null }) => Promise<void>;
}

export function AdvanceReconcileDialog({ open, advance, onClose, onConfirm }: Props) {
  const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(today);
  const [conta, setConta] = useState<SapSearchOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(today);
    setConta(null);
    setSubmitting(false);
  }, [open, today]);

  const accountsCache = useSapCachedList({
    cacheKey: "chart_of_accounts_active",
    endpoint: "ChartOfAccounts",
    params: { $filter: "ActiveAccount eq 'tYES'", $select: "Code,Name,FormatCode" },
    mapRow: (r: { Code?: string; Name?: string; FormatCode?: string }): SapSearchOption => ({
      code: r.FormatCode || r.Code || "",
      name: r.Name || "",
      extra: r.FormatCode && r.Code && r.FormatCode !== r.Code ? r.Code : "",
    }),
    enabled: open,
  });

  const receivingAccounts = useMemo(
    () =>
      accountsCache.options.filter(
        (opt) => RECEIVING_ACCOUNT_CODES.includes(opt.code) || RECEIVING_ACCOUNT_CODES.includes(opt.extra || ""),
      ),
    [accountsCache.options],
  );

  const canSubmit = !!data && !!conta && !submitting;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm({ data_recebimento: data, conta_codigo: conta!.code, conta_nome: conta!.name });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent ref={setDialogEl} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Reconciliar adiantamento
          </DialogTitle>
          <DialogDescription>
            {advance ? (
              <>
                Cliente <strong>{advance.supplier_name}</strong> ·{" "}
                <span className="font-mono">{fmt(advance.amount, advance.currency)}</span>
                {advance.sap_doc_num ? ` · ADT #${advance.sap_doc_num}` : ""}
              </>
            ) : (
              "Informe a conta bancária que recebeu o valor."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Data do recebimento</Label>
            <DateInputBR value={data} onChange={setData} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Conta bancária de recebimento</Label>
            <CachedSearchCombobox
              options={receivingAccounts}
              isLoading={accountsCache.isLoading}
              value={conta}
              onChange={setConta}
              placeholder="Buscar conta contábil..."
              portalContainer={dialogEl}
              required
            />
          </div>
          {!canSubmit && !submitting && (
            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              Informe data e conta bancária para concluir a reconciliação.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit} className="gap-1.5">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
            Reconciliar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
