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
  Calendar,
  Filter,
  DollarSign,
  User,
  CheckCircle2,
  XCircle,
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
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { usePagCorp, type PagCorpTransaction } from "@/hooks/usePagCorp";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
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
          (t.cardHolder || "").toLowerCase().includes(q) ||
          (t.merchantName || "").toLowerCase().includes(q) ||
          (t.category || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [transactions, search, accountabilityFilter]);

  const totalAmount = useMemo(
    () => filteredTransactions.reduce((sum, t) => sum + (t.amount || 0), 0),
    [filteredTransactions]
  );

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
                placeholder="Descrição, portador, estabelecimento..."
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
              <p className="text-xl font-bold text-foreground">{formatCurrency(totalAmount)}</p>
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
                    <TableHead className="text-muted-foreground">Estabelecimento</TableHead>
                    <TableHead className="text-muted-foreground">Categoria</TableHead>
                    <TableHead className="text-muted-foreground text-right">Valor</TableHead>
                    <TableHead className="text-muted-foreground text-center">Prestação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((t) => (
                    <TableRow key={t.id} className="border-border">
                      <TableCell className="text-sm text-foreground whitespace-nowrap">
                        {formatDate(t.date)}
                      </TableCell>
                      <TableCell className="text-sm text-foreground max-w-[250px] truncate">
                        {t.description}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.cardHolder || "—"}
                        {t.cardLastDigits && (
                          <span className="ml-1 text-xs opacity-60">•••{t.cardLastDigits}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.merchantName || "—"}</TableCell>
                      <TableCell>
                        {t.category ? (
                          <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-right text-foreground">
                        {formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.hasAccountability ? (
                          <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive/60 mx-auto" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
