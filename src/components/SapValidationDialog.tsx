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
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/lib/invoke-fn";

interface Props {
  open: boolean;
  onClose: () => void;
  /** ID do pagcorp_integration_log (chave em pagcorp_document_relations). */
  pagcorpLogId?: string | null;
  /** Fallback: quando não existe relation, mostramos ao menos o cabeçalho. */
  docEntry: number | null;
  docNum: number | null;
  expectedAmount?: number;
  expectedCurrency?: string;
}

interface RelationRow {
  po_doc_entry: number | null;
  po_doc_num: number | null;
  po_status: string | null;
  po_total: number | null;
  po_total_fc: number | null;
  po_currency: string | null;
  nf_doc_entries: number[] | null;
  payment_doc_entries: number[] | null;
  po_found: boolean;
  amount_matches: boolean | null;
  last_resolved_at: string | null;
  resolve_error: string | null;
  company_db: string | null;
}

interface NfRow { doc_entry: number; doc_num: number | null; doc_date: string | null; doc_total: number | null; doc_currency: string | null; document_status: string | null }
interface PayRow { doc_entry: number; doc_num: number | null; doc_date: string | null; doc_total: number | null; doc_total_fc: number | null; doc_currency: string | null; invoice_links: Array<{ docEntry?: number; invoiceType?: string; sumApplied?: number; appliedFC?: number }> }

function formatCurrency(value: number, currency = "BRL") {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

export function SapValidationDialog({ open, onClose, pagcorpLogId, docEntry, docNum, expectedAmount, expectedCurrency }: Props) {
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rel, setRel] = useState<RelationRow | null>(null);
  const [nfs, setNfs] = useState<NfRow[]>([]);
  const [pays, setPays] = useState<PayRow[]>([]);

  const load = async () => {
    if (!pagcorpLogId) return;
    setLoading(true); setError(null);
    try {
      const { data: relData, error: relErr } = await supabase
        .from("pagcorp_document_relations")
        .select("po_doc_entry, po_doc_num, po_status, po_total, po_total_fc, po_currency, nf_doc_entries, payment_doc_entries, po_found, amount_matches, last_resolved_at, resolve_error, company_db")
        .eq("pagcorp_log_id", pagcorpLogId)
        .maybeSingle();
      if (relErr) throw new Error(relErr.message);
      const row = (relData as RelationRow | null) ?? null;
      setRel(row);

      if (row?.company_db) {
        if ((row.nf_doc_entries || []).length > 0) {
          const { data: nfData } = await supabase
            .from("sap_nf_entrada_cache")
            .select("doc_entry, doc_num, doc_date, doc_total, doc_currency, document_status")
            .eq("company_db", row.company_db)
            .in("doc_entry", row.nf_doc_entries as number[]);
          setNfs((nfData || []) as NfRow[]);
        } else {
          setNfs([]);
        }

        if ((row.payment_doc_entries || []).length > 0) {
          const { data: payData } = await supabase
            .from("sap_vendor_payment_cache")
            .select("doc_entry, doc_num, doc_date, doc_total, doc_total_fc, doc_currency, invoice_links")
            .eq("company_db", row.company_db)
            .in("doc_entry", row.payment_doc_entries as number[]);
          setPays((payData || []) as PayRow[]);
        } else {
          setPays([]);
        }
      } else {
        setNfs([]); setPays([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar relações");
    } finally {
      setLoading(false);
    }
  };

  const reresolve = async () => {
    if (!pagcorpLogId) return;
    setResolving(true); setError(null);
    try {
      await invokeFn("pagcorp-relations-resolver", { logId: pagcorpLogId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao reconsultar");
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (open && pagcorpLogId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pagcorpLogId]);

  const poCurrency = rel?.po_currency || expectedCurrency || "BRL";
  const isForeign = poCurrency && poCurrency !== "BRL";
  const poTotal = rel ? Number((isForeign ? rel.po_total_fc : rel.po_total) ?? 0) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Validar lançamento no SAP
          </DialogTitle>
          <DialogDescription>
            Pedido de Compra {rel?.po_doc_num || docNum ? `#${rel?.po_doc_num ?? docNum}` : ""} • DocEntry {rel?.po_doc_entry ?? docEntry ?? "—"}
            {rel?.last_resolved_at ? (
              <span className="block text-xs text-muted-foreground mt-0.5">
                Resolvido em {new Date(rel.last_resolved_at).toLocaleString("pt-BR")}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando relações…
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {!pagcorpLogId && !loading && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Este documento ainda não possui histórico de integração PagCorp.
            </div>
          )}
          {rel?.resolve_error && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              Última resolução: {rel.resolve_error}
            </div>
          )}

          {/* PC */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Pedido de Compra</span>
              {rel?.po_status ? <Badge variant="outline" className="ml-auto">{rel.po_status}</Badge> : null}
            </div>
            {rel?.po_found ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Moeda:</span> {poCurrency}</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Total:</span>
                  <span className="font-medium tabular-nums">{formatCurrency(Number(poTotal || 0), poCurrency)}</span>
                  {rel.amount_matches === true && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
                  {rel.amount_matches === false && <XCircle className="w-3.5 h-3.5 text-destructive" />}
                </div>
              </div>
            ) : !loading ? (
              <p className="text-xs text-muted-foreground">Pedido ainda não encontrado no cache. Aguarde a próxima sincronização ou clique em Reconsultar.</p>
            ) : null}
            {rel?.amount_matches === false && expectedAmount != null && (
              <p className="text-xs text-destructive mt-1">
                Valor divergente: esperado {formatCurrency(expectedAmount, expectedCurrency)} • SAP {formatCurrency(Number(poTotal || 0), poCurrency)}
              </p>
            )}
          </div>

          {/* NF */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Nota Fiscal de Entrada vinculada</span>
              <Badge variant="outline" className="ml-auto">{nfs.length}</Badge>
            </div>
            {nfs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma NF vinculada a este PC.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {nfs.map((i) => {
                  const cur = i.doc_currency || poCurrency;
                  const total = Number(i.doc_total ?? 0);
                  return (
                    <li key={i.doc_entry} className="flex justify-between gap-2">
                      <span>NF #{i.doc_num} • {i.doc_date?.slice(0, 10)}</span>
                      <span className="tabular-nums">{formatCurrency(total, cur)} • {i.document_status}</span>
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
              <Badge variant="outline" className="ml-auto">{pays.length}</Badge>
            </div>
            {pays.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum pagamento vinculado às NFs deste PC.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {pays.map((p) => {
                  const cur = p.doc_currency || poCurrency;
                  const foreign = cur && cur !== "BRL";
                  const nfSet = new Set(nfs.map((i) => i.doc_entry));
                  const applied = (p.invoice_links || [])
                    .filter((pi) => (pi.invoiceType == null || pi.invoiceType === "it_PurchaseInvoice") && typeof pi.docEntry === "number" && nfSet.has(pi.docEntry))
                    .reduce((s, pi) => s + Number((foreign ? (pi.appliedFC ?? pi.sumApplied) : pi.sumApplied) ?? 0), 0);
                  const fallback = foreign ? Number(p.doc_total_fc ?? 0) : Number(p.doc_total ?? 0);
                  const total = applied || fallback;
                  return (
                    <li key={p.doc_entry} className="flex justify-between gap-2">
                      <span>Pgto #{p.doc_num} • {p.doc_date?.slice(0, 10)}</span>
                      <span className="tabular-nums">{formatCurrency(total, cur)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={reresolve} disabled={loading || resolving || !pagcorpLogId} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${resolving ? "animate-spin" : ""}`} /> Reconsultar
            </Button>
            <Button size="sm" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
