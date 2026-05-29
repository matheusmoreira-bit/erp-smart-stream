import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import {
  Plus,
  RefreshCw,
  ArrowLeft,
  Search,
  Activity,
  LogOut,
  Loader2,
  Building2,
  User,
  Calendar,
  DollarSign,
  Send,
  X as XIcon,
  RotateCw,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";
import {
  useExpenses,
  STATUS_LABELS,
  STATUS_COLORS,
  type Expense,
} from "@/hooks/useExpenses";
import { CreateExpenseModal } from "@/components/CreateExpenseModal";
import { EditExpenseModal } from "@/components/EditExpenseModal";
import { useCompanies } from "@/hooks/useCompanies";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

/* ─── Detail Modal ─── */
function ExpenseDetailModal({
  expense,
  open,
  onClose,
  onSubmit,
  onCancel,
  onRetrySap,
  onEdit,
  canCancel,
  canEdit,
  canRetrySap,
  isSubmitting,
  isCancelling,
  isRetrying,
}: {
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (id: string) => void;
  onCancel: (id: string) => void;
  onRetrySap: (id: string) => void;
  onEdit: (expense: Expense) => void;
  canCancel: boolean;
  canEdit: boolean;
  canRetrySap: boolean;
  isSubmitting: boolean;
  isCancelling: boolean;
  isRetrying: boolean;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!expense) return null;

  const showSubmit = expense.status === "rascunho";
  const showCancel = canCancel && (expense.status === "rascunho" || expense.status === "pendente_aprovacao");
  const showEdit = canEdit && (expense.status === "rascunho" || expense.status === "pendente_aprovacao");
  const showRetrySap = canRetrySap && expense.status === "aprovado" && !expense.sap_doc_entry;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="text-foreground font-semibold">Despesa</span>
              <Badge className={STATUS_COLORS[expense.status]}>{STATUS_LABELS[expense.status]}</Badge>
              {expense.origin === "pagcorp" && (
                <Badge variant="outline" className="text-xs">PagCorp</Badge>
              )}
              <span className="text-2xl font-bold font-mono ml-auto">{formatCurrency(expense.total_amount, expense.currency)}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Fornecedor</p>
                <p className="text-foreground font-medium">{expense.supplier_name}</p>
                {expense.supplier_code && <p className="text-xs text-muted-foreground font-mono">{expense.supplier_code}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Solicitante</p>
                <p className="text-foreground font-medium">{expense.requester_name}</p>
              </div>
              {expense.cost_center && (
                <div>
                  <p className="text-xs text-muted-foreground">Centro de Custo</p>
                  <p className="text-foreground">{expense.cost_center}</p>
                </div>
              )}
              {expense.project && (
                <div>
                  <p className="text-xs text-muted-foreground">Projeto</p>
                  <p className="text-foreground">{expense.project}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Data de Criação</p>
                <p className="text-foreground">{formatDate(expense.created_at)}</p>
              </div>
              {expense.current_approver && (
                <div>
                  <p className="text-xs text-muted-foreground">Aprovador Atual</p>
                  <p className="text-foreground font-medium">{expense.current_approver}</p>
                </div>
              )}
            </div>

            {expense.remarks && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Observações</p>
                <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3">{expense.remarks}</p>
              </div>
            )}

            {expense.items && expense.items.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Itens</p>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="text-left py-2 px-3 text-muted-foreground">Descrição</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Qtd</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Preço Unit.</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expense.items.map((item, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-2 px-3 text-foreground">{item.description}</td>
                          <td className="py-2 px-3 text-right font-mono">{item.quantity}</td>
                          <td className="py-2 px-3 text-right font-mono">{formatCurrency(item.unit_price)}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium">{formatCurrency(item.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(showSubmit || showCancel || showRetrySap || showEdit) && (
              <div className="border-t border-border pt-4 flex justify-end gap-3 flex-wrap">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
                {showEdit && (
                  <Button
                    variant="outline"
                    onClick={() => onEdit(expense)}
                    className="gap-1.5"
                  >
                    <Pencil className="w-4 h-4" />
                    Editar
                  </Button>
                )}
                {showCancel && (
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmCancel(true)}
                    disabled={isCancelling}
                    className="gap-1.5"
                  >
                    {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XIcon className="w-4 h-4" />}
                    Cancelar Despesa
                  </Button>
                )}
                {showRetrySap && (
                  <Button
                    onClick={() => onRetrySap(expense.id)}
                    disabled={isRetrying}
                    className="gap-1.5"
                  >
                    {isRetrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                    Reintegrar no SAP
                  </Button>
                )}
                {showSubmit && (
                  <Button
                    onClick={() => onSubmit(expense.id)}
                    disabled={isSubmitting}
                    className="gap-1.5"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Enviar para Aprovação
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação marcará a despesa como cancelada e removerá da fila de aprovações. Não é possível desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmCancel(false); onCancel(expense.id); }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Sim, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── Expense Card ─── */
function ExpenseCard({ expense, onOpen }: { expense: Expense; onOpen: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 flex flex-col gap-3 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div>
          <Badge className={STATUS_COLORS[expense.status]}>{STATUS_LABELS[expense.status]}</Badge>
        </div>
        <p className="text-lg font-bold text-foreground font-mono">{formatCurrency(expense.total_amount, expense.currency)}</p>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="w-3.5 h-3.5 text-primary/70" />
          <span className="truncate">{expense.supplier_name}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <User className="w-3.5 h-3.5 text-primary/70" />
          <span>Solicitante: <span className="text-foreground font-medium">{expense.requester_name}</span></span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5 text-primary/70" />
          <span>{formatDate(expense.created_at)}</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Main Page ─── */
export default function ExpensesPage({ mode = "purchase" }: { mode?: "purchase" | "sales" } = {}) {
  const { session, logout } = useSap();
  const { isAdmin: isLovableAdmin } = useAuth();
  const navigate = useNavigate();
  const { expenses, isLoading, error, refresh, createExpense, updateExpense, submitForApproval, cancelExpense, retrySapIntegration } = useExpenses(mode);
  const { getLabel } = useCompanies(true);
  const [search, setSearch] = useState("");
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  if (!session) {
    navigate("/");
    return null;
  }

  const isSales = mode === "sales";
  const pageTitle = isSales ? "Gestão de Vendas" : "Gestão de Compras";
  const newButtonLabel = isSales ? "Novo Pedido de Venda" : "Nova Compra";
  const emptyLabel = isSales ? "Nenhum pedido de venda encontrado" : "Nenhuma compra encontrada";
  const emptyCta = isSales ? "Criar primeiro pedido" : "Criar primeira compra";
  const searchPlaceholder = isSales ? "Buscar por cliente, solicitante..." : "Buscar por fornecedor, solicitante...";

  const companyLabel = getLabel(session?.companyDB || "");
  const isAdmin = isLovableAdmin || !!session.isSuperUser;
  const userIdentifier = session.userName.toLowerCase();
  // Admin vê tudo por padrão; demais usuários só veem o que criaram ou aprovam.
  const [showAll, setShowAll] = useState<boolean>(isAdmin);
  useEffect(() => { setShowAll(isAdmin); }, [isAdmin]);

  const isMine = (e: Expense) => {
    const owner = (e.created_by_email || e.requester_email || e.requester_name || "").toLowerCase();
    const approver = (e.current_approver || "").toLowerCase();
    return (
      owner === userIdentifier ||
      owner.startsWith(userIdentifier + "@") ||
      approver === userIdentifier ||
      approver.includes(userIdentifier)
    );
  };

  const canCancel = (expense: Expense) => {
    if (isAdmin) return true;
    const owner = (expense.created_by_email || expense.requester_email || expense.requester_name || "").toLowerCase();
    return owner === userIdentifier || owner.startsWith(userIdentifier + "@");
  };

  const effectiveShowAll = isAdmin && showAll;
  const filtered = expenses.filter((e) => {
    if (!effectiveShowAll && !isMine(e)) return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.supplier_name.toLowerCase().includes(q) ||
      e.requester_name.toLowerCase().includes(q) ||
      (e.remarks || "").toLowerCase().includes(q)
    );
  });


  const totalValue = filtered.reduce((sum, e) => sum + e.total_amount, 0);

  const handleSubmitForApproval = async (id: string) => {
    setIsSubmitting(true);
    try {
      await submitForApproval(id);
      toast.success("Despesa enviada para aprovação!");
      setSelectedExpense(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar para aprovação");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    setIsCancelling(true);
    try {
      await cancelExpense(id);
      toast.success("Despesa cancelada.");
      setSelectedExpense(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao cancelar");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRetrySap = async (id: string) => {
    setIsRetrying(true);
    try {
      await retrySapIntegration(id);
      toast.success("Despesa integrada no SAP com sucesso!");
      setSelectedExpense(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reintegrar no SAP");
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCreate = async (input: any) => {
    const result = await createExpense(input) as any;
    if (result?.status === "pendente_aprovacao") {
      toast.info("Despesa enviada para aprovação automaticamente.");
    } else if (result?.status === "aprovado") {
      toast.success("Despesa aprovada (nenhuma regra aplicável).");
    }
    return result;
  };

  const statusOptions = [
    { value: "all", label: "Todos" },
    { value: "rascunho", label: "Rascunho" },
    { value: "pendente_aprovacao", label: "Pendente" },
    { value: "aprovado", label: "Aprovado" },
    { value: "pc_lancado", label: "PC Lançado" },
    { value: "finalizado", label: "Finalizado" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">SAP B1 <span className="text-gradient">Analytics</span></h1>
              <p className="text-xs text-muted-foreground">{pageTitle}</p>
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
            <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Back + actions */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> {newButtonLabel}
          </Button>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap gap-4">
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <DollarSign className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold font-mono text-foreground">{formatCurrency(totalValue)}</p>
            </div>
          </div>
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <Calendar className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Registros</p>
              <p className="text-lg font-bold font-mono text-foreground">{filtered.length}</p>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-muted/30 border-border"
            />
          </div>
          <div className="flex gap-1">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === opt.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 glass-card px-3 py-2 ml-auto">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <Label htmlFor="show-all-expenses" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                Ver todos os lançamentos
              </Label>
              <Switch id="show-all-expenses" checked={showAll} onCheckedChange={setShowAll} />
            </div>
          )}
        </div>


        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={refresh}>Tentar novamente</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <DollarSign className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">{emptyLabel}</p>
            <Button onClick={() => setShowCreate(true)} className="mt-4 gap-1.5">
              <Plus className="w-4 h-4" /> {emptyCta}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                onOpen={() => setSelectedExpense(expense)}
              />
            ))}
          </div>
        )}
      </main>

      <ExpenseDetailModal
        expense={selectedExpense}
        open={!!selectedExpense}
        onClose={() => setSelectedExpense(null)}
        onSubmit={handleSubmitForApproval}
        onCancel={handleCancel}
        onRetrySap={handleRetrySap}
        onEdit={(exp) => { setSelectedExpense(null); setEditingExpense(exp); }}
        canCancel={selectedExpense ? canCancel(selectedExpense) : false}
        canEdit={selectedExpense ? canCancel(selectedExpense) : false}
        canRetrySap={session.erpType === "sap" && (isAdmin || (selectedExpense ? canCancel(selectedExpense) : false))}
        isSubmitting={isSubmitting}
        isCancelling={isCancelling}
        isRetrying={isRetrying}
      />

      <EditExpenseModal
        expense={editingExpense}
        open={!!editingExpense}
        onClose={() => setEditingExpense(null)}
        mode={mode}
        onSave={async (input) => {
          if (!editingExpense) return;
          await updateExpense(editingExpense.id, input);
        }}
      />

      <CreateExpenseModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        sapSession={session}
        mode={mode}
      />
    </div>
  );
}
