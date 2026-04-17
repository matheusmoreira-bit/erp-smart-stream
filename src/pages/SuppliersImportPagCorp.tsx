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
  LogOut,
  Ban,
  Link2,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { useSuppliers } from "@/hooks/useSuppliers";
import {
  useImportPagCorpSuppliers,
  type PagCorpCandidate,
} from "@/hooks/useImportPagCorpSuppliers";
import { PagCorpCandidateRow } from "@/components/PagCorpCandidateRow";

const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "15", label: "Últimos 15 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "60", label: "Últimos 60 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "180", label: "Últimos 180 dias" },
];

export default function SuppliersImportPagCorp() {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { getLabel } = useCompanies(true);
  const { suppliers, refresh: refreshSuppliers } = useSuppliers(session?.companyDB);
  const { candidates, progress, scanning, error, scan, setCandidates } =
    useImportPagCorpSuppliers(session?.companyDB, suppliers);

  const [days, setDays] = useState<string>("30");

  // Auto-scan on mount once suppliers are loaded
  const [scanned, setScanned] = useState(false);
  useEffect(() => {
    if (!scanned && session?.companyDB && suppliers.length > 0) {
      setScanned(true);
      void scan(Number(days));
    }
  }, [scanned, session?.companyDB, suppliers.length, scan, days]);

  const handleRescan = () => {
    setCandidates([]);
    void scan(Number(days));
  };

  const updateCandidate = (key: string, patch: Partial<PagCorpCandidate>) => {
    setCandidates((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  const companyLabel = getLabel(session?.companyDB || "");

  const stats = useMemo(() => {
    let pending = 0;
    let imported = 0;
    let linked = 0;
    let ignored = 0;
    let existing = 0;
    let failed = 0;
    for (const c of candidates) {
      if (c.aiFailed) failed++;
      else if (c.savedResolution === "imported") imported++;
      else if (c.savedResolution === "linked") linked++;
      else if (c.savedResolution === "ignored") ignored++;
      else if (c.existing) existing++;
      else pending++;
    }
    return { pending, imported, linked, ignored, existing, failed };
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
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <Badge variant="outline" className="gap-1">
              <Sparkles className="w-3 h-3" />
              {stats.pending} pendentes
            </Badge>
            <Badge className="gap-1 bg-success/20 text-success hover:bg-success/30 border-success/30">
              <Download className="w-3 h-3" />
              {stats.imported} importados
            </Badge>
            <Badge className="gap-1 bg-primary/20 text-primary hover:bg-primary/30 border-primary/30">
              <Link2 className="w-3 h-3" />
              {stats.linked} vinculados
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Ban className="w-3 h-3" />
              {stats.ignored} ignorados
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {stats.existing} já cadastrados
            </Badge>
            {stats.failed > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="w-3 h-3" />
                {stats.failed} sem extração
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleRescan}
              disabled={scanning}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
              Rescanear
            </Button>
          </div>
        </div>
        {scanning && progress && (
          <div className="max-w-7xl mx-auto mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>
                {progress.stage === "fetching"
                  ? "Buscando transações no PagCorp…"
                  : `Analisando documento ${progress.current}/${progress.total} com IA…`}
              </span>
            </div>
            <Progress
              value={
                progress.total > 0 ? (progress.current / progress.total) * 100 : 5
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
                <TableHead>Fornecedor extraído</TableHead>
                <TableHead>CNPJ/CPF</TableHead>
                <TableHead>Origem (transação)</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.length === 0 && !scanning ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    {scanned
                      ? "Nenhum candidato encontrado nos últimos 30 dias."
                      : "Aguardando carregamento dos fornecedores…"}
                  </TableCell>
                </TableRow>
              ) : scanning && candidates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Processando…
                  </TableCell>
                </TableRow>
              ) : (
                candidates.map((c) => (
                  <PagCorpCandidateRow
                    key={c.key}
                    candidate={c}
                    onResolved={updateCandidate}
                    onRefreshSuppliers={refreshSuppliers}
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
