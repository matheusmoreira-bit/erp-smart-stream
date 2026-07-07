import { useState, useEffect, useCallback, useRef } from "react";
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
  Eye,
  Paperclip,
  FileDown,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { exportListReportPdf, exportListReportCsv, exportExpenseDetailPdf } from "@/lib/report-pdf";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ExpenseEventHistory } from "@/components/ExpenseEventHistory";
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
import { CreateExpenseModal, type ExpenseDraftHydration } from "@/components/CreateExpenseModal";
import { EditExpenseModal } from "@/components/EditExpenseModal";
import { DraftsPopover } from "@/components/DraftsPopover";
import { useDocumentDrafts } from "@/hooks/useDocumentDrafts";
import { useCompanies } from "@/hooks/useCompanies";
import { usePersistedState } from "@/hooks/usePersistedState";

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

/* ─── Backfill button (reprocessa anexo com IA para extrair data de vencimento) ─── */
function BackfillDueDateButton({ expenseId }: { expenseId: string }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const res = await sapFunctionFetch("expense-backfill-due-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "one", expense_id: expenseId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Falha ao reprocessar");
      toast.success(`Data de vencimento atualizada: ${data.updated?.due_date}`);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao reprocessar");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={handle} disabled={loading}>
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3 mr-1" />}
      Reprocessar com IA
    </Button>
  );
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
  onAddAttachments,
  canCancel,
  canEdit,
  canRetrySap,
  canApprove,
  canAddAttachments,
  isSubmitting,
  isCancelling,
  isRetrying,
  isActioning,
  mode,
  originBadge,
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
  onAddAttachments: (id: string, files: File[]) => Promise<void>;
  canCancel: boolean;
  canEdit: boolean;
  canRetrySap: boolean;
  canApprove: boolean;
  canAddAttachments: boolean;
  isSubmitting: boolean;
  isCancelling: boolean;
  isRetrying: boolean;
  isActioning: boolean;
  mode?: "purchase" | "sales";
  originBadge?: "erp_flow" | "erp";
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (!expense) return null;

  const showSubmit = expense.status === "rascunho";
  const showCancel = canCancel && (expense.status === "rascunho" || expense.status === "pendente_aprovacao");
  const alreadyInSap = !!(expense.sap_doc_entry || expense.sap_doc_num);
  const hasSapError = !!expense.sap_integration_error && !alreadyInSap;
  // Edição só permitida enquanto o documento NÃO foi integrado ao ERP.
  // Após editar, o documento retorna ao fluxo de aprovação (nível 1).
  const showEdit = canEdit && !alreadyInSap && (
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-6">
              <span className="text-foreground font-semibold">Despesa</span>
              <Badge className={STATUS_COLORS[expense.status]}>{STATUS_LABELS[expense.status]}</Badge>
              {originBadge === "erp_flow" && (
                <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">ERP Flow</Badge>
              )}
              {originBadge === "erp" && (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">ERP</Badge>
              )}
              {expense.origin === "pagcorp" && (
                <Badge variant="outline" className="text-xs">PagCorp</Badge>
              )}
              <span className="text-xl sm:text-2xl font-bold font-mono w-full sm:w-auto sm:ml-auto text-right">{formatCurrency(expense.total_amount, expense.currency)}</span>
            </DialogTitle>
          </DialogHeader>

          {/* Summary strip mobile — mesmos campos da linha da tabela */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs sm:hidden">
            <div className="col-span-2 flex items-center gap-2 min-w-0">
              <Building2 className="w-3.5 h-3.5 text-primary/70 shrink-0" />
              <span className="text-foreground font-medium truncate">{expense.supplier_name}</span>
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Solicitante</p>
              <p className="text-foreground truncate">{expense.requester_name}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Criado</p>
              <p className="text-foreground">{formatDate(expense.created_at)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Doc</p>
              <p className="text-foreground">{expense.doc_date ? formatDate(expense.doc_date) : "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vence</p>
              <p className={expense.due_date ? "text-foreground" : "text-destructive font-medium"}>
                {expense.due_date ? formatDate(expense.due_date) : "sem data"}
              </p>
            </div>
          </div>


          <div className="flex justify-end mt-3 sm:mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => void exportExpenseDetailPdf(expense, {
                statusLabel: STATUS_LABELS[expense.status] || expense.status,
                mode,
              })}
            >
              <FileDown className="w-3.5 h-3.5" aria-hidden="true" /> Exportar relatório
            </Button>
          </div>


          <div className="space-y-5 sm:space-y-6 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">


              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Fornecedor</p>
                <p className="text-foreground font-medium">{expense.supplier_name}</p>
                {expense.supplier_code && <p className="text-xs text-muted-foreground font-mono">{expense.supplier_code}</p>}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Solicitante</p>
                <p className="text-foreground font-medium">{expense.requester_name}</p>
              </div>
              {expense.cost_center && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Centro de Custo</p>
                  <p className="text-foreground">{expense.cost_center}</p>
                </div>
              )}
              {expense.project && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Projeto</p>
                  <p className="text-foreground">{expense.project}</p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Data de Criação</p>
                <p className="text-foreground">{formatDate(expense.created_at)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Data do Documento</p>
                <p className="text-foreground">{expense.doc_date ? formatDate(expense.doc_date) : "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Data de Vencimento</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={expense.due_date ? "text-foreground" : "text-muted-foreground"}>
                    {expense.due_date ? formatDate(expense.due_date) : "—"}
                  </p>
                  {!expense.due_date && expense.status === "pendente_aprovacao" && (expense.attachments?.length ?? 0) > 0 && (
                    <BackfillDueDateButton expenseId={expense.id} />
                  )}
                </div>
              </div>
              {expense.current_approver && (
                <div className="space-y-1">
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
                        <th className="text-left py-2 px-3 text-muted-foreground">Centro de Custo</th>
                        <th className="text-left py-2 px-3 text-muted-foreground">Projeto</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Qtd</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Preço Unit.</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expense.items.map((item, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-2 px-3 text-foreground">{item.description}</td>
                          <td className="py-2 px-3 text-foreground">{item.cost_center || expense.cost_center || "—"}</td>
                          <td className="py-2 px-3 text-foreground">{item.project || expense.project || "—"}</td>
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

            {((expense.attachments && expense.attachments.length > 0) || canAddAttachments) && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Paperclip className="w-3 h-3" /> Anexos
                  </p>
                  {canAddAttachments && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length === 0) return;
                          e.target.value = "";
                          setUploading(true);
                          try {
                            await onAddAttachments(expense.id, files);
                            toast.success(`${files.length} anexo(s) enviado(s)`);
                          } catch (err: any) {
                            toast.error(err?.message || "Falha no upload");
                          } finally {
                            setUploading(false);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploading ? (
                          <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Enviando…</>
                        ) : (
                          <><Plus className="w-3 h-3 mr-1" /> Anexar arquivos</>
                        )}
                      </Button>
                    </>
                  )}
                </div>
                <div className="space-y-1">
                  {(expense.attachments || []).map((att) => (
                    <button
                      key={att.id}
                      type="button"
                      onClick={async () => {
                        try {
                          const { sapFunctionFetch } = await import("@/lib/auth-fetch");
                          const res = await sapFunctionFetch("expense-attachment-storage", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "sign", file_path: att.file_path }),
                          });
                          const data = await res.json().catch(() => null);
                          if (!res.ok || !data?.signed_url) throw new Error(data?.error || "URL indisponível");
                          window.open(data.signed_url, "_blank", "noopener,noreferrer");
                        } catch (e) {
                          console.error("Erro ao abrir anexo:", e);
                        }
                      }}
                      className="w-full text-left text-xs bg-muted/20 hover:bg-muted/40 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                      title="Abrir anexo em nova aba"
                    >
                      <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-foreground underline decoration-dotted flex-1">{att.file_name}</span>
                      {typeof att.file_size === "number" && (
                        <span className="text-[10px] text-muted-foreground shrink-0">{(att.file_size / 1024).toFixed(0)} KB</span>
                      )}
                    </button>
                  ))}
                  {(!expense.attachments || expense.attachments.length === 0) && (
                    <p className="text-[11px] text-muted-foreground italic">Nenhum anexo ainda.</p>
                  )}
                </div>
              </div>
            )}

            {hasIntegration && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-primary" aria-hidden="true" />
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                  {expense.sap_doc_num != null && (
                    <div className="space-y-0.5">
                      <p className="text-muted-foreground">Documento ERP</p>
                      <p className="text-foreground font-mono font-medium">
                        #{expense.sap_doc_num}
                        {expense.sap_doc_entry ? ` (entry ${expense.sap_doc_entry})` : ""}
                      </p>
                    </div>
                  )}
                  {expense.sap_purchase_order_status && (
                    <div className="space-y-0.5">
                      <p className="text-muted-foreground">Status PC</p>
                      <p className="text-foreground">{expense.sap_purchase_order_status}</p>
                    </div>
                  )}
                  {expense.sap_attachment_status && (
                    <div className="space-y-0.5">
                      <p className="text-muted-foreground">Anexo</p>
                      <p className="text-foreground">{expense.sap_attachment_status}</p>
                    </div>
                  )}
                  {expense.sap_integration_last_attempt_at && (
                    <div className="space-y-0.5">
                      <p className="text-muted-foreground">Última tentativa</p>
                      <p className="text-foreground">{formatDate(expense.sap_integration_last_attempt_at)}</p>
                    </div>
                  )}
                </div>
                {expense.sap_integration_error && (
                  <div className="flex items-start gap-2 rounded bg-destructive/10 border border-destructive/30 p-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" aria-hidden="true" />
                    <p className="text-xs text-destructive flex-1 break-words">
                      {expense.sap_integration_error}
                    </p>
                  </div>
                )}
              </div>
            )}

            <ExpenseEventHistory expense={expense} refreshKey={expense.updated_at} />



            {(showSubmit || showCancel || showRetrySap || showEdit || showApproval) && (
              <div className="border-t border-border pt-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:flex-wrap gap-2 sm:gap-3">
                <Button variant="outline" onClick={onClose} className="w-full sm:w-auto justify-center">Fechar</Button>
                {showApproval && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => onReject(expense)}
                      disabled={isActioning}
                      className="w-full sm:w-auto justify-center gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <XCircle className="w-4 h-4" aria-hidden="true" />}
                      Rejeitar
                    </Button>
                    <Button
                      onClick={() => onApprove(expense)}
                      disabled={isActioning}
                      className="w-full sm:w-auto justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
                      Aprovar
                    </Button>
                  </>
                )}
                {showEdit && (
                  <Button
                    variant="outline"
                    onClick={() => onEdit(expense)}
                    className="w-full sm:w-auto justify-center gap-1.5"
                    title={
                      expense.status === "rascunho"
                        ? "Editar rascunho"
                        : "Ao salvar edições, o documento volta ao fluxo de aprovação (nível 1)."
                    }
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                    Editar
                  </Button>
                )}
                {showCancel && (
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmCancel(true)}
                    disabled={isCancelling}
                    className="w-full sm:w-auto justify-center gap-1.5"
                  >
                    {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <XIcon className="w-4 h-4" aria-hidden="true" />}
                    Cancelar Despesa
                  </Button>
                )}
                {showRetrySap && (
                  <Button
                    onClick={() => onRetrySap(expense.id)}
                    disabled={isRetrying}
                    className="w-full sm:w-auto justify-center gap-1.5"
                  >
                    {isRetrying ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RotateCw className="w-4 h-4" aria-hidden="true" />}
                    Reintegrar no SAP
                  </Button>
                )}
                {showSubmit && (
                  <Button
                    onClick={() => onSubmit(expense.id)}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto justify-center gap-1.5"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
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

/* ─── Sortable Table Header ─── */
function SortableTh<K extends string>({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  k: K;
  sortKey: K;
  sortDir: "asc" | "desc";
  onSort: (k: K) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        {active ? (
          sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-50" />
        )}
      </button>
    </th>
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
  const originLabel = originBadge === "erp_flow" ? " · ERP Flow" : originBadge === "erp" ? " · ERP" : "";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      role="button"
      tabIndex={0}
      aria-label={`Abrir lançamento ${expense.supplier_name}, solicitante ${expense.requester_name}, valor ${formatCurrency(expense.total_amount, expense.currency)}, status ${STATUS_LABELS[expense.status] || expense.status}${originLabel}`}
      className="glass-card p-5 flex flex-col gap-3 cursor-pointer hover:ring-1 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-all"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
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
          <span>Criado: {formatDate(expense.created_at)}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5 text-primary/70" />
          <span>
            Doc: {expense.doc_date ? formatDate(expense.doc_date) : "—"}
            {"  ·  "}
            Vence: <span className={expense.due_date ? "text-foreground font-medium" : "text-destructive font-medium"}>
              {expense.due_date ? formatDate(expense.due_date) : "sem data"}
            </span>
          </span>
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
  const { expenses, isLoading, error, refresh, createExpense, updateExpense, submitForApproval, cancelExpense, retrySapIntegration, approveExpense, rejectExpense, addAttachments } = useExpenses(mode);
  const { getLabel } = useCompanies(true);
  // Filtros persistidos por modo (purchase/sales) para manter seleção ao trocar de tela.
  const filterKey = (name: string) => `expenses:${mode}:${name}`;
  const [search, setSearch] = usePersistedState<string>(filterKey("search"), "");
  const [isSearchPending, setIsSearchPending] = useState(false);
  useEffect(() => {
    if (!search) { setIsSearchPending(false); return; }
    setIsSearchPending(true);
    const t = setTimeout(() => setIsSearchPending(false), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<"erp_flow" | "erp" | undefined>(undefined);
  const openExpense = (exp: Expense, origin?: "erp_flow" | "erp") => {
    setSelectedExpense(exp);
    setSelectedOrigin(origin);
  };
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ExpenseDraftHydration | null>(null);
  const { refresh: refreshDrafts } = useDocumentDrafts(mode, session?.companyDB);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isActioning, setIsActioning] = useState(false);
  const [statusFilter, setStatusFilter] = usePersistedState<string>(filterKey("status"), "all");

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
  const [showAll, setShowAll] = usePersistedState<boolean>(filterKey("showAll"), isAdmin);
  useEffect(() => { if (!isAdmin) setShowAll(false); }, [isAdmin, setShowAll]);

  // Preserva a posição de rolagem ao aplicar mudanças de filtro/paginação que
  // reordenam a lista mas não devem "puxar" o usuário de volta ao topo.
  const preserveScroll = useCallback((cb: () => void) => {
    const y = typeof window !== "undefined" ? window.scrollY : 0;
    cb();
    if (typeof window === "undefined") return;
    requestAnimationFrame(() => {
      window.scrollTo({ top: y });
      requestAnimationFrame(() => window.scrollTo({ top: y }));
    });
  }, []);

  // Origem dos pedidos: padrão "Apenas ERP Flow"; "Ambos" também busca direto do ERP (SAP).
  const [sourceMode, setSourceMode] = usePersistedState<"flow" | "both">(filterKey("source"), "flow");
  const [sapOrders, setSapOrders] = useState<Expense[]>([]);
  const [isLoadingSap, setIsLoadingSap] = useState(false);
  const [isLoadingMoreSap, setIsLoadingMoreSap] = useState(false);
  const [sapHasMore, setSapHasMore] = useState(false);
  const [relationsMapExpense, setRelationsMapExpense] = useState<Expense | null>(null);
  const showSourceToggle = mode === "purchase" && session?.erpType === "sap";
  const SAP_PAGE_STEP = 100;

  const fetchSapPage = useCallback(
    async (skip: number): Promise<Expense[]> => {
      if (!session) return [];
      const res = await sapQuery(
        session as any,
        "PurchaseOrders",
        {
          $select: "DocEntry,DocNum,CardCode,CardName,DocTotal,DocCurrency,DocDate,CreationDate,DocumentStatus,Comments",
          $orderby: "DocDate desc",
          $top: String(SAP_PAGE_STEP),
          $skip: String(skip),
        },
        false,
      );
      const rows = Array.isArray((res as any).data)
        ? (res as any).data
        : ((res as any).data?.value || []);
      return (rows as any[]).map((r) => ({
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
    },
    [session],
  );

  useEffect(() => {
    if (!showSourceToggle || sourceMode !== "both" || !session) return;
    let cancelled = false;
    (async () => {
      setIsLoadingSap(true);
      try {
        const mapped = await fetchSapPage(0);
        if (cancelled) return;
        setSapOrders(mapped);
        setSapHasMore(mapped.length === SAP_PAGE_STEP);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Falha ao carregar pedidos do ERP");
          setSapOrders([]);
          setSapHasMore(false);
        }
      } finally {
        if (!cancelled) setIsLoadingSap(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceMode, showSourceToggle, session, fetchSapPage]);

  const loadMoreSap = useCallback(async () => {
    if (isLoadingMoreSap || !sapHasMore) return;
    setIsLoadingMoreSap(true);
    try {
      const next = await fetchSapPage(sapOrders.length);
      setSapOrders((prev) => {
        const seen = new Set(prev.map((p) => p.sap_doc_entry));
        const dedup = next.filter((n) => !seen.has(n.sap_doc_entry));
        return [...prev, ...dedup];
      });
      setSapHasMore(next.length === SAP_PAGE_STEP);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar mais pedidos do ERP");
    } finally {
      setIsLoadingMoreSap(false);
    }
  }, [fetchSapPage, isLoadingMoreSap, sapHasMore, sapOrders.length]);


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

  // Identifica DocEntries/DocNums do SAP já vinculados a alguma despesa do ERP Flow,
  // para não exibi-los duplicados quando o modo é "Ambos". Dedup por (company_db + DocEntry)
  // e também por (company_db + DocNum) — cobre casos onde apenas um dos dois foi persistido.
  const sessionCompany = (session?.companyDB || "").toLowerCase();
  const flowSapKeys = new Set<string>();
  for (const e of expenses) {
    const comp = (e.company_db || sessionCompany || "").toLowerCase();
    const entry = e.sap_doc_entry != null ? Number(e.sap_doc_entry) : null;
    const num = e.sap_doc_num != null ? Number(e.sap_doc_num) : null;
    if (entry != null && Number.isFinite(entry)) flowSapKeys.add(`${comp}:entry:${entry}`);
    if (num != null && Number.isFinite(num)) flowSapKeys.add(`${comp}:num:${num}`);
  }
  const sapOnly = showSourceToggle && sourceMode === "both"
    ? sapOrders.filter((o) => {
        const comp = (o.company_db || sessionCompany || "").toLowerCase();
        const entry = o.sap_doc_entry != null ? Number(o.sap_doc_entry) : null;
        const num = o.sap_doc_num != null ? Number(o.sap_doc_num) : null;
        if (entry != null && flowSapKeys.has(`${comp}:entry:${entry}`)) return false;
        if (num != null && flowSapKeys.has(`${comp}:num:${num}`)) return false;
        return true;
      })
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

  // ─── Ordenação por coluna ─────────────────────────────────────
  type SortKey = "status" | "supplier" | "requester" | "created" | "doc" | "due" | "amount" | "origin";
  const [sortKey, setSortKey] = usePersistedState<SortKey>(filterKey("sortKey"), "created");
  const [sortDir, setSortDir] = usePersistedState<"asc" | "desc">(filterKey("sortDir"), "desc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "amount" || key === "created" ? "desc" : "asc"); }
  };
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const va = (() => {
      switch (sortKey) {
        case "status": return STATUS_LABELS[a.exp.status] || a.exp.status;
        case "supplier": return (a.exp.supplier_name || "").toLowerCase();
        case "requester": return (a.exp.requester_name || "").toLowerCase();
        case "created": return new Date(a.exp.created_at).getTime();
        case "doc": return a.exp.doc_date ? new Date(a.exp.doc_date).getTime() : 0;
        case "due": return a.exp.due_date ? new Date(a.exp.due_date).getTime() : 0;
        case "amount": return a.exp.total_amount;
        case "origin": return a.origin;
      }
    })();
    const vb = (() => {
      switch (sortKey) {
        case "status": return STATUS_LABELS[b.exp.status] || b.exp.status;
        case "supplier": return (b.exp.supplier_name || "").toLowerCase();
        case "requester": return (b.exp.requester_name || "").toLowerCase();
        case "created": return new Date(b.exp.created_at).getTime();
        case "doc": return b.exp.doc_date ? new Date(b.exp.doc_date).getTime() : 0;
        case "due": return b.exp.due_date ? new Date(b.exp.due_date).getTime() : 0;
        case "amount": return b.exp.total_amount;
        case "origin": return b.origin;
      }
    })();
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  // ─── Paginação (mesma página para cards mobile e tabela desktop) ───
  const PAGE_SIZE_OPTIONS = [15, 30, 50, 100] as const;
  const [pageSize, setPageSize] = usePersistedState<number>(filterKey("pageSize"), 30);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // Reset apenas para mudanças que alteram fortemente a listagem (busca, ordenação, tamanho de página, modo compra/venda).
  // Toggles de status / fonte ERP / "ver todos" preservam a página atual (e a rolagem — ver preserveScroll abaixo).
  useEffect(() => {
    setPage(1);
  }, [search, mode, sortKey, sortDir, pageSize]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageStart = (page - 1) * pageSize;
  const pageItems = sorted.slice(pageStart, pageStart + pageSize);
  const visibleItems = pageItems; // compat com blocos existentes

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
    navigate("/integracoes/monitor");
  };

  const statusOptions = [
    { value: "all", label: "Todos" },
    { value: "rascunho", label: "Rascunho" },
    { value: "pendente_aprovacao", label: "Pendente" },
    { value: "aprovado", label: "Aprovado" },
    { value: "pc_lancado", label: "PC Lançado" },
    { value: "finalizado", label: "Finalizado" },
  ];

  // Refs para gerenciamento de foco no toggle de filtros mobile.
  const filtersToggleRef = useRef<HTMLButtonElement | null>(null);
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);
  const filtersJustOpened = useRef(false);
  const filtersJustClosed = useRef(false);
  useEffect(() => {
    if (filtersOpen && filtersJustOpened.current) {
      const first = filtersPanelRef.current?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      first?.focus();
      filtersJustOpened.current = false;
    } else if (!filtersOpen && filtersJustClosed.current) {
      filtersToggleRef.current?.focus();
      filtersJustClosed.current = false;
    }
  }, [filtersOpen]);

  return (
    <div className="min-h-screen bg-background">
      <Helmet><title>{`${isSales ? "Vendas" : "Compras"} — ERP Flow`}</title></Helmet>
      {/* Skip link para navegação por teclado */}
      <a
        href="#expenses-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-primary focus:text-primary-foreground focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>
      {/* Header */}
      <header
        aria-label={isSales ? "Cabeçalho de Vendas" : "Cabeçalho de Compras"}
        className="border-b border-border px-4 sm:px-6 py-3 sm:py-4"
      >
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4 lg:items-center">
          {/* Col 1: identity */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary shrink-0" aria-hidden="true">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-foreground truncate">{isSales ? "Vendas" : "Compras"}</h1>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{pageTitle}</p>
            </div>
          </div>

          {/* Col 2: actions */}
          <div
            role="toolbar"
            aria-label="Ações do cabeçalho"
            className="flex items-center gap-2 sm:gap-3 lg:justify-end flex-wrap"
          >
            <div className="hidden sm:block text-right min-w-0 max-w-[220px]">
              <p className="text-sm font-medium text-foreground truncate" aria-label={`Empresa: ${companyLabel}`}>{companyLabel}</p>
              <p className="text-xs text-muted-foreground truncate" aria-label={`Usuário: ${session?.userName || ""}`}>{session?.userName}</p>
            </div>
            <div
              className="hidden md:flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
              aria-label="Status da conexão: Conectado"
            >
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" aria-hidden="true" />
              <span>Conectado</span>
            </div>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading} aria-label={isLoading ? "Atualizando…" : "Atualizar lista"}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout} aria-label="Sair da conta">
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>


      <main id="expenses-main" tabIndex={-1} className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">

        {/* Back + actions — no mobile: linha 1 = Dashboard, linha 2 = ações em grid */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground -ml-2 sm:ml-0"
            >
              <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Dashboard
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:flex-wrap sm:justify-end">
            <DraftsPopover
              docType={mode}
              companyDb={session?.companyDB}
              onResume={(d) => {
                setPendingDraft({ id: d.id, payload: d.payload });
                setShowCreate(true);
              }}
            />
            {(() => {
              const reportOptions = {
                title: isSales ? "Relatório de Vendas" : "Relatório de Compras",
                subtitle: `${filtered.length} registro(s) · ${companyLabel}`,
                meta: [
                  { label: "Empresa", value: companyLabel },
                  { label: "Usuário", value: session?.userName || "—" },
                  { label: "Total", value: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalValue) },
                ],
                columns: [
                  { header: "Fornecedor/Cliente", cell: (r: typeof filtered[number]) => r.exp.supplier_name },
                  { header: "Status", cell: (r: typeof filtered[number]) => STATUS_LABELS[r.exp.status] || r.exp.status },
                  { header: "Solicitante", cell: (r: typeof filtered[number]) => r.exp.requester_name || "—" },
                  { header: "Aprovador atual", cell: (r: typeof filtered[number]) => r.exp.current_approver || "—" },
                  { header: "Data doc.", cell: (r: typeof filtered[number]) => r.exp.doc_date ? new Date(r.exp.doc_date).toLocaleDateString("pt-BR") : "—" },
                  { header: "Vencimento", cell: (r: typeof filtered[number]) => r.exp.due_date ? new Date(r.exp.due_date).toLocaleDateString("pt-BR") : "—" },
                  { header: "Total", align: "right" as const, cell: (r: typeof filtered[number]) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(r.exp.currency) ? r.exp.currency : "BRL" }).format(r.exp.total_amount) },
                  { header: "ERP #", cell: (r: typeof filtered[number]) => r.exp.sap_doc_num ? `#${r.exp.sap_doc_num}` : "—" },
                  { header: "Origem", cell: (r: typeof filtered[number]) => r.origin === "erp_flow" ? "ERP Flow" : "ERP" },
                ],
                rows: filtered,
                fileName: isSales ? "vendas" : "compras",
              };
              return (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 w-full sm:w-auto justify-center"
                    disabled={filtered.length === 0}
                    onClick={() => { void exportListReportPdf(reportOptions); }}
                    title="Exportar em PDF respeitando os filtros aplicados"
                  >
                    <FileDown className="w-4 h-4" aria-hidden="true" /> <span className="truncate">Exportar PDF</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 w-full sm:w-auto justify-center"
                    disabled={filtered.length === 0}
                    onClick={() => { exportListReportCsv(reportOptions); }}
                    title="Exportar em CSV respeitando os filtros aplicados"
                  >
                    <FileDown className="w-4 h-4" aria-hidden="true" /> <span className="truncate">Exportar CSV</span>
                  </Button>
                </>
              );
            })()}
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="gap-1.5 col-span-2 sm:col-span-1 w-full sm:w-auto justify-center"
            >
              <Plus className="w-4 h-4" aria-hidden="true" /> <span className="truncate">{newButtonLabel}</span>
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3 sm:gap-4">
          <div className="glass-card px-4 py-3 flex items-center gap-3 min-w-0">
            <DollarSign className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold font-mono text-foreground truncate">{formatCurrency(totalValue)}</p>
            </div>
          </div>
          <div className="glass-card px-4 py-3 flex items-center gap-3 min-w-0">
            <Calendar className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Registros</p>
              <p className="text-lg font-bold font-mono text-foreground">{filtered.length}</p>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <section
          aria-label="Busca e filtros"
          className="space-y-3"
        >
          {/* Search row + mobile filter toggle */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 lg:max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="expenses-search" className="sr-only">{searchPlaceholder}</label>
              <Input
                id="expenses-search"
                type="search"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={searchPlaceholder}
                aria-busy={isSearchPending}
                className="pl-9 pr-9 bg-muted/30 border-border"
              />
              {isSearchPending && (
                <Loader2
                  className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin"
                  aria-hidden="true"
                />
              )}
              <span className="sr-only" role="status" aria-live="polite">
                {isSearchPending ? "Buscando…" : ""}
              </span>
            </div>
            {(() => {
              const activeFilters =
                (statusFilter !== "all" ? 1 : 0) +
                (sourceMode !== "flow" ? 1 : 0) +
                (showAll !== isAdmin ? 1 : 0);
              return (
                <Button
                  ref={filtersToggleRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="lg:hidden gap-1.5 shrink-0"
                  onClick={() => {
                    filtersJustOpened.current = !filtersOpen;
                    filtersJustClosed.current = filtersOpen;
                    setFiltersOpen((v) => !v);
                  }}
                  aria-expanded={filtersOpen}
                  aria-controls="expenses-filters"
                  aria-label={`${filtersOpen ? "Ocultar" : "Mostrar"} filtros${activeFilters > 0 ? ` (${activeFilters} ativos)` : ""}`}
                >
                  <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                  Filtros
                  {activeFilters > 0 && (
                    <span
                      className="ml-1 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center"
                      aria-hidden="true"
                    >
                      {activeFilters}
                    </span>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${filtersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </Button>
              );
            })()}
          </div>

          {/* Filters (collapsed on mobile, inline on desktop) */}
          <div
            id="expenses-filters"
            ref={filtersPanelRef}
            role="region"
            aria-label="Filtros de lançamentos"
            aria-hidden={!filtersOpen ? undefined : false}
            className={`${filtersOpen ? "flex" : "hidden"} lg:flex flex-col lg:flex-row lg:items-center gap-3 lg:flex-wrap`}
          >
            <div role="group" aria-label="Filtrar por status" className="flex gap-1 flex-wrap">
              {statusOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => preserveScroll(() => setStatusFilter(opt.value))}
                  aria-pressed={statusFilter === opt.value}
                  aria-label={`Status: ${opt.label}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
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
              <div
                role="group"
                aria-label="Origem dos pedidos"
                className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 text-xs w-full sm:w-auto"
              >
                <button
                  type="button"
                  onClick={() => setSourceMode("flow")}
                  aria-pressed={sourceMode === "flow"}
                  className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                    sourceMode === "flow"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Apenas ERP Flow
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("both")}
                  aria-pressed={sourceMode === "both"}
                  className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                    sourceMode === "both"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Ambos (ERP Flow + ERP)
                  {isLoadingSap && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                </button>
              </div>
            )}
            {isAdmin && (
              <div className="flex items-center gap-2 glass-card px-3 py-2 lg:ml-auto">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <Label htmlFor="show-all-expenses" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                  Ver todos os lançamentos
                </Label>
                <Switch id="show-all-expenses" checked={showAll} onCheckedChange={setShowAll} />
              </div>
            )}
            {(search || statusFilter !== "all" || sourceMode !== "flow" || showAll !== isAdmin) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground lg:ml-2"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setSourceMode("flow");
                  setShowAll(isAdmin);
                }}
              >
                <XIcon className="w-3.5 h-3.5 mr-1" /> Limpar filtros
              </Button>
            )}
          </div>
        </section>



        {/* Content */}
        {isLoading ? (
          <div aria-busy="true" aria-live="polite">
            <span className="sr-only">Carregando lançamentos…</span>
            {/* Skeleton cards (mobile / tablet / laptop) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 xl:hidden">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex items-center justify-between pt-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>
              ))}
            </div>
            {/* Skeleton table (widescreen) */}
            <div className="hidden xl:block glass-card overflow-hidden">
              <div className="p-3 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-8 gap-3 items-center py-2 border-b border-border/40 last:border-0">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-4 w-full col-span-2" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                    <Skeleton className="h-6 w-16 ml-auto" />
                  </div>
                ))}
              </div>
            </div>
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
          <>
            {/* Card grid (mobile / tablet / laptop) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 xl:hidden">
              {visibleItems.map(({ exp, origin }) => (
                <ExpenseCard
                  key={exp.id}
                  expense={exp}
                  originBadge={origin}
                  onOpen={() => openExpense(exp, origin)}
                  onRelationsMap={origin === "erp_flow" ? () => setRelationsMapExpense(exp) : undefined}
                />
              ))}
            </div>

            {/* Table view (widescreen) */}
            <div className="hidden xl:block glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr className="text-left">
                      <SortableTh label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Fornecedor" k="supplier" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Solicitante" k="requester" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Criado" k="created" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Doc" k="doc" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Vence" k="due" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Valor" k="amount" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <th className="px-4 py-2.5 font-medium text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map(({ exp, origin }) => (
                      <tr
                        key={exp.id}
                        className="border-t border-border/60 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => openExpense(exp, origin)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className={STATUS_COLORS[exp.status]}>{STATUS_LABELS[exp.status]}</Badge>
                            {origin === "erp_flow" && (
                              <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">ERP Flow</Badge>
                            )}
                            {origin === "erp" && (
                              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">ERP</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 max-w-[260px]">
                          <div className="flex items-center gap-2 text-foreground">
                            <Building2 className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                            <span className="truncate">{exp.supplier_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-foreground">{exp.requester_name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(exp.created_at)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                          {exp.doc_date ? formatDate(exp.doc_date) : "—"}
                        </td>
                        <td className={`px-4 py-2.5 whitespace-nowrap ${exp.due_date ? "text-foreground" : "text-destructive font-medium"}`}>
                          {exp.due_date ? formatDate(exp.due_date) : "sem data"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground whitespace-nowrap">
                          {formatCurrency(exp.total_amount, exp.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                              aria-label={`Abrir lançamento de ${exp.supplier_name}`}
                              title="Ver detalhes"
                              onClick={(ev) => { ev.stopPropagation(); openExpense(exp, origin); }}
                            >
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            </Button>
                            {origin === "erp_flow" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-primary"
                                aria-label={`Mapa de relações de ${exp.supplier_name}`}
                                title="Mapa de relações"
                                onClick={(ev) => { ev.stopPropagation(); setRelationsMapExpense(exp); }}
                              >
                                <Network className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination controls (compartilhada entre cards e tabela) */}
            {sorted.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>
                    Mostrando <span className="text-foreground font-medium">{pageStart + 1}</span>–
                    <span className="text-foreground font-medium">{Math.min(pageStart + pageSize, sorted.length)}</span> de{" "}
                    <span className="text-foreground font-medium">{sorted.length}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="hidden sm:inline">·</span>
                    <label htmlFor="page-size" className="whitespace-nowrap">por página</label>
                    <select
                      id="page-size"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-1 self-end sm:self-auto">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(1)} disabled={page <= 1} aria-label="Primeira página">
                    <ChevronLeft className="w-3.5 h-3.5" /><ChevronLeft className="w-3.5 h-3.5 -ml-2.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Anterior">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="px-2 whitespace-nowrap">
                    Página <span className="text-foreground font-medium">{page}</span> de{" "}
                    <span className="text-foreground font-medium">{totalPages}</span>
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} aria-label="Próxima">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label="Última página">
                    <ChevronRight className="w-3.5 h-3.5" /><ChevronRight className="w-3.5 h-3.5 -ml-2.5" />
                  </Button>
                </div>
              </div>
            )}
            {showSourceToggle && sourceMode === "both" && (sapHasMore || isLoadingMoreSap) && (
              <div className="mt-6 space-y-4">
                {isLoadingMoreSap && (
                  <div
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 xl:hidden"
                    aria-busy="true"
                    aria-live="polite"
                  >
                    <span className="sr-only">Carregando mais pedidos do ERP…</span>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="glass-card p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Skeleton className="h-5 w-20" />
                          <Skeleton className="h-4 w-16" />
                        </div>
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <div className="flex items-center justify-between pt-2">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-5 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={loadMoreSap}
                    disabled={isLoadingMoreSap || !sapHasMore}
                    aria-busy={isLoadingMoreSap}
                    className="gap-2"
                  >
                    {isLoadingMoreSap ? (
                      <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Carregando mais…</>
                    ) : (
                      <>Mostrar mais</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <ExpenseDetailModal
        expense={selectedExpense}
        originBadge={selectedOrigin}
        open={!!selectedExpense}
        onClose={() => setSelectedExpense(null)}
        onSubmit={handleSubmitForApproval}
        onCancel={handleCancel}
        onRetrySap={handleRetrySap}
        onEdit={(exp) => { setSelectedExpense(null); setEditingExpense(exp); }}
        onApprove={handleApprove}
        onReject={handleReject}
        onViewIntegration={handleViewIntegration}
        onAddAttachments={async (id, files) => { await addAttachments(id, files); }}
        canCancel={selectedExpense ? canCancel(selectedExpense) : false}
        canEdit={selectedExpense ? canCancel(selectedExpense) : false}
        canRetrySap={session.erpType === "sap" && (isAdmin || (selectedExpense ? canCancel(selectedExpense) : false))}
        canApprove={selectedExpense ? canApprove(selectedExpense) : false}
        canAddAttachments={
          !!selectedExpense &&
          (selectedExpense.status === "rascunho" || selectedExpense.status === "pendente_aprovacao") &&
          (isAdmin || canCancel(selectedExpense))
        }
        isSubmitting={isSubmitting}
        isCancelling={isCancelling}
        isRetrying={isRetrying}
        isActioning={isActioning}
        mode={mode}
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
        onClose={() => { setShowCreate(false); setPendingDraft(null); void refreshDrafts(); }}
        onCreate={handleCreate}
        sapSession={session}
        mode={mode}
        initialDraft={pendingDraft}
        onDraftConsumed={() => setPendingDraft(null)}
        onDraftSaved={() => { void refreshDrafts(); }}
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
