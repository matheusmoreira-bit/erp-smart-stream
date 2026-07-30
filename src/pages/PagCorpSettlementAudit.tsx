import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, ShieldCheck, Search, Download } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";

interface AuditTx {
  logId: string;
  pagcorpExpenseId: number;
  amount: number;
  currency: string;
  ptax: number | null;
  expectedLocal: number | null;
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
          <AlertTitle>Modo somente leitura</AlertTitle>
          <AlertDescription>
            Esta tela não cancela nem altera documentos no ERP. Ela apenas lista as baixas
            geradas pela automação para revisão manual e exportação.
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
    </div>
  );
}
