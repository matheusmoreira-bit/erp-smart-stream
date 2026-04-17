import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { useSuppliers, createSupplier } from "@/hooks/useSuppliers";
import {
  useImportPagCorpSuppliers,
  type PagCorpCandidate,
} from "@/hooks/useImportPagCorpSuppliers";

function formatCurrency(value: number, currency: string = "BRL") {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "BRL",
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function formatDate(d: string) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

export default function SuppliersImportPagCorp() {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { getLabel } = useCompanies(true);
  const { suppliers, refresh: refreshSuppliers } = useSuppliers(session?.companyDB);
  const { candidates, progress, scanning, error, scan, setCandidates } =
    useImportPagCorpSuppliers(session?.companyDB, suppliers);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  // Auto-scan on mount once suppliers are loaded
  const [scanned, setScanned] = useState(false);
  useEffect(() => {
    if (!scanned && session?.companyDB && suppliers.length > 0) {
      setScanned(true);
      void scan();
    }
  }, [scanned, session?.companyDB, suppliers.length, scan]);

  const importable = useMemo(
    () => candidates.filter((c) => !c.existing && !c.aiFailed),
    [candidates],
  );

  const allSelected =
    importable.length > 0 && importable.every((c) => selected.has(c.key));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(importable.map((c) => c.key)));
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRescan = () => {
    setSelected(new Set());
    setCandidates([]);
    void scan();
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    const list = importable.filter((c) => selected.has(c.key));
    setImporting(true);
    setImportProgress({ done: 0, total: list.length });
    let success = 0;
    let failed = 0;

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      try {
        await createSupplier(
          {
            company_db: session?.companyDB || null,
            card_code: null,
            card_name: c.card_name,
            card_type: "S",
            federal_tax_id: c.federal_tax_id,
            u_fgr_taxid0: c.federal_tax_id,
            email: c.email || null,
            phone1: c.phone1 || null,
            phone2: c.phone2 || null,
            currency: "BRL",
            bill_to_street: c.bill_to_street || null,
            bill_to_zip: c.bill_to_zip || null,
            bill_to_city: c.bill_to_city || null,
            bill_to_state: c.bill_to_state || null,
            bill_to_country: "BR",
            bill_to_block: c.bill_to_block || null,
            bill_to_building: c.bill_to_building || null,
            is_active: true,
            source: "pagcorp_import",
          },
          session,
        );
        success++;
      } catch (e) {
        failed++;
        console.error("Failed importing supplier", c.card_name, e);
      }
      setImportProgress({ done: i + 1, total: list.length });
    }

    setImporting(false);
    if (success > 0) {
      toast.success(`${success} fornecedor(es) importado(s)`, {
        description: failed > 0 ? `${failed} falharam.` : undefined,
      });
    }
    if (failed > 0 && success === 0) {
      toast.error(`Falha ao importar ${failed} fornecedor(es)`);
    }
    await refreshSuppliers();
    setSelected(new Set());
    setScanned(false); // allow rescan with refreshed dedup
  };

  const companyLabel = getLabel(session?.companyDB || "");

  const stats = useMemo(() => {
    const newCount = candidates.filter((c) => !c.existing && !c.aiFailed).length;
    const existCount = candidates.filter((c) => c.existing).length;
    const failCount = candidates.filter((c) => c.aiFailed).length;
    return { newCount, existCount, failCount };
  }, [candidates]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/suppliers")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Importar Fornecedores do PagCorp
              </h1>
              <p className="text-xs text-muted-foreground">
                Prestações de contas dos últimos 30 dias
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{companyLabel}</p>
              <p className="text-xs text-muted-foreground">{session?.userName}</p>
            </div>
            <ThemeToggle />
            <button
              onClick={logout}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="outline" className="gap-1">
              <Sparkles className="w-3 h-3" />
              {stats.newCount} novos
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {stats.existCount} já existem
            </Badge>
            {stats.failCount > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="w-3 h-3" />
                {stats.failCount} sem extração
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleRescan}
              disabled={scanning || importing}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
              Rescanear
            </Button>
            <Button
              onClick={handleImport}
              disabled={selected.size === 0 || importing || scanning}
              className="gap-2"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Importar selecionados ({selected.size})
            </Button>
          </div>
        </div>
        {(scanning || importing) && progress && (
          <div className="max-w-7xl mx-auto mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>
                {importing
                  ? `Importando ${importProgress.done}/${importProgress.total}…`
                  : progress.stage === "fetching"
                    ? "Buscando transações no PagCorp…"
                    : `Analisando documento ${progress.current}/${progress.total} com IA…`}
              </span>
            </div>
            <Progress
              value={
                importing
                  ? (importProgress.done / Math.max(1, importProgress.total)) * 100
                  : progress.total > 0
                    ? (progress.current / progress.total) * 100
                    : 5
              }
            />
          </div>
        )}
        {error && (
          <div className="max-w-7xl mx-auto mt-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
      </div>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    disabled={importable.length === 0}
                  />
                </TableHead>
                <TableHead>Fornecedor extraído</TableHead>
                <TableHead>CNPJ/CPF</TableHead>
                <TableHead>Origem (transação)</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.length === 0 && !scanning ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    Nenhum candidato. Clique em "Rescanear" para buscar.
                  </TableCell>
                </TableRow>
              ) : (
                candidates.map((c) => (
                  <CandidateRow
                    key={c.key}
                    candidate={c}
                    selected={selected.has(c.key)}
                    onToggle={() => toggle(c.key)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}

function CandidateRow({
  candidate: c,
  selected,
  onToggle,
}: {
  candidate: PagCorpCandidate;
  selected: boolean;
  onToggle: () => void;
}) {
  const disabled = c.existing || c.aiFailed;
  return (
    <TableRow className={disabled ? "opacity-60" : ""}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={disabled}
        />
      </TableCell>
      <TableCell className="font-medium">{c.card_name}</TableCell>
      <TableCell className="font-mono text-xs">
        {c.federal_tax_id || "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <div className="line-clamp-1">{c.transactionDescription}</div>
        <div className="text-[10px]">{formatDate(c.transactionDate)}</div>
      </TableCell>
      <TableCell className="text-right text-xs">
        {formatCurrency(c.transactionAmount)}
      </TableCell>
      <TableCell>
        {c.aiFailed ? (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="w-3 h-3" />
            {c.aiError || "Sem extração"}
          </Badge>
        ) : c.existing ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Já cadastrado
            {c.existingMatch?.card_code ? ` (${c.existingMatch.card_code})` : ""}
          </Badge>
        ) : (
          <Badge className="gap-1 bg-success/20 text-success hover:bg-success/30 border-success/30">
            <Sparkles className="w-3 h-3" />
            Novo
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}
