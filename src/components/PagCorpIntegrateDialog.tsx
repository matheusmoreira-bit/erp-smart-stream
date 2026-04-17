import { useState, useEffect } from "react";
import { Loader2, CreditCard, Sparkles, Upload } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  transaction: PagCorpTransaction | null;
  integrationType: "generic" | "accountability";
  companyDb?: string;
  onConfirm: (supplier: SapSearchOption) => Promise<void>;
}

export function PagCorpIntegrateDialog({
  open,
  onClose,
  transaction,
  integrationType,
  companyDb,
  onConfirm,
}: Props) {
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentAccount, setPaymentAccount] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !companyDb) return;
    setSupplier(null);
    setSubmitting(false);
    setPaymentAccount(null);
    supabase
      .from("system_credentials")
      .select("credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb)
      .eq("credential_key", "pagcorp_payment_account")
      .maybeSingle()
      .then(({ data }) => setPaymentAccount((data as any)?.credential_value || null));
  }, [open, companyDb]);

  if (!transaction) return null;

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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {integrationType === "accountability" ? (
              <Sparkles className="w-5 h-5 text-primary" />
            ) : (
              <Upload className="w-5 h-5 text-primary" />
            )}
            Integrar no SAP
          </DialogTitle>
          <DialogDescription>
            Será criado <strong>Pedido de Compra + NF de Entrada + Pagamento</strong> no SAP, sem passar
            por aprovações.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <CreditCard className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{transaction.description}</p>
                <p className="text-xs text-muted-foreground">
                  {transaction.accountAlias || transaction.accountName || "—"}
                  {transaction.cardLastDigits && ` • •••${transaction.cardLastDigits}`}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums">
                {formatCurrency(transaction.amount, transaction.currency)}
              </p>
            </div>
          </div>

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

          {!paymentAccount && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              Conta de pagamento PagCorp não configurada para esta empresa. Adicione a credencial{" "}
              <code className="font-mono">pagcorp_payment_account</code> em Credenciais SAP.
            </div>
          )}

          {paymentAccount && (
            <p className="text-xs text-muted-foreground">
              Conta de pagamento: <span className="font-mono text-foreground">{paymentAccount}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!supplier || !paymentAccount || submitting}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Integrar agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
