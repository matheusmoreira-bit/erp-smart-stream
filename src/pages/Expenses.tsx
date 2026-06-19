import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
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
  CheckCircle2,
  XCircle,
  Link2,
  AlertTriangle,
  Network,
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
import { RelationsMap } from "@/components/RelationsMap";
import { sapQuery } from "@/lib/sap-client";
import {
  useExpenses,
  STATUS_LABELS,
  STATUS_COLORS,
  type Expense,
  type ExpenseStatus,
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
  onApprove,
  onReject,
  onViewIntegration,
  canCancel,
  canEdit,
  canRetrySap,
  canApprove,
  isSubmitting,
  isCancelling,
  isRetrying,
  isActioning,
}: {
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (id: string) => void;
  onCancel: (id: string) => void;
  onRetrySap: (id: string) => void;
  onEdit: (expense: Expense) => void;
  onApprove: (expense: Expense) => void;
  onReject: (expense: Expense) => void;
  onViewIntegration: () => void;
  canCancel: boolean;
  canEdit: boolean;
  canRetrySap: boolean;
  canApprove: boolean;
  isSubmitting: boolean;
  isCancelling: boolean;
  isRetrying: boolean;
  isActioning: boolean;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!expense) return null;

  const showSubmit = expense.status === "rascunho";
  const showCancel = canCancel && (expense.status === "rascunho" || expense.status === "pendente_aprovacao");
  const hasSapError = !!expense.sap_integration_error && !expense.sap_doc_entry;
  const showEdit = canEdit && (
    expense.status === "rascunho" ||
    expense.status === "pendente_aprovacao" ||
    (expense.status === "aprovado" && hasSapError)
  );
  const showRetrySap = canRetrySap && expense.status === "aprovado" && !expense.sap_doc_entry;
  const showApproval = canApprove && expense.status === "pendente_aprovacao";
  const hasIntegration = !!(expense.sap_doc_entry || expense.sap_doc_num || expense.sap_integration_error);

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

            {hasIntegration && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Integração com ERP
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={onViewIntegration}
                  >
                    Ver detalhes
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {expense.sap_doc_num != null && (
                    <div>
                      <p className="text-muted-foreground">Documento ERP</p>
                      <p className="text-foreground font-mono font-medium">
                        #{expense.sap_doc_num}
                        {expense.sap_doc_entry ? ` (entry ${expense.sap_doc_entry})` : ""}
                      </p>
                    </div>
                  )}
                  {expense.sap_purchase_order_status && (
                    <div>
                      <p className="text-muted-foreground">Status PC</p>
                      <p className="text-foreground">{expense.sap_purchase_order_status}</p>
                    </div>
                  )}
                  {expense.sap_attachment_status && (
                    <div>
                      <p className="text-muted-foreground">Anexo</p>
                      <p className="text-foreground">{expense.sap_attachment_status}</p>
                    </div>
                  )}
                  {expense.sap_integration_last_attempt_at && (
                    <div>
                      <p className="text-muted-foreground">Última tentativa</p>
                      <p className="text-foreground">{formatDate(expense.sap_integration_last_attempt_at)}</p>
                    </div>
                  )}
                </div>
                {expense.sap_integration_error && (
                  <div className="flex items-start gap-2 rounded bg-destructive/10 border border-destructive/30 p-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
                    <p className="text-xs text-destructive flex-1 break-words">
                      {expense.sap_integration_error}
                    </p>
                  </div>
                )}
              </div>
            )}

            {(showSubmit || showCancel || showRetrySap || showEdit || showApproval) && (
              <div className="border-t border-border pt-4 flex justify-end gap-3 flex-wrap">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
                {showApproval && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => onReject(expense)}
                      disabled={isActioning}
                      className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Rejeitar
                    </Button>
                    <Button
                      onClick={() => onApprove(expense)}
                      disabled={isActioning}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Aprovar
                    </Button>
                  </>
                )}
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
function ExpenseCard({
  expense,
  onOpen,
  originBadge,
  onRelationsMap,
}: {
  expense: Expense;
  onOpen: () => void;
  originBadge?: "erp_flow" | "erp";
  onRelationsMap?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 flex flex-col gap-3 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={STATUS_COLORS[expense.status]}>{STATUS_LABELS[expense.status]}</Badge>
          {originBadge === "erp_flow" && (
            <Badge variant="outline" className="text-[10px] gap-1 border-primary/40 text-primary">
              ERP Flow
            </Badge>
          )}
          {originBadge === "erp" && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-500">
              ERP
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onRelationsMap && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary"
              title="Mapa de relações"
              onClick={(ev) => { ev.stopPropagation(); onRelationsMap(); }}
            >
              <Network className="w-4 h-4" />
            </Button>
          )}
          <p className="text-lg font-bold text-foreground font-mono">{formatCurrency(expense.total_amount, expense.currency)}</p>
        </div>
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
  const { expenses, isLoading, error, refresh, createExpense, updateExpense, submitForApproval, cancelExpense, retrySapIntegration, approveExpense, rejectExpense } = useExpenses(mode);
  const { getLabel } = useCompanies(true);
  const [search, setSearch] = useState("");
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isActioning, setIsActioning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const isSales = mode === "sales";
  const pageTitle = isSales ? "Gestão de Vendas" : "Gestão de Compras";
  const newButtonLabel = isSales ? "Novo Pedido de Venda" : "Nova Compra";
  const emptyLabel = isSales ? "Nenhum pedido de venda encontrado" : "Nenhuma compra encontrada";
  const emptyCta = isSales ? "Criar primeiro pedido" : "Criar primeira compra";
  const searchPlaceholder = isSales ? "Buscar por cliente, solicitante..." : "Buscar por fornecedor, solicitante...";

  const companyLabel = getLabel(session?.companyDB || "");
  const isAdmin = isLovableAdmin || !!session?.isSuperUser;
  const userIdentifier = (session?.userName || "").toLowerCase();
  // Admin vê tudo por padrão; demais usuários só veem o que criaram ou aprovam.
  const [showAll, setShowAll] = useState<boolean>(isAdmin);
  useEffect(() => { setShowAll(isAdmin); }, [isAdmin]);

  // Origem dos pedidos: padrão "Apenas ERP Flow"; "Ambos" também busca direto do ERP (SAP).
  const [sourceMode, setSourceMode] = useState<"flow" | "both">("flow");
  const [sapOrders, setSapOrders] = useState<Expense[]>([]);
  const [isLoadingSap, setIsLoadingSap] = useState(false);
  const showSourceToggle = mode === "purchase" && session?.erpType === "sap";

  useEffect(() => {
    if (!showSourceToggle || sourceMode !== "both" || !session) return;
    let cancelled = false;
    (async () => {
      setIsLoadingSap(true);
      try {
        const res = await sapQuery(
          session as any,
          "PurchaseOrders",
          {
            $select: "DocEntry,DocNum,CardCode,CardName,DocTotal,DocCurrency,DocDate,CreationDate,DocumentStatus,Comments",
            $orderby: "DocDate desc",
            $top: "100",
          },
          false,
        );
        if (cancelled) return;
        const rows = Array.isArray((res as any).data)
          ? (res as any).data
          : ((res as any).data?.value || []);
        const mapped: Expense[] = (rows as any[]).map((r) => ({
          id: `sap-${r.DocEntry}`,
          supplier_code: r.CardCode || undefined,
          supplier_name: r.CardName || r.CardCode || "—",
          total_amount: Number(r.DocTotal || 0),
          currency: r.DocCurrency || "BRL",
          status: "pc_lancado" as ExpenseStatus,
          requester_name: "(ERP)",
          sap_doc_entry: r.DocEntry,
          sap_doc_num: r.DocNum,
          company_db: session.companyDB,
          remarks: r.Comments || undefined,
          created_at: r.DocDate || r.CreationDate || new Date().toISOString(),
          updated_at: r.DocDate || r.CreationDate || new Date().toISOString(),
          origin: "manual",
        }));
        setSapOrders(mapped);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Falha ao carregar pedidos do ERP");
          setSapOrders([]);
        }
      } finally {
        if (!cancelled) setIsLoadingSap(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceMode, showSourceToggle, session]);

  useEffect(() => {
    if (!session) navigate("/");
  }, [session, navigate]);

  if (!session) {
    return null;
  }

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

  // Aprovador atual = usuário cujo nome/email "bate" com expense.current_approver.
  // Admin/super-usuário também pode aprovar inline.
  const canApprove = (expense: Expense) => {
    if (expense.status !== "pendente_aprovacao") return false;
    if (isAdmin) return true;
    const approver = (expense.current_approver || "").toLowerCase().trim();
    const me = userIdentifier;
    if (!approver || !me) return false;
    if (approver === me) return true;
    if (approver.includes(me) || me.includes(approver.split("@")[0])) return true;
    const meLogin = me.split("@")[0];
    if (meLogin && approver.includes(meLogin)) return true;
    // Match por tokens do nome (ex.: "matheus.moreira" ↔ "Matheus Moreira")
    const tokenize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[.@]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    const approverTokens = new Set(tokenize(approver));
    const meTokens = tokenize(me);
    if (meTokens.length === 0) return false;
    return meTokens.every((t) => approverTokens.has(t));
  };

  const effectiveShowAll = isAdmin && showAll;

  // Identifica DocEntries do SAP já vinculados a alguma despesa do ERP Flow,
  // para não exibi-los duplicados quando o modo é "Ambos".
  const flowSapDocEntries = new Set(
    expenses
      .map((e) => e.sap_doc_entry)
      .filter((v): v is number => typeof v === "number"),
  );
  const sapOnly = showSourceToggle && sourceMode === "both"
    ? sapOrders.filter((o) => o.sap_doc_entry == null || !flowSapDocEntries.has(o.sap_doc_entry))
    : [];

  const applyFilters = (e: Expense, scoped: boolean) => {
    if (scoped && !effectiveShowAll && !isMine(e)) return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.supplier_name.toLowerCase().includes(q) ||
      e.requester_name.toLowerCase().includes(q) ||
      (e.remarks || "").toLowerCase().includes(q)
    );
  };

  const flowFiltered = expenses.filter((e) => applyFilters(e, true));
  const sapFiltered = sapOnly.filter((e) => applyFilters(e, false));
  const filtered: Array<{ exp: Expense; origin: "erp_flow" | "erp" }> = [
    ...flowFiltered.map((exp) => ({ exp, origin: "erp_flow" as const })),
    ...sapFiltered.map((exp) => ({ exp, origin: "erp" as const })),
  ];

  const totalValue = filtered.reduce((sum, item) => sum + item.exp.total_amount, 0);

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

  const [relationsMapExpense, setRelationsMapExpense] = useState<Expense | null>(null);

  const handleCreate = async (input: any) => {
    const result = await createExpense(input) as any;
    if (result?.status === "pendente_aprovacao") {
      toast.info("Despesa enviada para aprovação automaticamente.");
    } else if (result?.status === "aprovado") {
      toast.success("Despesa aprovada (nenhuma regra aplicável).");
    }
    // Abre o Mapa de Relações com a despesa recém-criada
    if (result?.expense) {
      setRelationsMapExpense(result.expense as Expense);
    }
    return result;
  };

  const handleApprove = async (expense: Expense) => {
    setIsActioning(true);
    try {
      await approveExpense(expense.id);
      toast.success("Despesa aprovada!");
      setSelectedExpense(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aprovar");
    } finally {
      setIsActioning(false);
    }
  };

  const handleReject = async (expense: Expense) => {
    setIsActioning(true);
    try {
      await rejectExpense(expense.id);
      toast.success("Despesa rejeitada.");
      setSelectedExpense(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao rejeitar");
    } finally {
      setIsActioning(false);
    }
  };

  const handleViewIntegration = () => {
    setSelectedExpense(null);
    navigate("/integrations-monitor");
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
      <Helmet><title>{`${isSales ? "Vendas" : "Compras"} — ERP Flow`}</title></Helmet>
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{isSales ? "Vendas" : "Compras"}</h1>
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
          {showSourceToggle && (
            <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 text-xs">
              <button
                onClick={() => setSourceMode("flow")}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  sourceMode === "flow"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Apenas ERP Flow
              </button>
              <button
                onClick={() => setSourceMode("both")}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                  sourceMode === "both"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Ambos (ERP Flow + ERP)
                {isLoadingSap && <Loader2 className="w-3 h-3 animate-spin" />}
              </button>
            </div>
          )}
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
            {filtered.map(({ exp, origin }) => (
              <ExpenseCard
                key={exp.id}
                expense={exp}
                originBadge={origin}
                onOpen={() => setSelectedExpense(exp)}
                onRelationsMap={origin === "erp_flow" ? () => setRelationsMapExpense(exp) : undefined}
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
        onApprove={handleApprove}
        onReject={handleReject}
        onViewIntegration={handleViewIntegration}
        canCancel={selectedExpense ? canCancel(selectedExpense) : false}
        canEdit={selectedExpense ? canCancel(selectedExpense) : false}
        canRetrySap={session.erpType === "sap" && (isAdmin || (selectedExpense ? canCancel(selectedExpense) : false))}
        canApprove={selectedExpense ? canApprove(selectedExpense) : false}
        isSubmitting={isSubmitting}
        isCancelling={isCancelling}
        isRetrying={isRetrying}
        isActioning={isActioning}
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

      <RelationsMap
        open={!!relationsMapExpense}
        onClose={() => setRelationsMapExpense(null)}
        expense={relationsMapExpense as any}
        title={isSales ? "Mapa de Relações — Pedido de Venda" : "Mapa de Relações — Pedido de Compra"}
      />
    </div>
  );
}
