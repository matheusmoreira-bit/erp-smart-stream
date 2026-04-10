import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  RefreshCw,
  ArrowLeft,
  Search,
  Activity,
  LogOut,
  Loader2,
  DollarSign,
  CheckCircle2,
  XCircle,
  MapPin,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { usePagCorp, type PagCorpTransaction } from "@/hooks/usePagCorp";
import { toast } from "sonner";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function PagCorp() {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { transactions, isLoading, error, fetchTransactions } = usePagCorp();

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [accountabilityFilter, setAccountabilityFilter] = useState<"all" | "yes" | "no">("all");
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; transaction: PagCorpTransaction | null }>({
    open: false,
    transaction: null,
  });
  const [integrating, setIntegrating] = useState<string | number | null>(null);

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    if (value && endDate) {
      const start = new Date(value);
      const end = new Date(endDate);
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 30) {
        const maxEnd = new Date(start);
        maxEnd.setDate(maxEnd.getDate() + 30);
        setEndDate(maxEnd.toISOString().slice(0, 10));
      }
      if (diffDays < 0) {
        setEndDate(value);
      }
    }
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    if (value && startDate) {
      const start = new Date(startDate);
      const end = new Date(value);
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 30) {
        const minStart = new Date(end);
        minStart.setDate(minStart.getDate() - 30);
        setStartDate(minStart.toISOString().slice(0, 10));
      }
      if (diffDays < 0) {
        setStartDate(value);
      }
    }
  };

  useEffect(() => {
    fetchTransactions(startDate, endDate);
  }, []);

  const handleRefresh = () => fetchTransactions(startDate, endDate);

  const filteredTransactions = useMemo(() => {
    let list = transactions;

    if (accountabilityFilter === "yes") {
      list = list.filter((t) => t.hasAccountability);
    } else if (accountabilityFilter === "no") {
      list = list.filter((t) => !t.hasAccountability);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          (t.accountName || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [transactions, search, accountabilityFilter]);

  // Group totals by currency
  const totalsByCurrency = useMemo(() => {
    const map: Record<string, number> = {};
    filteredTransactions.forEach((t) => {
      const cur = t.currency || "BRL";
      map[cur] = (map[cur] || 0) + (t.amount || 0);
    });
    return map;
  }, [filteredTransactions]);

  const handleValidateAndIntegrate = async (t: PagCorpTransaction) => {
    setIntegrating(t.id);
    // TODO: Call AI validation edge function with attachments, then integrate to SAP
    toast.info("Validação com IA e integração SAP em desenvolvimento.");
    setIntegrating(null);
  };

  const handleIntegrateGeneric = (t: PagCorpTransaction) => {
    setConfirmDialog({ open: true, transaction: t });
  };

  const confirmGenericIntegration = async () => {
    const t = confirmDialog.transaction;
    if (!t) return;
    setIntegrating(t.id);
    setConfirmDialog({ open: false, transaction: null });
    // TODO: Call SAP integration with generic item
    toast.info("Integração SAP com item genérico em desenvolvimento.");
    setIntegrating(null);
  };

  const COMPANY_LABELS: Record<string, string> = {
    SBO_ANAGAMING: "ANA Gaming",
    SBO_CACTUS: "Cactus",
    SBO_INSTITUTO_ANA: "Instituto Cactus",
  };
  const companyLabel = COMPANY_LABELS[session?.companyDB || ""] || session?.companyDB;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <CreditCard className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                PagCorp <span className="text-gradient">Transações</span>
              </h1>
              <p className="text-xs text-muted-foreground">Cartões corporativos</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => navigate("/pagcorp/mapping")} className="gap-2">
              <MapPin className="w-4 h-4" /> Mapeamento
            </Button>
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{companyLabel}</p>
              <p className="text-xs text-muted-foreground">{session?.userName}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
              Conectado
            </div>
            <button onClick={logout} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Início</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40 bg-card" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Fim</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40 bg-card" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Prestação de Conta</label>
            <Select value={accountabilityFilter} onValueChange={(v) => setAccountabilityFilter(v as "all" | "yes" | "no")}>
              <SelectTrigger className="w-44 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="yes">Com prestação</SelectItem>
                <SelectItem value="no">Sem prestação</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Descrição, portador..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>
          </div>
          <Button onClick={handleRefresh} disabled={isLoading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Buscar
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="px-6 py-4">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CreditCard className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Transações</p>
              <p className="text-xl font-bold text-foreground">{filteredTransactions.length}</p>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <DollarSign className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Valor Total</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(totalsByCurrency).map(([cur, total]) => (
                  <p key={cur} className="text-lg font-bold text-foreground">{formatCurrency(total, cur)}</p>
                ))}
                {Object.keys(totalsByCurrency).length === 0 && (
                  <p className="text-lg font-bold text-foreground">{formatCurrency(0)}</p>
                )}
              </div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sem Prestação</p>
              <p className="text-xl font-bold text-foreground">
                {transactions.filter((t) => !t.hasAccountability).length}
              </p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Table */}
      <main className="flex-1 px-6 pb-8">
        <div className="max-w-7xl mx-auto">
          {error && (
            <div className="glass-card p-4 mb-4 border-destructive/30 text-destructive text-sm">{error}</div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">Nenhuma transação encontrada</p>
              <p className="text-sm mt-1">Ajuste os filtros ou clique em Buscar</p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Data</TableHead>
                    <TableHead className="text-muted-foreground">Descrição</TableHead>
                    <TableHead className="text-muted-foreground">Portador</TableHead>
                    <TableHead className="text-muted-foreground text-right">Valor</TableHead>
                    <TableHead className="text-muted-foreground text-center">Prestação</TableHead>
                    <TableHead className="text-muted-foreground text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((t) => {
                    const hasAttachments = t.hasAccountability && Array.isArray(t.attachments) && t.attachments.length > 0;

                    return (
                      <TableRow key={t.id} className="border-border">
                        <TableCell className="text-sm text-foreground whitespace-nowrap">
                          {formatDate(t.date)}
                        </TableCell>
                        <TableCell className="text-sm text-foreground max-w-[250px] truncate">
                          {t.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.accountName || "—"}
                          {t.cardLastDigits && (
                            <span className="ml-1 text-xs opacity-60">•••{t.cardLastDigits}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-right text-foreground whitespace-nowrap">
                          {formatCurrency(t.amount, t.currency)}
                        </TableCell>
                        <TableCell className="text-center">
                          {t.hasAccountability ? (
                            <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                          ) : (
                            <XCircle className="w-4 h-4 text-destructive/60 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {integrating === t.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" />
                          ) : t.hasAccountability ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() => handleValidateAndIntegrate(t)}
                            >
                              <Sparkles className="w-3 h-3" />
                              Validar IA + SAP
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() => handleIntegrateGeneric(t)}
                            >
                              <Upload className="w-3 h-3" />
                              Integrar SAP
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </main>

      {/* Confirm Generic Integration Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ open: false, transaction: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Integrar ao SAP sem prestação de contas</DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <p>
                Esta transação <strong>não possui prestação de contas</strong>. Ao integrar ao SAP:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Será utilizado um <strong>item genérico de despesa de cartão corporativo</strong></li>
                <li>Fornecedor: <strong>ANA Gaming</strong> (caso não seja identificado um fornecedor melhor)</li>
                <li>Centro de Custo e Projeto serão atribuídos conforme o <strong>mapeamento de contas</strong> configurado</li>
              </ul>
              <p className="text-sm font-medium pt-2">Deseja continuar?</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog({ open: false, transaction: null })}>
              Cancelar
            </Button>
            <Button onClick={confirmGenericIntegration}>
              Confirmar Integração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
