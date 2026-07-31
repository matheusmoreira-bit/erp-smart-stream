import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, ShieldCheck, Search, Download, Wrench, Undo2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";

interface AuditTx {
  logId: string;
  pagcorpExpenseId: number;
  amount: number;
  currency: string;
  ptax: number | null;
  expectedLocal: number | null;
}

interface RepairAction {
  companyDb: string;
  paymentDocEntry: number;
  paymentDocNum?: number | null;
  cardName?: string | null;
  applied?: number;
  expected?: number;
  difference?: number;
  differencePct?: number | null;
  fxVariation?: boolean;
  reason?: string;
  action: string;
  error?: string | null;
}

interface AuditFinding {
  companyDb: string;
  paymentDocEntry: number;
  paymentDocNum: number | null;
  paymentDate: string | null;
  cardName: string | null;
  currency: string | null;
  transferSum: number;
  appliedTotal: number;
  appliedToInvoice: number;
  expectedFromPagcorp: number;
  difference: number;
  differencePct?: number | null;
  fxVariation?: boolean;
  invoiceDocEntry: number | null;
  invoiceDocNum: number | null;
  invoiceTotal: number | null;
  invoicePaid: number | null;
  transactions: AuditTx[];
  settledAt: string | null;
  issues: string[];
}

const ISSUE_LABELS: Record<string, string> = {
  payment_not_found: "Baixa não encontrada no ERP",
  cancelled_in_sap: "Já cancelada no ERP",
  applied_greater_than_expected: "Baixa maior que a transação",
  applied_less_than_expected: "Baixa menor que a transação",
  fx_variation: "Variação cambial (não é erro)",
  batch_payment: "Pagamento em lote",
  missing_ptax: "Sem PTAX gravada",
  invoice_cancelled: "NF cancelada",
  applied_greater_than_invoice: "Baixa maior que a NF",
  invoice_overpaid: "NF paga acima do total",
};

const CRITICAL = new Set([
  "applied_greater_than_expected",
  "applied_greater_than_invoice",
  "invoice_overpaid",
  "payment_not_found",
]);

function money(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateBr(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export default function PagCorpSettlementAudit() {
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [errors, setErrors] = useState<Array<{ companyDb: string; message: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [repairPreview, setRepairPreview] = useState<RepairAction[] | null>(null);
  const [confirmRepair, setConfirmRepair] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetPreview, setResetPreview] = useState<
    { cancelled: RepairAction[]; stillActive: RepairAction[] } | null
  >(null);

  // Confirma no ERP se as baixas automáticas do PagCorp foram canceladas
  // (manualmente) e, na execução real, limpa os relacionamentos de baixa
  // devolvendo os lançamentos para a fila do watcher.
  const runReset = useCallback(async (dryRun: boolean) => {
    if (!dryRun && !resetPreview?.cancelled.length) {
      toast.error("Rode a verificação antes de limpar os relacionamentos");
      return;
    }
    setResetting(true);
    try {
      const entries = !dryRun ? resetPreview!.cancelled.map((a) => a.paymentDocEntry) : undefined;
      const { data, error } = await supabase.functions.invoke("pagcorp-settlement-repair", {
        body: {
          mode: "reset_cancelled",
          companyDbs: ["SBO_ANAGAMING", "SBO_CACTUS"],
          limit: 500,
          dryRun,
          ...(entries ? { paymentDocEntries: entries } : {}),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao verificar as baixas");
      const acts = (data.actions || []) as RepairAction[];
      if (dryRun) {
        setResetPreview({
          cancelled: acts.filter((a) => a.action === "would_reset"),
          stillActive: acts.filter((a) => a.reason === "payment_still_active"),
        });
        toast.success(
          `${data.toFix} baixa(s) confirmada(s) como cancelada(s) no ERP${data.stillActive ? ` · ${data.stillActive} ainda ativa(s)` : ""}`,
        );
      } else {
        setResetPreview(null);
        toast.success(`${data.reset} relacionamento(s) limpo(s) e devolvido(s) à fila de baixa`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível limpar os relacionamentos");
    } finally {
      setResetting(false);
    }
  }, [resetPreview]);


  const runRepair = useCallback(async (dryRun: boolean) => {
    // Na execução real, restringe o cancelamento exatamente aos documentos
    // listados na simulação — nada fora dessa lista é tocado.
    const entries = !dryRun && repairPreview?.length
      ? repairPreview.map((a) => a.paymentDocEntry)
      : undefined;
    if (!dryRun && !entries?.length) {
      toast.error("Rode a simulação antes de executar o cancelamento");
      return;
    }
    setRepairing(true);
    try {
      const { data, error } = await supabase.functions.invoke("pagcorp-settlement-repair", {
        body: {
          companyDbs: ["SBO_ANAGAMING", "SBO_CACTUS"],
          limit: 300,
          dryRun,
          ...(entries ? { paymentDocEntries: entries } : {}),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha no reparo das baixas");
      const acts = (data.actions || []) as RepairAction[];
      if (dryRun) {
        setRepairPreview(acts.filter((a) => a.action === "would_cancel_and_requeue"));
        toast.success(
          `${data.toFix} baixa(s) divergente(s) seriam canceladas${data.fxSkipped ? ` · ${data.fxSkipped} ignorada(s) por variação cambial (até ${data.fxTolerancePct}%)` : ""}`,
        );
      } else {
        setRepairPreview(null);
        toast.success(`${data.fixed} baixa(s) cancelada(s) e devolvida(s) à fila${data.failed ? ` · ${data.failed} falha(s)` : ""}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reparar as baixas");
    } finally {
      setRepairing(false);
    }
  }, [repairPreview]);


  const run = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pagcorp-settlement-audit", {
        body: { companyDbs: ["SBO_ANAGAMING", "SBO_CACTUS"], limit: 300 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha na auditoria");
      setFindings((data.findings || []) as AuditFinding[]);
      setErrors(data.errors || []);
      setRan(true);
      toast.success(`${data.withIssues} de ${data.total} baixas com divergência`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível auditar as baixas");
    } finally {
      setLoading(false);
    }
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (onlyIssues && f.issues.length === 0) return false;
      if (!q) return true;
      return (
        String(f.paymentDocNum || "").includes(q) ||
        String(f.invoiceDocNum || "").includes(q) ||
        (f.cardName || "").toLowerCase().includes(q) ||
        f.transactions.some((t) => String(t.pagcorpExpenseId).includes(q))
      );
    });
  }, [findings, search, onlyIssues]);

  const criticalCount = useMemo(
    () => findings.filter((f) => f.issues.some((i) => CRITICAL.has(i))).length,
    [findings],
  );

  const exportCsv = useCallback(() => {
    const head = [
      "empresa", "baixa_docnum", "baixa_docentry", "data", "fornecedor",
      "valor_transferido", "aplicado_na_nf", "esperado_pagcorp", "diferenca",
      "nf_docnum", "nf_total", "nf_pago", "transacoes_pagcorp", "ocorrencias",
    ];
    const lines = visible.map((f) => [
      f.companyDb, f.paymentDocNum ?? "", f.paymentDocEntry, dateBr(f.paymentDate),
      (f.cardName || "").replace(/;/g, ","), f.transferSum, f.appliedToInvoice,
      f.expectedFromPagcorp, f.difference, f.invoiceDocNum ?? "", f.invoiceTotal ?? "",
      f.invoicePaid ?? "", f.transactions.map((t) => t.pagcorpExpenseId).join("|"),
      f.issues.map((i) => ISSUE_LABELS[i] || i).join("|"),
    ].join(";"));
    const blob = new Blob([[head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `baixas-pagcorp-auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [visible]);

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Auditoria de baixas PagCorp"
        description="Compara as baixas (pagamentos de fornecedor) criadas pelo ERP Flow com o valor das transações PagCorp e o total da NF no ERP. Somente leitura — nada é alterado."
      />

      <main className="container mx-auto px-4 py-6 space-y-4">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Auditoria e reparo controlado</AlertTitle>
          <AlertDescription>
            A auditoria é somente leitura. O reparo age exclusivamente em baixas criadas
            automaticamente pelo PagCorp com valor divergente: cancela o pagamento no ERP e devolve
            o lançamento à fila para ser refeito com o valor exato do pedido de compra / NF.
          </AlertDescription>

        </Alert>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={run} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Auditando…" : "Rodar auditoria"}
          </Button>
          <Button variant="outline" onClick={() => setOnlyIssues((v) => !v)} disabled={!ran}>
            {onlyIssues ? "Mostrar todas" : "Somente divergentes"}
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!visible.length}>
            <Download className="w-4 h-4 mr-2" /> Exportar CSV
          </Button>
          <Button variant="outline" onClick={() => runRepair(true)} disabled={repairing}>
            <Wrench className={`w-4 h-4 mr-2 ${repairing ? "animate-pulse" : ""}`} /> Simular reparo
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirmRepair(true)}
            disabled={repairing || !repairPreview?.length}
          >
            <Undo2 className="w-4 h-4 mr-2" /> Cancelar e refazer divergentes
          </Button>
          <Button variant="outline" onClick={() => runReset(true)} disabled={resetting}>
            <RefreshCw className={`w-4 h-4 mr-2 ${resetting ? "animate-spin" : ""}`} /> Verificar cancelamentos
          </Button>
          <Button
            variant="secondary"
            onClick={() => runReset(false)}
            disabled={resetting || !resetPreview?.cancelled.length}
          >
            <Undo2 className="w-4 h-4 mr-2" /> Limpar relacionamentos e refazer
          </Button>

          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por baixa, NF ou fornecedor"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {resetPreview && (
          <Alert>
            <RefreshCw className="h-4 w-4" />
            <AlertTitle>
              {resetPreview.cancelled.length} baixa(s) confirmada(s) como cancelada(s) no ERP
              {resetPreview.stillActive.length ? ` · ${resetPreview.stillActive.length} ainda ativa(s)` : ""}
            </AlertTitle>
            <AlertDescription className="space-y-1">
              {resetPreview.stillActive.slice(0, 10).map((a) => (
                <div key={`active-${a.companyDb}-${a.paymentDocEntry}`} className="text-xs font-mono">
                  ainda ativa: {a.companyDb} · baixa {a.paymentDocNum ?? a.paymentDocEntry}
                </div>
              ))}
              {resetPreview.cancelled.slice(0, 10).map((a) => (
                <div key={`cancel-${a.companyDb}-${a.paymentDocEntry}`} className="text-xs font-mono">
                  cancelada: {a.companyDb} · baixa {a.paymentDocNum ?? a.paymentDocEntry}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {repairPreview && (

          <Alert variant={repairPreview.length ? "destructive" : "default"}>
            <Wrench className="h-4 w-4" />
            <AlertTitle>
              {repairPreview.length
                ? `${repairPreview.length} baixa(s) automática(s) do PagCorp com divergência`
                : "Nenhuma baixa divergente para reparar"}
            </AlertTitle>
            <AlertDescription className="space-y-1">
              {repairPreview.slice(0, 12).map((a) => (
                <div key={`${a.companyDb}-${a.paymentDocEntry}`} className="text-xs font-mono">
                  {a.companyDb} · baixa {a.paymentDocNum ?? a.paymentDocEntry} · aplicado {money(a.applied ?? 0)} ×
                  esperado {money(a.expected ?? 0)}
                </div>
              ))}
              {repairPreview.length > 12 && (
                <div className="text-xs">e mais {repairPreview.length - 12}…</div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Bases não auditadas</AlertTitle>
            <AlertDescription>
              {errors.map((e) => `${e.companyDb}: ${e.message}`).join(" · ")}
            </AlertDescription>
          </Alert>
        )}

        {ran && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Baixas analisadas</p>
              <p className="text-2xl font-semibold">{findings.length}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Com divergência</p>
              <p className="text-2xl font-semibold">{findings.filter((f) => f.issues.length).length}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Críticas</p>
              <p className="text-2xl font-semibold text-destructive">{criticalCount}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Exibindo</p>
              <p className="text-2xl font-semibold">{visible.length}</p>
            </Card>
          </div>
        )}

        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Baixa</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Transferido</TableHead>
                <TableHead className="text-right">Aplicado na NF</TableHead>
                <TableHead className="text-right">Esperado (PagCorp)</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
                <TableHead>NF</TableHead>
                <TableHead>Ocorrências</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!ran && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-10">
                    Clique em “Rodar auditoria” para comparar as baixas do PagCorp com o ERP.
                  </TableCell>
                </TableRow>
              )}
              {ran && visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-10">
                    Nenhuma baixa divergente encontrada.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((f) => (
                <TableRow key={`${f.companyDb}-${f.paymentDocEntry}`}>
                  <TableCell className="text-xs">{f.companyDb}</TableCell>
                  <TableCell className="font-medium">{f.paymentDocNum ?? f.paymentDocEntry}</TableCell>
                  <TableCell className="text-xs">{dateBr(f.paymentDate)}</TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate">{f.cardName || "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(f.transferSum)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(f.appliedToInvoice)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(f.expectedFromPagcorp)}</TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${Math.abs(f.difference) > 0.05 ? "text-destructive font-semibold" : ""}`}
                  >
                    {money(f.difference)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {f.invoiceDocNum ?? "—"}
                    {f.invoiceTotal !== null && (
                      <span className="block text-[10px] text-muted-foreground font-mono">
                        {money(f.invoiceTotal)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {f.issues.length === 0 && (
                        <Badge variant="outline" className="text-[10px]">OK</Badge>
                      )}
                      {f.issues.map((i) => (
                        <Badge
                          key={i}
                          variant={CRITICAL.has(i) ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {ISSUE_LABELS[i] || i}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </main>

      <AlertDialog open={confirmRepair} onOpenChange={setConfirmRepair}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar baixas divergentes no ERP?</AlertDialogTitle>
            <AlertDialogDescription>
              Serão canceladas {repairPreview?.length ?? 0} baixa(s) criada(s) automaticamente pelo
              PagCorp cujo valor difere da transação de origem. Cada lançamento volta para a fila de
              baixa e será relançado com o valor exato do pedido de compra / NF. Documentos lançados
              manualmente no ERP não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRepair(false);
                void runRepair(false);
              }}
            >
              Cancelar e refazer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
