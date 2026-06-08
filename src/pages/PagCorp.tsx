import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  RefreshCw,
  ArrowLeft,
  Search,
  LogOut,
  Loader2,
  DollarSign,
  CheckCircle2,
  XCircle,
  MapPin,
  Sparkles,
  Upload,
  Clock,
  History,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeToggle } from "@/components/ThemeToggle";
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
import { useCredentials } from "@/hooks/useCredentials";
import { toast } from "sonner";
import { useCompanies } from "@/hooks/useCompanies";
import { PagCorpIntegrateDialog } from "@/components/PagCorpIntegrateDialog";
import { CreateExpenseModal } from "@/components/CreateExpenseModal";
import { useExpenses } from "@/hooks/useExpenses";
import { supabase } from "@/integrations/supabase/client";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

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
  const { transactions, isLoading, error, fetchTransactions, integrateDirect, logIntegration } = usePagCorp();
  const { createExpense } = useExpenses();
  const { credentials, fetchCredentials } = useCredentials();
  const { getLabel } = useCompanies(true);

  useEffect(() => { fetchCredentials(session?.companyDB, "sap"); }, [fetchCredentials, session?.companyDB]);

  const hasSapCredentials = credentials.some((c) => c.system_name === "sap" && c.company_db === session?.companyDB);

  const checkSapCredentials = (): boolean => {
    if (!hasSapCredentials) {
      toast.error("Credencial SAP B1 não cadastrada", {
        description: "Configure as credenciais do SAP Business One na tela de Credenciais antes de integrar.",
        action: { label: "Configurar", onClick: () => navigate("/credentials") },
      });
      return false;
    }
    return true;
  };

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [accountabilityFilter, setAccountabilityFilter] = useState<"all" | "yes" | "no">("all");
  const [integrateDialog, setIntegrateDialog] = useState<{
    open: boolean;
    tx: PagCorpTransaction | null;
    type: "generic" | "accountability";
  }>({ open: false, tx: null, type: "generic" });
  const [accountabilityModal, setAccountabilityModal] = useState<{
    open: boolean;
    tx: PagCorpTransaction | null;
  }>({ open: false, tx: null });
  const [integrating, setIntegrating] = useState<string | number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [batchQueue, setBatchQueue] = useState<PagCorpTransaction[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchActive, setBatchActive] = useState(false);
  // True when modal close is programmatic (after success), so we don't cancel the batch
  const programmaticCloseRef = useRef(false);

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
    fetchTransactions(startDate, endDate, session?.companyDB);
  }, []);

  const handleRefresh = () => fetchTransactions(startDate, endDate, session?.companyDB);

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

  const openIntegrateDialog = (t: PagCorpTransaction, type: "generic" | "accountability") => {
    if (!checkSapCredentials()) return;
    if (type === "accountability") {
      setAccountabilityModal({ open: true, tx: t });
    } else {
      setIntegrateDialog({ open: true, tx: t, type });
    }
  };

  const toggleSelect = (id: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectableTransactions = useMemo(
    () => filteredTransactions.filter((t) => !t.integrated),
    [filteredTransactions],
  );

  const allSelected =
    selectableTransactions.length > 0 &&
    selectableTransactions.every((t) => selectedIds.has(t.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableTransactions.map((t) => t.id)));
    }
  };

  const openBatchItem = (t: PagCorpTransaction) => {
    if (t.hasAccountability) {
      setAccountabilityModal({ open: true, tx: t });
    } else {
      setIntegrateDialog({ open: true, tx: t, type: "generic" });
    }
  };

  const startBatch = () => {
    if (!checkSapCredentials()) return;
    const queue = selectableTransactions.filter((t) => selectedIds.has(t.id));
    if (queue.length === 0) {
      toast.info("Selecione ao menos uma transação");
      return;
    }
    setBatchQueue(queue);
    setBatchIndex(0);
    setBatchActive(true);
    openBatchItem(queue[0]);
  };

  const advanceBatch = () => {
    const next = batchIndex + 1;
    if (next >= batchQueue.length) {
      setBatchActive(false);
      setBatchQueue([]);
      setBatchIndex(0);
      setSelectedIds(new Set());
      toast.success("Lote concluído");
      return;
    }
    setBatchIndex(next);
    // Delay reopening so Radix Dialog can finish its close animation/state
    // before mounting the next one. Without this, the second modal silently
    // fails to open because the previous instance is still tearing down.
    setTimeout(() => openBatchItem(batchQueue[next]), 350);
  };

  const cancelBatch = () => {
    setBatchActive(false);
    setBatchQueue([]);
    setBatchIndex(0);
  };

  const handleConfirmIntegrate = async (supplier: SapSearchOption) => {
    const t = integrateDialog.tx;
    if (!t || !session?.companyDB) return;
    setIntegrating(t.id);
    programmaticCloseRef.current = true;
    setIntegrateDialog({ open: false, tx: null, type: "generic" });
    try {
      const result = await integrateDirect(
        t,
        integrateDialog.type,
        session.companyDB,
        supplier.code,
        supplier.name,
        session.userName || undefined,
      );
      if (result.alreadyIntegrated) {
        toast.info("Transação já estava integrada no SAP", {
          description: `DocNum #${result.docNum}`,
        });
      } else {
        toast.success("Pedido de Compra criado no SAP", {
          description: `PC #${result.purchaseOrder?.DocNum}`,
        });
      }
      await fetchTransactions(startDate, endDate, session.companyDB);
      if (batchActive) advanceBatch();
    } catch (e) {
      toast.error("Falha na integração", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
        action: { label: "Ver histórico", onClick: () => navigate("/pagcorp/history") },
      });
      if (batchActive) advanceBatch();
    } finally {
      setIntegrating(null);
    }
  };

  /**
   * Accountability flow: opens the same form as a manual expense (items, cost
   * centers, projects, attachments) and creates an internal expense with origin
   * "pagcorp", skipping approval rules. SAP integration runs immediately, and we
   * write a row into pagcorp_integration_log so the transaction shows as
   * integrated in the PagCorp list and history.
   */
  const handleCreateAccountabilityExpense = async (input: any) => {
    const t = accountabilityModal.tx;
    if (!t || !session?.companyDB) return;
    setIntegrating(t.id);
    try {
      const { expense } = await createExpense({
        ...input,
        origin: "pagcorp",
        skipRules: true,
        initialStatus: "aprovado",
      });

      // Trigger SAP integration immediately
      let sapDocEntry: number | undefined;
      let sapDocNum: number | undefined;
      let sapError: string | undefined;
      let sapPayloadFromFn: any = null;
      let sapResponseFromFn: any = null;
      try {
        const { data, error: fnErr } = await invokeFn("expense-to-sap", {
          body: { expense_id: (expense as any).id },
        });
        if (fnErr) throw fnErr;
        sapPayloadFromFn = data?.sapPayload ?? null;
        sapResponseFromFn = data?.sapResponse ?? null;
        if (data && data.success === false) throw new Error(data.error || "Falha ao integrar no SAP");
        sapDocEntry = data?.docEntry;
        sapDocNum = data?.docNum;
      } catch (sapErr) {
        sapError = sapErr instanceof Error ? sapErr.message : "Erro SAP desconhecido";
      }

      // Log into pagcorp_integration_log so the list reflects integrated state.
      // Persist the real payload sent to SAP (returned by the edge function) so
      // the History screen can display it instead of just the expense_id.
      await logIntegration(
        t,
        "accountability",
        sapError ? "error" : "success",
        session.companyDB,
        session.userName || undefined,
        sapDocEntry,
        sapDocNum,
        sapError,
        sapPayloadFromFn ?? { expense_id: (expense as any).id },
        sapResponseFromFn ?? undefined,
      );

      if (sapError) throw new Error(sapError);

      toast.success("Despesa criada e integrada no SAP", {
        description: sapDocNum ? `PC #${sapDocNum}` : undefined,
      });
      programmaticCloseRef.current = true;
      setAccountabilityModal({ open: false, tx: null });
      await fetchTransactions(startDate, endDate, session.companyDB);
      if (batchActive) advanceBatch();
      return { expense };
    } catch (e) {
      toast.error("Falha ao integrar prestação", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
        action: { label: "Ver histórico", onClick: () => navigate("/pagcorp/history") },
      });
      throw e;
    } finally {
      setIntegrating(null);
    }
  };

  const companyLabel = getLabel(session?.companyDB || "");

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
            <Button variant="outline" size="sm" onClick={() => navigate("/pagcorp/history")} className="gap-2">
              <History className="w-4 h-4" /> Histórico
            </Button>
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
            <ThemeToggle />
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
            <Input type="date" value={startDate} onChange={(e) => handleStartDateChange(e.target.value)} className="w-40 bg-card" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Fim</label>
            <Input type="date" value={endDate} onChange={(e) => handleEndDateChange(e.target.value)} className="w-40 bg-card" />
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
          <Button
            onClick={startBatch}
            disabled={selectedIds.size === 0 || batchActive}
            variant="secondary"
            className="gap-2"
          >
            <Layers className="w-4 h-4" />
            Integrar em lote{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
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
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Selecionar todas"
                      />
                    </TableHead>
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
                    const isSelected = selectedIds.has(t.id);

                    return (
                      <TableRow key={t.id} className="border-border" data-state={isSelected ? "selected" : undefined}>
                        <TableCell className="w-10">
                          {!t.integrated && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(t.id)}
                              aria-label="Selecionar"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-foreground whitespace-nowrap">
                          {formatDate(t.date)}
                        </TableCell>
                        <TableCell className="text-sm text-foreground max-w-[250px] truncate">
                          {t.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.accountAlias || t.accountName || "—"}
                          {t.cardLastDigits && (
                            <span className="ml-1 text-xs opacity-60">•••{t.cardLastDigits}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-right text-foreground whitespace-nowrap">
                          {formatCurrency(t.amount, t.currency)}
                        </TableCell>
                        <TableCell className="text-center">
                          {t.hasAccountability ? (
                            t.accountabilityApproved ? (
                              <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                            ) : (
                              <Clock className="w-4 h-4 text-warning mx-auto" />
                            )
                          ) : (
                            <XCircle className="w-4 h-4 text-destructive/60 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {t.integrated ? (
                            <Badge variant="secondary" className="bg-success/20 text-success border-success/30 font-semibold text-xs">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Integrado
                            </Badge>
                          ) : integrating === t.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" />
                          ) : t.hasAccountability ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() => openIntegrateDialog(t, "accountability")}
                            >
                              <Sparkles className="w-3 h-3" />
                              Integrar (Prest.)
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() => openIntegrateDialog(t, "generic")}
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

      {batchActive && (
        <div className="fixed bottom-4 right-4 z-40 glass-card px-4 py-3 flex items-center gap-3 shadow-lg border border-primary/30">
          <Layers className="w-4 h-4 text-primary" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              Lote em andamento: {batchIndex + 1} / {batchQueue.length}
            </p>
            <p className="text-xs text-muted-foreground">
              Cancelar a despesa atual encerra o lote
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={cancelBatch}>
            Encerrar
          </Button>
        </div>
      )}

      <PagCorpIntegrateDialog
        open={integrateDialog.open}
        onClose={() => {
          const wasProgrammatic = programmaticCloseRef.current;
          programmaticCloseRef.current = false;
          setIntegrateDialog({ open: false, tx: null, type: "generic" });
          if (batchActive && !wasProgrammatic) cancelBatch();
        }}
        transaction={integrateDialog.tx}
        integrationType={integrateDialog.type}
        companyDb={session?.companyDB}
        onConfirm={handleConfirmIntegrate}
      />

      <CreateExpenseModal
        open={accountabilityModal.open}
        onClose={() => {
          const wasProgrammatic = programmaticCloseRef.current;
          programmaticCloseRef.current = false;
          setAccountabilityModal({ open: false, tx: null });
          if (batchActive && !wasProgrammatic) cancelBatch();
        }}
        onCreate={handleCreateAccountabilityExpense}
        sapSession={session}
        title="Integrar Prestação de Conta"
        origin="pagcorp"
        skipRules
        prefill={
          accountabilityModal.tx
            ? {
                description: accountabilityModal.tx.description,
                amount: accountabilityModal.tx.amount,
                currency: accountabilityModal.tx.currency,
                accountAlias: accountabilityModal.tx.accountAlias,
                receipts: accountabilityModal.tx.receipts,
                triggerAI: true,
              }
            : undefined
        }
      />
    </div>
  );
}
