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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, DollarSign, Wallet } from "lucide-react";
import { toast } from "sonner";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { createBaixaRecebimentoAndSync } from "@/lib/baixa-recebimento-sync";
import { useSap } from "@/contexts/SapContext";
import { DateInputBR } from "@/components/DateInputBR";

export interface BaixaInvoiceRow {
  docEntry: number;
  docNum: number;
  cardCode: string;
  cardName: string;
  currency: string;
  saldoResidual: number;
  /** 'invoice' (NF) ou 'journal_entry' (Saldo Inicial via JE). Default: 'invoice'. */
  docType?: "invoice" | "journal_entry";
  /** Linha do JournalEntry (obrigatório quando docType='journal_entry'). */
  docLine?: number | null;
}

interface BaixaRecebimentoDialogProps {
  open: boolean;
  onClose: () => void;
  invoices: BaixaInvoiceRow[];
  onSuccess: () => void;
}

function fmt(v: number, ccy: string = "BRL") {
  const valid = /^[A-Z]{3}$/.test(ccy) ? ccy : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: valid }).format(v || 0);
}

function parseAmount(txt: string): number {
  const clean = txt
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // remove milhar
    .replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

export function BaixaRecebimentoDialog({
  open,
  onClose,
  invoices,
  onSuccess,
}: BaixaRecebimentoDialogProps) {
  const { session } = useSap();
  const companyDb = session?.companyDB || "";
  const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);

  // Regra: 1 cliente por baixa
  const cardCode = invoices[0]?.cardCode || "";
  const cardName = invoices[0]?.cardName || "";
  const currency = invoices[0]?.currency || "BRL";
  const saldoTotal = useMemo(
    () => invoices.reduce((s, i) => s + Math.max(0, i.saldoResidual), 0),
    [invoices],
  );

  const today = new Date().toISOString().slice(0, 10);
  const [dataRecebimento, setDataRecebimento] = useState<string>(today);
  const [conta, setConta] = useState<SapSearchOption | null>(null);
  const [contaJuros, setContaJuros] = useState<SapSearchOption | null>(null);
  const [valorRecebidoTxt, setValorRecebidoTxt] = useState<string>(saldoTotal.toFixed(2).replace(".", ","));
  const [rateio, setRateio] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Chave estável para rateio: combina tipo + docEntry + docLine.
  // NFs (invoice) e Saldos Iniciais (journal_entry) podem compartilhar DocEntry, então
  // precisamos de uma chave composta para evitar colisão.
  const rowKey = (inv: BaixaInvoiceRow) =>
    `${inv.docType ?? "invoice"}:${inv.docEntry}:${inv.docLine ?? 0}`;

  // Reset when dialog reopens with new selection
  useEffect(() => {
    if (!open) return;
    setDataRecebimento(today);
    setConta(null);
    setContaJuros(null);
    setValorRecebidoTxt(saldoTotal.toFixed(2).replace(".", ","));
    // Rateio inicial = saldo residual de cada linha
    const initial: Record<string, string> = {};
    for (const inv of invoices) {
      initial[rowKey(inv)] = inv.saldoResidual.toFixed(2).replace(".", ",");
    }
    setRateio(initial);
  }, [open, saldoTotal, invoices, today]);

  const accountsCache = useSapCachedList({
    cacheKey: "chart_of_accounts_active",
    endpoint: "ChartOfAccounts",
    params: {
      $filter: "ActiveAccount eq 'tYES'",
      $select: "Code,Name,FormatCode",
    },
    mapRow: (r: {
      Code?: string;
      Name?: string;
      FormatCode?: string;
    }): SapSearchOption => ({
      code: r.FormatCode || r.Code || "",
      name: r.Name || "",
      extra: r.FormatCode && r.Code && r.FormatCode !== r.Code ? r.Code : "",
    }),
    enabled: open,
  });

  // Contas contábeis liberadas para recebimento (bancos de entrada).
  // Mantido como allowlist explícita — se precisar adicionar contas, incluir aqui.
  const RECEIVING_ACCOUNT_CODES = ["1.1.1.02.000019", "1.1.1.02.000018"];
  const receivingAccounts = useMemo(
    () =>
      accountsCache.options.filter((opt) =>
        RECEIVING_ACCOUNT_CODES.includes(opt.code) ||
        RECEIVING_ACCOUNT_CODES.includes(opt.extra || ""),
      ),
    [accountsCache.options],
  );

  const valorRecebido = parseAmount(valorRecebidoTxt);
  const rateioValores = useMemo(() => {
    const map: Record<string, number> = {};
    for (const inv of invoices) map[rowKey(inv)] = parseAmount(rateio[rowKey(inv)] || "0");
    return map;
  }, [rateio, invoices]);
  const somaRateio = useMemo(
    () => Object.values(rateioValores).reduce((s, v) => s + v, 0),
    [rateioValores],
  );
  // Excedente por linha (parte do rateio que ultrapassa o saldo residual da NF)
  // é contabilizado como juros/multa. A soma total dos rateios continua igual
  // ao valor recebido — o excedente já está embutido nas linhas.
  const excedente = useMemo(
    () =>
      invoices.reduce((acc, inv) => {
        const v = rateioValores[rowKey(inv)] || 0;
        return acc + Math.max(0, +(v - inv.saldoResidual).toFixed(2));
      }, 0),
    [invoices, rateioValores],
  );
  const diffSoma = +(valorRecebido - somaRateio).toFixed(2);

  /* ── Validações ─────────────────────────────────────── */
  const validationErrors: string[] = [];
  if (!dataRecebimento) validationErrors.push("Informe a data de recebimento.");
  if (!conta) validationErrors.push("Selecione a conta contábil de recebimento.");
  if (valorRecebido <= 0) validationErrors.push("Informe um valor recebido maior que zero.");
  if (Math.abs(diffSoma) > 0.01) {
    validationErrors.push(
      diffSoma > 0
        ? `Faltam ${fmt(diffSoma, currency)} para completar o valor recebido.`
        : `Rateio excede o valor recebido em ${fmt(-diffSoma, currency)}.`,
    );
  }
  if (excedente > 0 && !contaJuros) {
    validationErrors.push(
      "Há valor a baixar acima do saldo de uma ou mais NFs — selecione a conta de juros/multa.",
    );
  }

  /* ── Submit ─────────────────────────────────────────── */
  async function handleConfirmar() {
    if (submitting) return;
    if (!session || !companyDb) {
      toast.error("Sessão SAP inválida.");
      return;
    }
    if (validationErrors.length > 0) {
      toast.error(validationErrors[0]);
      return;
    }
    setSubmitting(true);

    try {
      const itensPayload = invoices
        .filter((inv) => (rateioValores[rowKey(inv)] || 0) > 0)
        .map((inv) => ({
          invoiceDocEntry: inv.docEntry,
          invoiceDocNum: String(inv.docNum),
          valorBaixado: rateioValores[rowKey(inv)],
          invoiceType: inv.docType ?? "invoice",
          invoiceDocLine: inv.docType === "journal_entry" ? (inv.docLine ?? 0) : null,
        }));
      if (itensPayload.length === 0) throw new Error("Nenhum item com valor a baixar.");

      const { ok, sapDocEntry, errorMessage } = await createBaixaRecebimentoAndSync(session, {
        companyDb,
        cardCode,
        cardName,
        dataRecebimento,
        contaContabilCodigo: conta!.code,
        contaContabilNome: conta!.name,
        contaJurosMultaCodigo: contaJuros?.code || null,
        contaJurosMultaNome: contaJuros?.name || null,
        valorTotal: valorRecebido,
        valorJurosMulta: excedente,
        itens: itensPayload,
      });

      if (!ok) {
        toast.error(`Baixa salva localmente, mas SAP recusou: ${errorMessage}`);
        onSuccess();
        onClose();
        return;
      }

      toast.success(
        `Baixa registrada${sapDocEntry ? ` · IncomingPayment #${sapDocEntry}` : ""}.`,
      );
      onSuccess();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Falha ao registrar baixa");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent ref={setDialogEl} className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Baixa de recebimento
          </DialogTitle>
          <DialogDescription>
            Cliente: <strong>{cardName}</strong> · {cardCode} ·{" "}
            {invoices.length} NF(s) selecionada(s) · Saldo total{" "}
            <strong className="font-mono">{fmt(saldoTotal, currency)}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cabeçalho da baixa */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data de recebimento</Label>
              <DateInputBR value={dataRecebimento} onChange={setDataRecebimento} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valor recebido ({currency})</Label>
              <Input
                inputMode="decimal"
                value={valorRecebidoTxt}
                onChange={(e) => {
                  const txt = e.target.value;
                  setValorRecebidoTxt(txt);
                  // Com 1 NF selecionada, o rateio acompanha o valor recebido
                  if (invoices.length === 1) {
                    const only = invoices[0];
                    setRateio({ [only.docEntry]: txt });
                  }
                }}
                title="O cliente pode ter pago um valor diferente do saldo residual (a menor, adiantamento; a maior, juros/multa)."
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Conta contábil / banco</Label>
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
            {excedente > 0 && (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Conta contábil para juros/multa (excedente {fmt(excedente, currency)})
                </Label>
                <CachedSearchCombobox
                  options={accountsCache.options}
                  isLoading={accountsCache.isLoading}
                  value={contaJuros}
                  onChange={setContaJuros}
                  placeholder="Buscar conta de receita financeira / juros..."
                  portalContainer={dialogEl}
                  required
                />
              </div>
            )}
          </div>

          {/* Rateio */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Rateio por NF
              </p>
              <Badge variant="outline" className="text-[10px]">
                {Math.abs(diffSoma) <= 0.01 ? "OK" : diffSoma > 0 ? "Faltam" : "Excede"}
              </Badge>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Nº NF</th>
                    <th className="text-right py-2 px-2">Saldo residual</th>
                    <th className="text-right py-2 px-2">Valor a baixar</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const val = rateioValores[inv.docEntry] || 0;
                    const excede = val > inv.saldoResidual + 0.001;
                    return (
                      <tr key={inv.docEntry} className="border-b border-border/40">
                        <td className="py-1.5 px-2 font-mono">{inv.docNum}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                          {fmt(inv.saldoResidual, inv.currency)}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <Input
                            inputMode="decimal"
                            className={`h-7 text-xs text-right font-mono ${excede ? "border-amber-500 bg-amber-500/5" : ""}`}
                            value={rateio[inv.docEntry] || ""}
                            onChange={(e) =>
                              setRateio((prev) => ({ ...prev, [inv.docEntry]: e.target.value }))
                            }
                            disabled={invoices.length === 1}
                            title={
                              invoices.length === 1
                                ? "Com 1 NF selecionada, o valor a baixar é o próprio saldo residual."
                                : excede
                                  ? "Valor acima do saldo — excedente vira juros/multa"
                                  : undefined
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20 border-t border-border/60">
                    <td className="py-2 px-2 font-medium">Total do rateio</td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                      Recebido: {fmt(valorRecebido, currency)}
                    </td>
                    <td
                      className={`py-2 px-2 text-right font-mono font-semibold ${
                        Math.abs(diffSoma) > 0.01 ? "text-destructive" : ""
                      }`}
                    >
                      {fmt(somaRateio, currency)}
                    </td>
                  </tr>
                  {excedente > 0 && (
                    <tr className="border-t border-border/60 bg-amber-500/5">
                      <td className="py-2 px-2 text-amber-600 dark:text-amber-400 font-medium">
                        Excedente (juros/multa)
                      </td>
                      <td></td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                        {fmt(excedente, currency)}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>

          {validationErrors.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
              {validationErrors.map((msg, i) => (
                <p key={i} className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {msg}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmar}
            disabled={submitting || validationErrors.length > 0}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <DollarSign className="w-3.5 h-3.5" />
            )}
            Confirmar baixa {fmt(valorRecebido, currency)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
