import { useEffect, useState } from "react";
import { Loader2, RefreshCw, CheckCircle2, XCircle, FileText, Receipt, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sapQuery } from "@/lib/sap-client";
import { useSap } from "@/contexts/SapContext";

interface Props {
  open: boolean;
  onClose: () => void;
  docEntry: number | null;
  docNum: number | null;
  expectedAmount?: number;
  expectedCurrency?: string;
}

function formatCurrency(value: number, currency: string = "BRL") {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

export function SapValidationDialog({ open, onClose, docEntry, docNum, expectedAmount, expectedCurrency }: Props) {
  const { session } = useSap();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [po, setPo] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

  const load = async () => {
    if (!session || !docEntry) return;
    setLoading(true);
    setError(null);
    setPo(null); setInvoices([]); setPayments([]);
    try {
      // 1. Pedido de Compra
      const { data: poData } = await sapQuery(
        session,
        `PurchaseOrders(${docEntry})`,
        { $select: "DocEntry,DocNum,DocDate,DocTotal,DocTotalFC,DocCurrency,DocumentStatus,CardCode,CardName" },
      );
      setPo(poData);

      // 2. Notas fiscais (PurchaseInvoices) que tenham linha vindas desse PC
      try {
        const { data: invData } = await sapQuery(session, "PurchaseInvoices", {
          $filter: `DocumentLines/any(d: d/BaseEntry eq ${docEntry} and d/BaseType eq 22)`,
          $select: "DocEntry,DocNum,DocDate,DocTotal,DocTotalFC,DocCurrency,DocumentStatus,CardCode,CardName",
          $top: 10,
        });
        setInvoices((invData as any)?.value || []);
      } catch (e) {
        console.warn("PurchaseInvoices lookup failed:", e);
      }

      // 3. Pagamentos vinculados às NFs encontradas
      const invs = (invoices && invoices.length ? invoices : []) as any[];
      const docEntries = invs.map((i) => i.DocEntry);
      if (docEntries.length > 0) {
        try {
          const filter = docEntries
            .map((de) => `PaymentInvoices/any(p: p/DocEntry eq ${de})`)
            .join(" or ");
          const { data: payData } = await sapQuery(session, "VendorPayments", {
            $filter: filter,
            $select: "DocEntry,DocNum,DocDate,DocTotal,DocTotalFC,DocCurrency,CardCode,CardName",
            $top: 20,
          });
          setPayments((payData as any)?.value || []);
        } catch (e) {
          console.warn("VendorPayments lookup failed:", e);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao consultar SAP");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && docEntry) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docEntry]);

  // SAP B1 Service Layer retorna DocTotal em moeda local (BRL) e DocTotalFC em moeda estrangeira.
  // Se o PC estiver em moeda estrangeira (DocCurrency != BRL), o valor comparável é DocTotalFC.
  const poCurrency = po?.DocCurrency || expectedCurrency || "BRL";
  const isForeign = poCurrency && poCurrency !== "BRL";
  const poTotal = po ? Number((isForeign ? po.DocTotalFC : po.DocTotal) ?? 0) : null;
  const amountOk = expectedAmount != null && poTotal != null
    ? Math.abs(Number(poTotal) - Number(expectedAmount)) < 0.01
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Validar lançamento no SAP
          </DialogTitle>
          <DialogDescription>
            Pedido de Compra {docNum ? `#${docNum}` : ""} • DocEntry {docEntry ?? "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Consultando SAP…
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* PC */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Pedido de Compra</span>
              {po ? (
                <Badge variant="outline" className="ml-auto">{po.DocumentStatus || "—"}</Badge>
              ) : null}
            </div>
            {po ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Fornecedor:</span> {po.CardName} ({po.CardCode})</div>
                <div><span className="text-muted-foreground">Data:</span> {po.DocDate?.slice(0,10) || "—"}</div>
                <div><span className="text-muted-foreground">Moeda:</span> {poCurrency}</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Total:</span>
                  <span className="font-medium tabular-nums">{formatCurrency(Number(poTotal || 0), poCurrency)}</span>
                  {amountOk === true && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
                  {amountOk === false && <XCircle className="w-3.5 h-3.5 text-destructive" />}
                </div>
              </div>
            ) : !loading ? (
              <p className="text-xs text-muted-foreground">Pedido não encontrado no SAP.</p>
            ) : null}
            {amountOk === false && expectedAmount != null && (
              <p className="text-xs text-destructive mt-1">
                Valor divergente: esperado {formatCurrency(expectedAmount, expectedCurrency)} • SAP {formatCurrency(Number(poTotal), poCurrency)}
              </p>
            )}
          </div>

          {/* NF */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Nota Fiscal de Entrada vinculada</span>
              <Badge variant="outline" className="ml-auto">{invoices.length}</Badge>
            </div>
            {invoices.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma NF vinculada a este PC.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {invoices.map((i) => {
                  const cur = i.DocCurrency || poCurrency;
                  const total = cur && cur !== "BRL" ? Number(i.DocTotalFC ?? 0) : Number(i.DocTotal ?? 0);
                  return (
                    <li key={i.DocEntry} className="flex justify-between gap-2">
                      <span>NF #{i.DocNum} • {i.DocDate?.slice(0,10)}</span>
                      <span className="tabular-nums">{formatCurrency(total, cur)} • {i.DocumentStatus}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Pagamentos */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Pagamentos</span>
              <Badge variant="outline" className="ml-auto">{payments.length}</Badge>
            </div>
            {payments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum pagamento vinculado às NFs deste PC.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {payments.map((p) => {
                  const cur = p.DocCurrency || poCurrency;
                  const total = cur && cur !== "BRL" ? Number(p.DocTotalFC ?? 0) : Number(p.DocTotal ?? 0);
                  return (
                    <li key={p.DocEntry} className="flex justify-between gap-2">
                      <span>Pgto #{p.DocNum} • {p.DocDate?.slice(0,10)}</span>
                      <span className="tabular-nums">{formatCurrency(total, cur)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Reconsultar
            </Button>
            <Button size="sm" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
