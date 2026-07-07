import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  User,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  RefreshCw,
  Loader2,
  ArrowLeft,
  LayoutGrid,
  List,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useApprovals, type ApprovalDoc, type DocumentLine } from "@/hooks/useApprovals";
import { useExpenses, type Expense } from "@/hooks/useExpenses";
import { useMyRequests, type MyRequestDoc, type ApprovalHistoryEntry } from "@/hooks/useMyRequests";
import { useLazyList } from "@/hooks/useLazyList";
import { useNavigate } from "react-router-dom";
import { Activity, LogOut, Eye, CheckCircle, XCircle, Paperclip, X, CheckCircle2, XOctagon, History, UserCog, ChevronsUpDown, Check, Network, FileDown } from "lucide-react";
import { exportListReportPdf, exportListReportCsv } from "@/lib/report-pdf";
import { useSap } from "@/contexts/SapContext";
import { useAuth } from "@/hooks/useAuth";
import { useModuleAccess } from "@/hooks/usePermissions";
import { sapAction, sapQuery, sapDownloadAttachment, clearClientCache } from "@/lib/sap-client";
import { toast } from "sonner";
import { useSapUsers } from "@/hooks/useSapUsers";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Split } from "lucide-react";
import { useApproverCostCenters } from "@/hooks/useApproverCostCenters";
import { useActiveOfficialsForMe } from "@/hooks/useApproverSubstitutes";
import { useCostCenterNames } from "@/hooks/useCostCenterNames";
import { shouldShowRateio, sumSelectedShare, type RateioInfo } from "@/lib/rateio";
import { segmentDocByRules, segmentsForApprover, isTrulySegmented, type ApprovalSegment } from "@/lib/approvalSegments";
import { useApprovalRules, type ApprovalRule } from "@/hooks/useApprovalRules";
import { Checkbox } from "@/components/ui/checkbox";
import { RelationsMap } from "@/components/RelationsMap";

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
import { Textarea } from "@/components/ui/textarea";
import { useCompanies } from "@/hooks/useCompanies";
import { PageTitle } from "@/components/PageTitle";

function formatCurrency(value: number, currency: string = "BRL") {
  const code = /^[A-Z]{3}$/.test((currency || "").toUpperCase()) ? currency.toUpperCase() : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return `${code} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function isOverdue(dueDate: string): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function ApprovalCard({
  doc,
  onOpen,
  approverCCs,
  formatCostCenter,
  onRelationsMap,
}: {
  doc: ApprovalDoc;
  onOpen: () => void;
  approverCCs: Set<string>;
  formatCostCenter: (code?: string | null) => string;
  onRelationsMap?: () => void;
}) {
  const overdue = isOverdue(doc.dueDate);
  const { show: showRateio, info } = shouldShowRateio(doc);

  // Centros de custo mapeados que aparecem neste documento
  const matchedCCs = showRateio
    ? info.byCC.filter((cc) => approverCCs.has(cc.code))
    : [];
  const approverShare = matchedCCs.reduce((s, cc) => s + cc.amount, 0);
  const hasAutoShare = matchedCCs.length > 0;

  // Centro de custo "principal" para exibir no card (igual ao print)
  const primaryCC = hasAutoShare
    ? matchedCCs[0]
    : showRateio
      ? info.byCC[0]
      : (() => {
          const code = (doc.documentLines || [])
            .map((l) => (l.CostingCode || "").trim())
            .find((c) => c.length > 0);
          return code ? { code, amount: doc.docTotal, percent: 100 } : null;
        })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card p-5 flex flex-col gap-3 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all ${overdue ? "border-destructive/40" : ""}`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {doc.docTypeName}
          </span>
          <h3 className="text-foreground font-semibold mt-2 font-mono">#{doc.docNum}</h3>
        </div>
        <div className="text-right flex items-start gap-1">
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
          <div>
            <p className="text-lg font-bold text-foreground font-mono">{formatCurrency(doc.docTotal, doc.currency)}</p>
            {overdue && (
              <span className="text-[10px] font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded-full uppercase">
                Vencido
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="w-3.5 h-3.5 text-primary/70" />
          <span className="truncate">{doc.cardName}</span>
        </div>
        {primaryCC && (
          <div className="flex items-center gap-2 text-muted-foreground min-w-0">
            <Split className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">C. Custo</span>
            {showRateio && (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                Rateado
              </span>
            )}
            <span className="text-foreground font-medium truncate">{formatCostCenter(primaryCC.code)}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <User className="w-3.5 h-3.5 text-primary/70" />
          <span>Aprovador: <span className="text-foreground font-medium">{doc.currentApprover}</span></span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <FileText className="w-3.5 h-3.5 text-primary/70" />
          <span>Solicitante: <span className="text-foreground font-medium">{doc.requester}</span></span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="w-3.5 h-3.5 text-primary/70" />
            <span>Criado: {formatDate(doc.docDate)}</span>
          </div>
          <div className={`flex items-center gap-1 text-xs font-medium ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
            <Clock className="w-3 h-3" />
            {formatDate(doc.dueDate)}
          </div>
        </div>
        {hasAutoShare && approverShare > 0 && approverShare < info.total && (
          <div className="mt-1 pt-2 border-t border-border/50 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sob sua alçada</span>
            <span className="text-sm font-bold font-mono text-emerald-600">
              {formatCurrency(approverShare, doc.currency)}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function DelegationDialog({
  open,
  onClose,
  doc,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onClose: () => void;
  doc: ApprovalDoc | null;
  onConfirm: (params: { userInternalKey: number; userName: string; userEmail: string; reason: string }) => Promise<void>;
  isSubmitting: boolean;
}) {
  const { users, isLoading } = useSapUsers();
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Reset state when reopened
  const resetAndClose = () => {
    setSelectedKey(null);
    setReason("");
    setPickerOpen(false);
    onClose();
  };

  const selectedUser = users.find((u) => u.InternalKey === selectedKey);
  const eligibleUsers = users.filter((u) => u.Locked !== "tYES" && (u.UserName || u.UserCode));

  const handleConfirm = async () => {
    if (!selectedUser || !selectedKey) {
      toast.error("Selecione um usuário para delegar.");
      return;
    }
    await onConfirm({
      userInternalKey: selectedKey,
      userName: selectedUser.UserName || selectedUser.UserCode,
      userEmail: selectedUser.eMail || "",
      reason: reason.trim(),
    });
    resetAndClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5 text-primary" />
            Delegar aprovação
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="text-sm bg-muted/30 rounded-lg p-3 space-y-1">
            <p className="text-muted-foreground text-xs">Documento</p>
            <p className="text-foreground font-medium">
              <span className="font-mono">#{doc?.docNum}</span> · {doc?.docTypeName}
            </p>
            <p className="text-xs text-muted-foreground">
              Aprovador atual: <span className="text-foreground">{doc?.currentApprover}</span>
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Novo aprovador *</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                  disabled={isLoading || isSubmitting}
                >
                  {selectedUser
                    ? `${selectedUser.UserName || selectedUser.UserCode}${selectedUser.eMail ? ` (${selectedUser.eMail})` : ""}`
                    : isLoading ? "Carregando usuários..." : "Selecionar usuário..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar por nome ou e-mail..." />
                  <CommandList>
                    <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                    <CommandGroup>
                      {eligibleUsers.map((u) => (
                        <CommandItem
                          key={u.InternalKey}
                          value={`${u.UserName} ${u.UserCode} ${u.eMail || ""}`}
                          onSelect={() => {
                            setSelectedKey(u.InternalKey);
                            setPickerOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", selectedKey === u.InternalKey ? "opacity-100" : "opacity-0")} />
                          <div className="flex flex-col">
                            <span className="text-sm">{u.UserName || u.UserCode}</span>
                            {u.eMail && <span className="text-xs text-muted-foreground">{u.eMail}</span>}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Motivo da delegação</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: Aprovador em férias, transferência de responsabilidade..."
              className="bg-muted/30 border-border text-sm"
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-300">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Esta ação será registrada no log de auditoria.</span>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Button variant="outline" onClick={resetAndClose} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={isSubmitting || !selectedKey} className="gap-1.5">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCog className="w-4 h-4" />}
              Delegar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalDetailModal({
  doc,
  open,
  onClose,
  onAction,
  onRetryRefresh,
  onDelegate,
  isActioning,
  actionPhase,
  isSuperUser,
  currentUserName,
  currentUserEmail,
  approverCCs,
  formatCostCenter,
  rules,
  isAdmin,
  canApprove,
}: {
  doc: ApprovalDoc | null;
  open: boolean;
  onClose: () => void;
  onAction: (code: number, action: "approve" | "reject", remarks: string, opts?: { idempotencyKey?: string }) => Promise<void>;
  onRetryRefresh: () => Promise<void>;
  onDelegate: (doc: ApprovalDoc) => void;
  isActioning: boolean;
  actionPhase: "idle" | "sending" | "refreshing";
  isSuperUser: boolean;
  currentUserName: string;
  currentUserEmail?: string;
  approverCCs: Set<string>;
  formatCostCenter: (code?: string | null) => string;
  rules: ApprovalRule[];
  isAdmin: boolean;
  canApprove: boolean;
}) {
  const [remarks, setRemarks] = useState("");
  const [riskConfirm, setRiskConfirm] = useState<{ action: "approve" | "reject"; idempotencyKey: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"mutation" | "refresh" | null>(null);
  const [downloadingName, setDownloadingName] = useState<string | null>(null);
  const [showAllLines, setShowAllLines] = useState(false);
  const { session } = useSap();

  // Rateio — sempre derivado do doc atual
  const rateio = doc ? shouldShowRateio(doc) : { show: false, info: { isSplit: false, byCC: [], total: 0 } as RateioInfo };
  const [selectedCCs, setSelectedCCs] = useState<Set<string>>(new Set());

  // Segmentação por regra — cada grupo de linhas pode cair em regras/aprovadores diferentes
  const segments: ApprovalSegment[] = useMemo(
    () => (doc ? segmentDocByRules(doc, rules) : []),
    [doc, rules],
  );
  const segmented = isTrulySegmented(segments);
  const mySegments = useMemo(
    () => segmentsForApprover(segments, currentUserName, currentUserEmail),
    [segments, currentUserName, currentUserEmail],
  );
  // Aprovador comum (não admin, não super) só vê linhas dos segmentos que lhe cabem.
  const restrictToMySegments = segmented && !isAdmin && !isSuperUser && mySegments.length > 0 && !showAllLines;
  const visibleLines = restrictToMySegments
    ? mySegments.flatMap((s) => s.lines)
    : (doc?.documentLines || []);
  const visibleTotal = restrictToMySegments
    ? mySegments.reduce((s, seg) => s + (doc?.currency !== "BRL" ? seg.amountFC : seg.amount), 0)
    : (doc?.docTotal || 0);

  // Sempre que troca de documento, pré-seleciona CCs mapeados (ou nenhum se não houver mapping)
  // e limpa o campo de Observação para não vazar texto do card anterior.
  useEffect(() => {
    if (!doc) return;
    const preselected = rateio.info.byCC
      .map((cc) => cc.code)
      .filter((code) => approverCCs.has(code));
    setSelectedCCs(new Set(preselected));
    setRemarks("");
    setShowAllLines(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.approvalRequestId]);

  // Também limpa ao fechar o modal, garantindo estado limpo na próxima abertura.
  useEffect(() => {
    if (!open) setRemarks("");
  }, [open]);

  const handleDownloadAttachment = async (name: string) => {
    if (!doc || !doc.attachmentEntry || !session || session.erpType !== "sap") {
      toast.error("Anexo indisponível");
      return;
    }
    setDownloadingName(name);
    try {
      const { blob } = await sapDownloadAttachment(session, doc.attachmentEntry, name);
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        toast.error("Pop-up bloqueado. Permita pop-ups para visualizar o anexo.");
      }
      // Revoga a URL depois de um tempo para permitir o carregamento na nova aba
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

    } catch (e) {
      console.error("Erro ao baixar anexo:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao baixar anexo");
    } finally {
      setDownloadingName(null);
    }
  };


  if (!doc) return null;

  const overdue = isOverdue(doc.dueDate);
  const isOtherApprover = isSuperUser && doc.currentApprover.toLowerCase() !== currentUserName.toLowerCase();

  const handleAction = (action: "approve" | "reject") => {
    // Sempre confirmar antes de aprovar/rejeitar — mostra resumo do que
    // está sendo decidido e destaca quando é super-usuário agindo em
    // documento de outro aprovador.
    setActionError(null);
    // Gera uma chave de idempotência por INTENÇÃO do usuário (um clique em
    // Aprovar/Rejeitar). A mesma chave é reutilizada em "Tentar novamente"
    // após erro, garantindo que o servidor não processe a mesma ação duas
    // vezes caso a primeira resposta tenha se perdido.
    const idempotencyKey =
      (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRiskConfirm({ action, idempotencyKey });
  };

  const confirmRiskAction = async () => {
    if (!riskConfirm || !doc || isActioning) return;
    setActionError(null);
    setErrorKind(null);
    try {
      await onAction(doc.approvalRequestId, riskConfirm.action, remarks, {
        idempotencyKey: riskConfirm.idempotencyKey,
      });
      setRiskConfirm(null);
    } catch (e) {
      // Mantém o modal aberto. Distingue erro da mutação (retry reexecuta
      // com mesma Idempotency-Key) de erro de refresh (retry só atualiza).
      const isRefresh = e instanceof Error && e.name === "RefreshError";
      setErrorKind(isRefresh ? "refresh" : "mutation");
      setActionError(e instanceof Error ? e.message : "Erro ao processar ação");
    }
  };

  const retryRefreshFromModal = async () => {
    if (isActioning) return;
    setActionError(null);
    setErrorKind(null);
    try {
      await onRetryRefresh();
      setRiskConfirm(null);
    } catch (e) {
      setErrorKind("refresh");
      setActionError(e instanceof Error ? e.message : "Erro ao atualizar a lista");
    }
  };


  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {doc.docTypeName}
              </span>
              <span className="font-mono">#{doc.docNum}</span>
              <span className="text-2xl font-bold font-mono ml-auto">{formatCurrency(doc.docTotal, doc.currency)}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex justify-end -mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                void exportListReportPdf({
                  title: `Pedido de Aprovação — ${doc.cardName}`,
                  subtitle: `#${doc.docNum} · ${doc.docTypeName}`,
                  meta: [
                    { label: "Parceiro", value: `${doc.cardName} (${doc.cardCode})` },
                    { label: "Solicitante", value: doc.requester || "—" },
                    { label: "Aprovador atual", value: doc.currentApprover || "—" },
                    { label: "Etapa", value: doc.currentStage || "—" },
                    { label: "Modelo", value: doc.approvalModel || "—" },
                    { label: "Data do documento", value: doc.docDate ? new Date(doc.docDate).toLocaleDateString("pt-BR") : "—" },
                    { label: "Vencimento", value: doc.dueDate ? new Date(doc.dueDate).toLocaleDateString("pt-BR") : "—" },
                    { label: "Dias em aberto", value: String(doc.daysOpen ?? "—") },
                    { label: "Total", value: new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(doc.currency) ? doc.currency : "BRL" }).format(doc.docTotal) },
                    ...(doc.remarks ? [{ label: "Observações", value: doc.remarks }] : []),
                    ...(doc.attachmentNames ? [{ label: "Anexos ERP", value: doc.attachmentNames }] : []),
                  ],
                  columns: [
                    { header: "Item", cell: (l) => l.ItemCode || "—" },
                    { header: "Descrição", cell: (l) => l.Description || "—" },
                    { header: "Qtd", align: "right", cell: (l) => String(l.Quantity ?? 0) },
                    { header: "Unit.", align: "right", cell: (l) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(doc.currency) ? doc.currency : "BRL" }).format(Number(l.UnitPrice) || 0) },
                    { header: "Total", align: "right", cell: (l) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(doc.currency) ? doc.currency : "BRL" }).format(Number(l.LineTotal) || 0) },
                    { header: "C. Custo", cell: (l) => l.CostingCode || "—" },
                    { header: "Projeto", cell: (l) => l.Project || "—" },
                  ],
                  rows: doc.documentLines || [],
                  fileName: `aprovacao_${doc.docNum}`,
                });
              }}
            >
              <FileDown className="w-3.5 h-3.5" /> Exportar relatório
            </Button>
          </div>


          <div className="space-y-4 mt-2">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Fornecedor</p>
                <p className="text-foreground font-medium">{doc.cardName}</p>
                <p className="text-xs text-muted-foreground font-mono">{doc.cardCode}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Solicitante</p>
                <p className="text-foreground font-medium">{doc.requester}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Aprovador</p>
                <p className="text-foreground font-medium">{doc.currentApprover}</p>
                {doc.approverEmail && (
                  <p className="text-xs text-muted-foreground">{doc.approverEmail}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Modelo de Aprovação</p>
                <p className="text-foreground text-sm">{doc.approvalModel || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Data de Criação</p>
                <p className="text-foreground">{formatDate(doc.docDate)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Data de Vencimento</p>
                <p className={!doc.dueDate ? "text-destructive font-semibold" : overdue ? "text-destructive font-semibold" : "text-foreground"}>
                  {doc.dueDate ? formatDate(doc.dueDate) : "sem data"}
                  {overdue && doc.dueDate && " ⚠ Vencido"}
                </p>
              </div>
              {doc.daysOpen > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Dias em Aberto</p>
                  <p className="text-foreground font-mono">{doc.daysOpen}</p>
                </div>
              )}
            </div>

            {/* Remarks */}
            {doc.remarks && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Observações</p>
                <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3">{doc.remarks}</p>
              </div>
            )}

            {/* Painel de Rateio entre Centros de Custo */}
            {rateio.show && (
              <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Split className="w-4 h-4 text-emerald-500" />
                  <h4 className="text-sm font-semibold text-foreground">Documento Rateado entre Centros de Custo</h4>
                </div>
                <p className="text-xs text-muted-foreground">
                  Assinale os centros de custo que correspondem à sua alçada de aprovação para calcular o valor do rateio em aprovação.
                </p>
                <div className="space-y-1.5">
                  {rateio.info.byCC.map((cc) => {
                    const checked = selectedCCs.has(cc.code);
                    return (
                      <label
                        key={cc.code}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-background/40 hover:bg-background/70 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setSelectedCCs((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(cc.code);
                              else next.delete(cc.code);
                              return next;
                            });
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground font-medium truncate">{formatCostCenter(cc.code)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {cc.pct.toFixed(1)}% do documento
                          </p>
                        </div>
                        <span className="text-sm font-mono font-semibold text-foreground">
                          {formatCurrency(cc.amount, doc.currency)}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-emerald-500/20">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Sua alçada de aprovação para este documento
                  </span>
                  <span className="text-lg font-bold font-mono text-emerald-600">
                    {formatCurrency(sumSelectedShare(rateio.info, selectedCCs), doc.currency)}
                  </span>
                </div>
              </div>
            )}

            {/* Painel de segmentação por regra */}
            {segmented && (
              <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Split className="w-4 h-4 text-primary" />
                  <h4 className="text-sm font-semibold text-foreground">
                    Aprovação segmentada por regra
                  </h4>
                  <Badge variant="outline" className="text-[10px]">
                    {segments.length} segmentos
                  </Badge>
                  {restrictToMySegments && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                      Vendo só sua parte
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  As linhas deste documento caem em regras de aprovação diferentes. Cada aprovador
                  vê apenas as linhas e o valor da sua alçada.
                </p>
                <div className="space-y-1.5">
                  {segments.map((seg) => {
                    const isMine = mySegments.some((m) => m.costCenter === seg.costCenter);
                    return (
                      <div
                        key={seg.costCenter}
                        className={`rounded-lg border p-2.5 text-xs ${
                          isMine
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-border bg-background/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-foreground truncate">
                              {seg.costCenter === "__no_cc__"
                                ? "Sem centro de custo"
                                : formatCostCenter(seg.costCenter)}
                            </span>
                            {isMine && (
                              <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-600">
                                Sua alçada
                              </Badge>
                            )}
                          </div>
                          <span className="font-mono font-semibold text-foreground">
                            {formatCurrency(
                              doc.currency !== "BRL" ? seg.amountFC : seg.amount,
                              doc.currency,
                            )}{" "}
                            <span className="text-muted-foreground font-normal">
                              ({seg.pct.toFixed(1)}%)
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {seg.rule?.name || "Sem regra correspondente"}
                          </span>
                          {seg.approverNames.length > 0 && (
                            <>
                              <span>·</span>
                              <span>{seg.approverNames.join(" → ")}</span>
                            </>
                          )}
                          <span>·</span>
                          <span>{seg.lines.length} linha{seg.lines.length === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {segmented && !isAdmin && !isSuperUser && mySegments.length > 0 && (
                  <div className="pt-2 border-t border-primary/20 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Total dos seus segmentos:{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {formatCurrency(visibleTotal, doc.currency)}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowAllLines((v) => !v)}
                    >
                      {showAllLines ? "Ver só minha parte" : "Ver documento completo"}
                    </Button>
                  </div>
                )}
                {segmented && mySegments.length === 0 && !isAdmin && !isSuperUser && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    Nenhum segmento deste documento aponta para você como aprovador — pode ser
                    que você esteja atuando por delegação ou uma regra fora do escopo do app.
                  </p>
                )}
              </div>
            )}

            {/* Document Lines */}
            {visibleLines.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Itens do Documento
                    {restrictToMySegments && (
                      <span className="ml-2 normal-case tracking-normal text-[10px] text-muted-foreground">
                        (mostrando {visibleLines.length} de {doc.documentLines.length})
                      </span>
                    )}
                  </p>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="text-left py-2 px-3 text-muted-foreground">Código</th>
                        <th className="text-left py-2 px-3 text-muted-foreground">Descrição</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Qtd</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Preço Unit.</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Total</th>
                        <th className="text-left py-2 px-3 text-muted-foreground">Projeto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLines.map((line, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-2 px-3 font-mono text-muted-foreground">{line.ItemCode}</td>
                          <td className="py-2 px-3 text-foreground">{line.Description}</td>
                          <td className="py-2 px-3 text-right font-mono">{line.Quantity}</td>
                          <td className="py-2 px-3 text-right font-mono">{formatCurrency(doc.currency !== "BRL" && line.PriceFC ? line.PriceFC : line.UnitPrice, doc.currency)}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium">{formatCurrency(doc.currency !== "BRL" && line.LineTotalFC ? line.LineTotalFC : line.LineTotal, doc.currency)}</td>
                          <td className="py-2 px-3 text-muted-foreground">{line.Project || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Attachments */}
            {doc.attachmentNames && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Paperclip className="w-3 h-3" /> Anexos
                </p>
                <div className="space-y-1">
                  {doc.attachmentNames.split("|").map((raw, i) => {
                    const name = raw.trim();
                    if (!name) return null;
                    const canDownload = doc.attachmentEntry > 0;
                    const isLoading = downloadingName === name;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={!canDownload || isLoading}
                        onClick={() => handleDownloadAttachment(name)}
                        className="w-full text-left text-xs bg-muted/20 hover:bg-muted/40 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                        title={canDownload ? "Baixar anexo" : "Anexo indisponível"}
                      >
                        {isLoading ? (
                          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        ) : (
                          <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate text-foreground">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Internal (Storage) attachments */}
            {doc.internalAttachments && doc.internalAttachments.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Paperclip className="w-3 h-3" /> Anexos
                </p>
                <div className="space-y-1">
                  {doc.internalAttachments.map((att) => (
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
                          toast.error("Não foi possível abrir o anexo");
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
                </div>
              </div>
            )}


            {/* Super-user warning */}
            {isOtherApprover && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-sm text-amber-200">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Você está atuando como super-usuário. O aprovador designado é <strong>{doc.currentApprover}</strong>.</span>
              </div>
            )}

            {/* Action area */}
            <div className="border-t border-border pt-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Comentário (opcional)</p>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Adicione um comentário à sua decisão..."
                  className="bg-muted/30 border-border text-sm"
                  rows={2}
                />
              </div>
              <div className="flex gap-2 justify-end flex-wrap">
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isActioning}
                >
                  Cancelar
                </Button>
                {isSuperUser && doc.approvalRequestId > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => onDelegate(doc)}
                    disabled={isActioning}
                    className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                  >
                    <UserCog className="w-4 h-4" />
                    Delegar
                  </Button>
                )}
                {canApprove ? (
                  <>
                    <Button
                      variant="destructive"
                      onClick={() => handleAction("reject")}
                      disabled={isActioning}
                      className="gap-1.5"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Rejeitar
                    </Button>
                    <Button
                      onClick={() => handleAction("approve")}
                      disabled={isActioning}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      Aprovar
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground italic self-center">
                    Somente leitura — você não é o aprovador deste documento
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de aprovação / rejeição — sempre exibida com resumo */}
      <AlertDialog open={!!riskConfirm} onOpenChange={(v) => { if (!v && !isActioning) { setRiskConfirm(null); setActionError(null); } }}>
        <AlertDialogContent
          role="alertdialog"
          aria-modal="true"
          aria-busy={isActioning || undefined}
          onKeyDown={(e) => {
            // Atalho: Ctrl/Cmd+Enter confirma a ação (evita disparo acidental
            // com Enter simples). Esc é tratado nativamente pelo Radix.
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !isActioning) {
              e.preventDefault();
              void confirmRiskAction();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {riskConfirm?.action === "approve" ? (
                <CheckCircle className="w-5 h-5 text-emerald-500" />
              ) : (
                <XCircle className="w-5 h-5 text-destructive" />
              )}
              Confirmar {riskConfirm?.action === "approve" ? "aprovação" : "rejeição"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Você está prestes a{" "}
                  <strong>
                    {riskConfirm?.action === "approve" ? "aprovar" : "rejeitar"}
                  </strong>{" "}
                  o documento abaixo. Confirme os dados antes de prosseguir.
                </p>
                <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Tipo</span>
                    <span className="font-medium">{doc?.docTypeName}</span>
                  </div>
                  {doc?.docNum ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Documento</span>
                      <span className="font-mono">#{doc.docNum}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Fornecedor</span>
                    <span className="font-medium text-right break-words">{doc?.cardName || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Solicitante</span>
                    <span className="text-right break-words">{doc?.requester || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Aprovador atual</span>
                    <span className="text-right break-words">{doc?.currentApprover || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3 pt-1 border-t border-border/60 mt-1">
                    <span className="text-muted-foreground">Valor total</span>
                    <span className="font-mono font-semibold">
                      {doc ? formatCurrency(doc.docTotal, doc.currency) : "—"}
                    </span>
                  </div>
                </div>
                {remarks && (
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">
                      Comentário
                    </div>
                    <div className="text-xs break-words whitespace-pre-wrap">{remarks}</div>
                  </div>
                )}
                {isOtherApprover && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-xs">
                      Você está agindo como <strong>super-usuário</strong> em um documento
                      atribuído a outro aprovador. A ação ficará registrada com essa marcação.
                    </p>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground pt-1">
                  Atalhos: <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Esc</kbd> cancela · <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Enter</kbd> confirma.
                </p>
              </div>
          </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && (
            <div
              role="alert"
              aria-live="assertive"
              className={`flex items-start gap-2 rounded-md border p-3 ${
                errorKind === "refresh"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              <XOctagon className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-xs space-y-1 min-w-0">
                <p className="font-semibold">
                  {errorKind === "refresh"
                    ? "Decisão registrada, mas a lista não atualizou"
                    : "Falha ao processar a ação"}
                </p>
                <p className="break-words whitespace-pre-wrap">{actionError}</p>
                {errorKind === "refresh" && (
                  <p className="text-[11px] opacity-80">
                    A ação já foi enviada com sucesso — não reenvie a decisão. Clique em
                    "Atualizar novamente" para recarregar a lista.
                  </p>
                )}
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isActioning}
              autoFocus={!actionError}
            >
              {actionError ? "Fechar" : "Cancelar"}
            </AlertDialogCancel>
            <Button
              onClick={errorKind === "refresh" ? retryRefreshFromModal : confirmRiskAction}
              disabled={isActioning}
              autoFocus={!!actionError}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              className={`gap-1.5 ${
                errorKind === "refresh"
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : riskConfirm?.action === "reject"
                    ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }`}
            >
              {isActioning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : errorKind === "refresh" ? (
                <RefreshCw className="w-4 h-4" />
              ) : riskConfirm?.action === "approve" ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {actionPhase === "sending"
                ? "Enviando decisão…"
                : actionPhase === "refreshing"
                  ? "Atualizando lista…"
                  : errorKind === "refresh"
                    ? "Atualizar novamente"
                    : actionError
                      ? "Tentar novamente"
                      : `Sim, ${riskConfirm?.action === "approve" ? "aprovar" : "rejeitar"}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function mapInternalExpense(e: Expense): ApprovalDoc & { __internalId?: string } {
  const isPagcorp = e.origin === "pagcorp";
  return {
    approvalRequestId: -Math.abs(parseInt(e.id.replace(/\D/g, "").slice(0, 9) || "0", 10) || 1),
    docType: isPagcorp ? "Despesa PagCorp" : "Despesa Interna",
    docTypeName: isPagcorp ? "Despesa PagCorp" : "Despesa Interna",
    docNum: 0,
    docEntry: 0,
    docTotal: Number(e.total_amount || 0),
    currency: e.currency || "BRL",
    cardCode: e.supplier_code || "",
    cardName: e.supplier_name || "—",
    requester: e.requester_name || "—",
    currentApprover: e.current_approver && e.current_approver.trim() ? e.current_approver : "Administrador",
    approverEmail: "",
    currentStage: "Aprovação Interna",
    status: "pending",
    docDate: e.created_at,
    dueDate: e.due_date || "",
    remarks: e.remarks || "",
    approvalModel: "Regra Interna",
    daysOpen: Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86_400_000),
    attachmentNames: "",
    internalAttachments: (e.attachments || []).map((a) => ({
      id: a.id,
      file_name: a.file_name,
      file_path: a.file_path,
      file_size: a.file_size,
    })),
    documentLines: (e.items || []).map((it) => ({
      ItemCode: it.item_code || "",
      Description: it.description,
      Quantity: it.quantity,
      UnitPrice: it.unit_price,
      LineTotal: it.line_total,
      CostingCode: it.cost_center || "",
      Project: it.project || "",
    })),
    __internalId: e.id,
  } as ApprovalDoc & { __internalId?: string };
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1]
      ? dp[i-1][j-1]
      : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
  }
  return dp[m][n];
}

function tokensMatch(aTok: string, uTok: string): boolean {
  // Strict equality only. Fuzzy edit-distance matching was removed after a
  // false positive: an unrelated user (e.g. "samuel.ramos") was accepted as
  // an approver because their token differed by <=2 chars from a legitimate
  // approver token. Server-side authorization is the real gate, but keeping
  // the UI strict prevents surfacing an Approve button to non-approvers.
  return aTok === uTok;
}


function approverMatches(approver: string, userName: string): boolean {
  if (!approver || !userName) return false;
  const a = approver.toLowerCase().trim();
  const u = userName.toLowerCase().trim();
  if (a === u) return true;
  // try matching by first name / partial: "matheus.moreira" vs "Matheus Moreira"
  const aTokens = a.replace(/[._-]/g, " ").split(/\s+/).filter(Boolean);
  const uTokens = u.replace(/[._-]/g, " ").split(/\s+/).filter(Boolean);
  if (aTokens.length === 0 || uTokens.length === 0) return false;
  // match if all user tokens have a fuzzy-matching counterpart in approver tokens (or vice-versa)
  const allIn = (src: string[], tgt: string[]) =>
    src.every((t) => tgt.some((x) => tokensMatch(t, x)));
  return allIn(uTokens, aTokens) || allIn(aTokens, uTokens);
}

function StatusBadge({ status, label }: { status: MyRequestDoc["status"] | ApprovalHistoryEntry["status"]; label: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    approved: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    rejected: "bg-destructive/10 text-destructive border-destructive/30",
    cancelled: "bg-muted text-muted-foreground border-border",
    generated: "bg-primary/10 text-primary border-primary/30",
    without_decision: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border uppercase tracking-wider ${styles[status] || styles.pending}`}>
      {label}
    </span>
  );
}

function MyRequestDetailModal({ doc, open, onClose }: { doc: MyRequestDoc | null; open: boolean; onClose: () => void }) {
  if (!doc) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">{doc.docTypeName}</span>
            <span className="font-mono">#{doc.docNum}</span>
            <StatusBadge status={doc.status} label={doc.statusLabel} />
            <span className="text-2xl font-bold font-mono ml-auto">{formatCurrency(doc.docTotal, doc.currency)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Fornecedor</p>
              <p className="text-foreground font-medium">{doc.cardName}</p>
              <p className="text-xs text-muted-foreground font-mono">{doc.cardCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Modelo de Aprovação</p>
              <p className="text-foreground text-sm">{doc.approvalModel || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Criado em</p>
              <p className="text-foreground">{formatDate(doc.creationDate)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Última atualização</p>
              <p className="text-foreground">{formatDate(doc.updateDate)}</p>
            </div>
          </div>

          {doc.remarks && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Observações</p>
              <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3">{doc.remarks}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> Histórico de Aprovações
            </p>
            {doc.history.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhuma etapa de aprovação encontrada.</p>
            ) : (
              (() => {
                const currentStep = doc.history.find((h) => h.status === "pending")?.step;
                return (
                  <div className="space-y-2">
      <PageTitle title="Aprovações Pendentes" />
                    {doc.history.map((h, i) => {
                      const isCurrent = h.status === "pending" && h.step === currentStep;
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-3 border rounded-lg p-3 ${
                            isCurrent
                              ? "border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30"
                              : "border-border bg-muted/20"
                          }`}
                        >
                          <div className="mt-0.5">
                            {h.status === "approved" ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : h.status === "rejected" ? (
                              <XOctagon className="w-4 h-4 text-destructive" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{h.stageName}</span>
                              <StatusBadge status={h.status} label={h.statusLabel} />
                              {isCurrent && (
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                                  Aprovador atual
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              <span className="text-foreground font-medium">{h.approverName}</span>
                              {h.approverEmail && <span> · {h.approverEmail}</span>}
                            </p>
                            {h.date && (
                              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{formatDate(h.date)}</p>
                            )}
                            {h.remarks && (
                              <p className="text-xs text-foreground bg-background/60 rounded p-2 mt-2">{h.remarks}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MyRequestsTab() {
  const { requests, isLoading, error, refresh } = useMyRequests();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | MyRequestDoc["status"]>("all");
  const [selected, setSelected] = useState<MyRequestDoc | null>(null);

  const filtered = requests.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(r.docNum).includes(q) ||
      r.cardName.toLowerCase().includes(q) ||
      r.docTypeName.toLowerCase().includes(q) ||
      r.approvalModel.toLowerCase().includes(q)
    );
  });

  const { visibleItems: visibleRequests, hasMore: reqHasMore, loadMore: reqLoadMore, sentinelRef: reqSentinelRef, total: reqTotal, initial: reqInitial } =
    useLazyList(filtered, { initial: 30, step: 10, resetDeps: [search, statusFilter] });

  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nº, fornecedor, tipo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-muted/30 border-border"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {([
            ["all", `Todos (${counts.all})`],
            ["pending", `Pendentes (${counts.pending})`],
            ["approved", `Aprovados (${counts.approved})`],
            ["rejected", `Rejeitados (${counts.rejected})`],
          ] as const).map(([key, lbl]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key as typeof statusFilter)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                statusFilter === key
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">{error}</div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Carregando seus pedidos...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">Nenhum pedido encontrado</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search || statusFilter !== "all" ? "Ajuste os filtros para ver mais resultados." : "Você ainda não criou nenhum pedido."}
          </p>
        </div>
      ) : (
        <div className="glass-card p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Nº Doc</th>
                <th className="text-right py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Valor</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Fornecedor</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Modelo</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Criado</th>
                <th className="text-center py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Histórico</th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((doc) => (
                <tr key={doc.approvalRequestId} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-3 px-3">
                    <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">{doc.docTypeName}</span>
                  </td>
                  <td className="py-3 px-3 font-mono text-xs text-foreground font-semibold">#{doc.docNum}</td>
                  <td className="py-3 px-3 text-right font-mono text-foreground font-medium">{formatCurrency(doc.docTotal, doc.currency)}</td>
                  <td className="py-3 px-3 text-foreground">{doc.cardName}</td>
                  <td className="py-3 px-3 text-muted-foreground text-xs">{doc.approvalModel || "—"}</td>
                  <td className="py-3 px-3"><StatusBadge status={doc.status} label={doc.statusLabel} /></td>
                  <td className="py-3 px-3 text-muted-foreground font-mono text-xs">{formatDate(doc.creationDate)}</td>
                  <td className="py-3 px-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(doc)} className="text-primary hover:text-primary/80 gap-1">
                      <History className="w-4 h-4" />
                      <span className="text-xs">{doc.history.length}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MyRequestDetailModal doc={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default function ApprovalsPage() {
  const { session, logout } = useSap();
  const { isAdmin: isLovableAdmin } = useAuth();
  const navigate = useNavigate();
  const { approvals, isLoading, isRefreshing, error, lastUpdatedAt, refresh, refreshCache } = useApprovals();
  const { expenses: purchaseExpenses, refresh: refreshPurchase, approveExpense, rejectExpense } = useExpenses("purchase");
  const { expenses: salesExpenses, refresh: refreshSales } = useExpenses("sales");
  const expenses = [...purchaseExpenses, ...salesExpenses];
  const refreshExpenses = () => Promise.all([refreshPurchase(), refreshSales()]);
  const { getLabel } = useCompanies(true);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<ApprovalDoc | null>(null);
  const [relationsMapExpense, setRelationsMapExpense] = useState<Expense | null>(null);
  const [actionPhase, setActionPhase] = useState<"idle" | "sending" | "refreshing">("idle");
  const isActioning = actionPhase !== "idle";
  const isSuperUser = session?.isSuperUser ?? false;
  const isAdmin = isLovableAdmin || isSuperUser;
  const { hasAccess: canViewAllApprovals } = useModuleAccess("approvals_view_all");
  // "Ver todas" fica ligado por padrão para admins e para grupos com acesso view-all
  // (Financeiro / Fiscal / Contábil). Demais usuários seguem restritos ao seu escopo.
  const canToggleShowAll = isAdmin || canViewAllApprovals;
  const [showAll, setShowAll] = useState<boolean>(canToggleShowAll);
  useEffect(() => { setShowAll(canToggleShowAll); }, [canToggleShowAll]);
  const [delegationDoc, setDelegationDoc] = useState<ApprovalDoc | null>(null);
  const [isDelegating, setIsDelegating] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "purchase" | "sales">("all");
  const [minValue, setMinValue] = useState<string>("");
  const [maxValue, setMaxValue] = useState<string>("");
  const [createdFrom, setCreatedFrom] = useState<string>("");
  const [createdTo, setCreatedTo] = useState<string>("");
  const [dueFrom, setDueFrom] = useState<string>("");
  const [dueTo, setDueTo] = useState<string>("");

  const companyLabel = getLabel(session?.companyDB || "");
  const { getCostCentersForEmail } = useApproverCostCenters(session?.companyDB);
  const { officials: activeOfficials } = useActiveOfficialsForMe();
  const { rules } = useApprovalRules();


  // Merge SAP approvals with internal pending expenses
  const internalPending = (expenses || [])
    .filter((e) => e.status === "pendente_aprovacao")
    .map(mapInternalExpense);

  const allApprovals: ApprovalDoc[] = [...internalPending, ...approvals];

  // Mantém o documento aberto no modal sincronizado com o MESMO snapshot que
  // alimenta a lista. Sempre que `allApprovals` for atualizado (após um
  // refresh do servidor), substituímos o `selectedDoc` pela versão mais nova
  // encontrada no snapshot — garantindo que linhas do documento, valores,
  // aprovador atual etc. não fiquem defasados em relação à listagem.
  useEffect(() => {
    setSelectedDoc((current) => {
      if (!current) return current;
      const keyOf = (d: ApprovalDoc) => {
        const internalId = (d as unknown as { __internalId?: string }).__internalId;
        return internalId ? `internal:${internalId}` : `sap:${d.approvalRequestId}`;
      };
      const currentKey = keyOf(current);
      const fresh = allApprovals.find((d) => keyOf(d) === currentKey);
      return fresh ?? current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvals, purchaseExpenses, salesExpenses]);

  const allCostCenterCodes = useMemo(
    () => new Set(allApprovals.flatMap((doc) => {
      const rateio = shouldShowRateio(doc);
      if (rateio.show) return rateio.info.byCC.map((cc) => cc.code);
      return (doc.documentLines || [])
        .map((l) => (l.CostingCode || "").trim())
        .filter((c) => c.length > 0);
    })),
    [allApprovals],
  );
  const { formatCostCenter } = useCostCenterNames(allCostCenterCodes);

  // Redirect to login if no session (after all hooks)
  useEffect(() => {
    if (!session) navigate("/");
  }, [session, navigate]);
  if (!session) return null;

  // Filter: por padrão mostra apenas aprovações em que o usuário é aprovador OU solicitante.
  // Admin pode usar o toggle "Ver todas" para visualizar todos os lançamentos.
  // Se o usuário tem substituição ativa, os documentos dos aprovadores oficiais também aparecem.
  const effectiveShowAll = canToggleShowAll && showAll;
  const sessionUser = (session.userName || "").toLowerCase().trim();
  const officialIdentifiers = useMemo(
    () => activeOfficials.flatMap((o) => {
      const e = (o.official_email || "").toLowerCase();
      const prefix = e.split("@")[0];
      const name = (o.official_name || "").toLowerCase();
      return [e, prefix, name].filter(Boolean);
    }),
    [activeOfficials],
  );
  const codeEq = (code?: string) => {
    if (!code) return false;
    const c = code.toLowerCase().trim();
    if (c === sessionUser) return true;
    return officialIdentifiers.includes(c);
  };
  const matchesSubstitutedOfficial = (approver: string) => {
    if (!approver || officialIdentifiers.length === 0) return false;
    const a = approver.toLowerCase().trim();
    return officialIdentifiers.some((id) => id === a || a.includes(id) || id.includes(a));
  };
  const userApprovals = effectiveShowAll
    ? allApprovals
    : allApprovals.filter(
        (a) =>
          codeEq(a.approverCode) ||
          codeEq(a.requesterCode) ||
          approverMatches(a.currentApprover, session.userName) ||
          approverMatches(a.requester, session.userName) ||
          matchesSubstitutedOfficial(a.currentApprover) ||
          (a.approverEmail && officialIdentifiers.includes(a.approverEmail.toLowerCase())),
      );


  const minV = minValue ? parseFloat(minValue.replace(",", ".")) : null;
  const maxV = maxValue ? parseFloat(maxValue.replace(",", ".")) : null;
  const createdFromD = createdFrom ? new Date(createdFrom).getTime() : null;
  const createdToD = createdTo ? new Date(createdTo).getTime() + 86399999 : null;
  const dueFromD = dueFrom ? new Date(dueFrom).getTime() : null;
  const dueToD = dueTo ? new Date(dueTo).getTime() + 86399999 : null;

  const filtered = userApprovals.filter((a) => {
    // Type filter (purchase vs sales) — based on docTypeName keyword
    if (typeFilter !== "all") {
      const name = (a.docTypeName || "").toLowerCase();
      const isPurchase = name.includes("compra");
      const isSales = name.includes("venda");
      if (typeFilter === "purchase" && !isPurchase) return false;
      if (typeFilter === "sales" && !isSales) return false;
    }

    // Value range
    if (minV !== null && !Number.isNaN(minV) && a.docTotal < minV) return false;
    if (maxV !== null && !Number.isNaN(maxV) && a.docTotal > maxV) return false;

    // Created date range
    if (createdFromD !== null || createdToD !== null) {
      const t = a.docDate ? new Date(a.docDate).getTime() : NaN;
      if (Number.isNaN(t)) return false;
      if (createdFromD !== null && t < createdFromD) return false;
      if (createdToD !== null && t > createdToD) return false;
    }

    // Due date range
    if (dueFromD !== null || dueToD !== null) {
      const t = a.dueDate ? new Date(a.dueDate).getTime() : NaN;
      if (Number.isNaN(t)) return false;
      if (dueFromD !== null && t < dueFromD) return false;
      if (dueToD !== null && t > dueToD) return false;
    }

    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(a.docNum).includes(q) ||
      a.cardName.toLowerCase().includes(q) ||
      a.requester.toLowerCase().includes(q) ||
      a.currentApprover.toLowerCase().includes(q) ||
      a.docTypeName.toLowerCase().includes(q)
    );
  });

  const totalValue = filtered.reduce((sum, a) => sum + a.docTotal, 0);
  const overdueCount = filtered.filter((a) => isOverdue(a.dueDate)).length;

  const handleApprovalAction = async (
    code: number,
    action: "approve" | "reject",
    remarks: string,
    opts?: { idempotencyKey?: string },
  ) => {
    if (!session) return;
    setActionPhase("sending");
    const internalDoc = (selectedDoc as any)?.__internalId;
    try {
      // ===== Fase 1: mutação (aprovar/rejeitar) =====
      try {
        if (internalDoc) {
          const result = action === "approve"
            ? await approveExpense(internalDoc, remarks, opts?.idempotencyKey)
            : await rejectExpense(internalDoc, remarks, opts?.idempotencyKey);
          // Retry idempotente: o servidor detectou a mesma Idempotency-Key
          // e reentregou a resposta original — avisamos o usuário para que
          // ele saiba que a ação NÃO foi processada duas vezes.
          if (result?.replayed) {
            toast.info(
              action === "approve"
                ? "Esta aprovação já havia sido registrada anteriormente — nenhuma ação duplicada foi processada."
                : "Esta rejeição já havia sido registrada anteriormente — nenhuma ação duplicada foi processada.",
              { duration: 6000 },
            );
          } else {
            toast.success(
              action === "approve" ? "Despesa interna aprovada!" : "Despesa interna rejeitada.",
            );
          }
        } else {
          const endpoint = `ApprovalRequests(${code})`;
          const body: Record<string, unknown> = {
            ApprovalRequestDecisions: [{
              Status: action === "approve" ? "ardApproved" : "ardNotApproved",
              Remarks: remarks || undefined,
            }],
          };
          await sapAction(session, endpoint, "PATCH", body);
          clearClientCache();
          toast.success(action === "approve" ? "Aprovação realizada com sucesso!" : "Documento rejeitado.");

          const doc = approvals.find((a) => a.approvalRequestId === code);
          const { logAuditAction } = await import("@/hooks/useAuditLog");
          await logAuditAction({
            action: action === "approve" ? "approve" : "reject",
            entity_type: "approval_request",
            entity_id: String(code),
            actor_email: session.userName,
            company_db: session.companyDB,
            details: {
              docNum: doc?.docNum,
              docType: doc?.docTypeName,
              cardName: doc?.cardName,
              docTotal: doc?.docTotal,
              currency: doc?.currency,
              approver: doc?.currentApprover,
              isSuperUser,
              remarks,
            },
          });
        }
      } catch (mutationErr) {
        console.error("Approval action error:", mutationErr);
        const message = mutationErr instanceof Error ? mutationErr.message : "Erro ao processar ação";
        toast.error(message);
        throw mutationErr instanceof Error ? mutationErr : new Error(message);
      }

      // ===== Fase 2: refresh da lista =====
      // A ação já foi registrada com sucesso. Se o refresh falhar, mantemos o
      // modal aberto e sinalizamos com um erro específico para o usuário poder
      // apenas retentar a atualização (sem reexecutar a decisão).
      setActionPhase("refreshing");
      try {
        if (internalDoc) {
          await refreshExpenses();
        } else {
          await refresh();
        }
        setSelectedDoc(null);
      } catch (refreshErr) {
        console.error("Refresh após ação falhou:", refreshErr);
        const detail = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        toast.error(
          `A ação foi registrada, mas não conseguimos atualizar a lista: ${detail}`,
        );
        const err = new Error(
          "A decisão foi registrada, mas falhou ao atualizar a lista. Tente atualizar novamente.",
        );
        (err as Error & { name: string }).name = "RefreshError";
        throw err;
      }
    } finally {
      setActionPhase("idle");
    }
  };

  const handleRetryRefresh = async () => {
    const internalDoc = (selectedDoc as any)?.__internalId;
    setActionPhase("refreshing");
    try {
      if (internalDoc) {
        await refreshExpenses();
      } else {
        await refresh();
      }
      setSelectedDoc(null);
    } catch (refreshErr) {
      console.error("Retry refresh falhou:", refreshErr);
      const detail = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
      toast.error(`Ainda não foi possível atualizar a lista: ${detail}`);
      const err = new Error(
        "Não foi possível atualizar a lista. Verifique sua conexão e tente novamente.",
      );
      (err as Error & { name: string }).name = "RefreshError";
      throw err;
    } finally {
      setActionPhase("idle");
    }
  };


  const handleDelegate = async (params: { userInternalKey: number; userName: string; userEmail: string; reason: string }) => {
    if (!session || !delegationDoc) return;
    if (!isSuperUser) {
      toast.error("Apenas super-usuários podem delegar aprovações.");
      return;
    }
    setIsDelegating(true);
    try {
      const code = delegationDoc.approvalRequestId;

      // Fetch current pending decision to know which step to reassign
      const reqRes = await sapQuery(
        session,
        `ApprovalRequests(${code})?$select=Code,Status&$expand=ApprovalRequestDecisions`,
        undefined,
        false,
      );
      const reqData = (reqRes.data ?? {}) as {
        ApprovalRequestDecisions?: Array<{ Status?: string; UserID?: number; ApprovalRequestStep?: number }>;
      };
      const decisions = reqData.ApprovalRequestDecisions || [];
      const pending = decisions.find(
        (d) => d.Status === "asWithoutDecision" || d.Status === "asPending",
      );

      if (!pending) {
        throw new Error("Nenhuma decisão pendente encontrada para esta aprovação.");
      }

      // Reassign approver via PATCH (update UserID for the pending decision step)
      await sapAction(session, `ApprovalRequests(${code})`, "PATCH", {
        ApprovalRequestDecisions: [
          {
            ApprovalRequestStep: pending.ApprovalRequestStep,
            UserID: params.userInternalKey,
          },
        ],
      });

      clearClientCache();

      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({
        action: "delegate_approval",
        entity_type: "approval_request",
        entity_id: String(code),
        actor_email: session.userName,
        company_db: session.companyDB,
        details: {
          docNum: delegationDoc.docNum,
          docType: delegationDoc.docTypeName,
          cardName: delegationDoc.cardName,
          docTotal: delegationDoc.docTotal,
          currency: delegationDoc.currency,
          previousApprover: delegationDoc.currentApprover,
          previousApproverEmail: delegationDoc.approverEmail,
          newApproverName: params.userName,
          newApproverEmail: params.userEmail,
          newApproverInternalKey: params.userInternalKey,
          reason: params.reason,
          delegatedBy: session.userName,
          isSuperUser: true,
        },
      });

      toast.success(`Aprovação delegada para ${params.userName}.`);
      setDelegationDoc(null);
      setSelectedDoc(null);
      refresh();
    } catch (e) {
      console.error("Delegation error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao delegar aprovação");
    } finally {
      setIsDelegating(false);
    }
  };



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
              <h1 className="text-xl font-bold text-foreground">Aprovações Pendentes</h1>
              <p className="text-xs text-muted-foreground">Acompanhamento de aprovações</p>
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
            {lastUpdatedAt && (
              <span className="text-xs text-muted-foreground hidden md:inline">
                Cache: {new Date(lastUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading} className="text-muted-foreground hover:text-foreground" title="Recarregar">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refreshCache(); }}
              disabled={isRefreshing}
              className="gap-2"
              title="Buscar dados atualizados do ERP e atualizar o cache"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Atualizar cache
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/aprovacoes?tab=history")}
              className="gap-2"
              title="Ver histórico de aprovações"
            >
              <History className="w-4 h-4" />
              Histórico
            </Button>
            {(() => {
              const reportOptions = {
                title: "Relatório de Aprovações Pendentes",
                subtitle: `${filtered.length} pedido(s) · ${companyLabel}`,
                meta: [
                  { label: "Empresa", value: companyLabel },
                  { label: "Usuário", value: session?.userName || "—" },
                ],
                columns: [
                  { header: "Tipo", cell: (a: typeof filtered[number]) => a.docTypeName || "—" },
                  { header: "Doc #", cell: (a: typeof filtered[number]) => String(a.docNum ?? "—") },
                  { header: "Parceiro", cell: (a: typeof filtered[number]) => a.cardName },
                  { header: "Solicitante", cell: (a: typeof filtered[number]) => a.requester || "—" },
                  { header: "Aprovador atual", cell: (a: typeof filtered[number]) => a.currentApprover || "—" },
                  { header: "Etapa", cell: (a: typeof filtered[number]) => a.currentStage || "—" },
                  { header: "Data doc.", cell: (a: typeof filtered[number]) => a.docDate ? new Date(a.docDate).toLocaleDateString("pt-BR") : "—" },
                  { header: "Vencimento", cell: (a: typeof filtered[number]) => a.dueDate ? new Date(a.dueDate).toLocaleDateString("pt-BR") : "—" },
                  { header: "Dias em aberto", align: "right" as const, cell: (a: typeof filtered[number]) => String(a.daysOpen ?? "—") },
                  { header: "Total", align: "right" as const, cell: (a: typeof filtered[number]) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(a.currency) ? a.currency : "BRL" }).format(a.docTotal) },
                ],
                rows: filtered,
                fileName: "aprovacoes",
              };
              return (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={filtered.length === 0}
                    onClick={() => { void exportListReportPdf(reportOptions); }}
                    title="Exportar a lista atual em PDF (respeita filtros)"
                  >
                    <FileDown className="w-4 h-4" />
                    PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={filtered.length === 0}
                    onClick={() => { exportListReportCsv(reportOptions); }}
                    title="Exportar a lista atual em CSV (respeita filtros)"
                  >
                    <FileDown className="w-4 h-4" />
                    CSV
                  </Button>
                </>
              );
            })()}
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Back + Title */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
            </Button>
          </div>
        </div>

        <Tabs defaultValue="to-approve" className="space-y-6">
          <TabsList>
            <TabsTrigger value="to-approve" className="gap-2">
              <CheckCircle className="w-4 h-4" /> Para Aprovar
            </TabsTrigger>
            <TabsTrigger value="my-requests" className="gap-2">
              <FileText className="w-4 h-4" /> Meus Pedidos
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2" onClick={() => navigate("/aprovacoes?tab=history")}>
              <History className="w-4 h-4" /> Histórico
            </TabsTrigger>
          </TabsList>


          <TabsContent value="to-approve" className="space-y-6 mt-0">
        {/* Summary bar */}
        <div className="flex flex-wrap gap-4">
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <Clock className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Pendentes</p>
              <p className="text-lg font-bold font-mono text-foreground">{filtered.length}</p>
            </div>
          </div>
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <DollarSign className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Valor Total</p>
              <p className="text-lg font-bold font-mono text-foreground">{formatCurrency(totalValue)}</p>
            </div>
          </div>
          {overdueCount > 0 && (
            <div className="glass-card px-4 py-3 flex items-center gap-3 border-destructive/30">
              <Calendar className="w-4 h-4 text-destructive" />
              <div>
                <p className="text-xs text-muted-foreground">Vencidos</p>
                <p className="text-lg font-bold font-mono text-destructive">{overdueCount}</p>
              </div>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nº, fornecedor, aprovador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-muted/30 border-border"
            />
          </div>
          {canToggleShowAll && (
            <div className="flex items-center gap-2 glass-card px-3 py-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <Label htmlFor="show-all" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                Ver todas as aprovações
              </Label>
              <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
            </div>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <SlidersHorizontal className="w-4 h-4" />
                Mais filtros
                {(() => {
                  const active = [
                    typeFilter !== "all",
                    !!minValue,
                    !!maxValue,
                    !!createdFrom,
                    !!createdTo,
                    !!dueFrom,
                    !!dueTo,
                  ].filter(Boolean).length;
                  return active > 0 ? (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{active}</Badge>
                  ) : null;
                })()}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[420px] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Filtros</p>
                {(typeFilter !== "all" || minValue || maxValue || createdFrom || createdTo || dueFrom || dueTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTypeFilter("all");
                      setMinValue("");
                      setMaxValue("");
                      setCreatedFrom("");
                      setCreatedTo("");
                      setDueFrom("");
                      setDueTo("");
                    }}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    Limpar
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Tipo</Label>
                <div className="flex items-center gap-1">
                  {([
                    ["all", "Todos"],
                    ["purchase", "Compra"],
                    ["sales", "Venda"],
                  ] as const).map(([key, lbl]) => (
                    <button
                      key={key}
                      onClick={() => setTypeFilter(key)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        typeFilter === key
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Valor mín.</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={minValue}
                    onChange={(e) => setMinValue(e.target.value)}
                    className="h-9 bg-muted/30 border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Valor máx.</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={maxValue}
                    onChange={(e) => setMaxValue(e.target.value)}
                    className="h-9 bg-muted/30 border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Criado de</Label>
                  <Input
                    type="date"
                    value={createdFrom}
                    onChange={(e) => setCreatedFrom(e.target.value)}
                    className="h-9 bg-muted/30 border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Criado até</Label>
                  <Input
                    type="date"
                    value={createdTo}
                    onChange={(e) => setCreatedTo(e.target.value)}
                    className="h-9 bg-muted/30 border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Vence de</Label>
                  <Input
                    type="date"
                    value={dueFrom}
                    onChange={(e) => setDueFrom(e.target.value)}
                    className="h-9 bg-muted/30 border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Vence até</Label>
                  <Input
                    type="date"
                    value={dueTo}
                    onChange={(e) => setDueTo(e.target.value)}
                    className="h-9 bg-muted/30 border-border"
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("cards")}
              className={`p-2 transition-colors ${viewMode === "cards" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-2 transition-colors ${viewMode === "table" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>



        {error && (
          <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">{error}</div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Carregando aprovações...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">Nenhuma aprovação pendente</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? "Nenhum resultado para a busca." : "Todos os documentos foram aprovados."}
            </p>
          </div>
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((doc, i) => (
              <motion.div key={doc.approvalRequestId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <ApprovalCard
                  doc={doc}
                  onOpen={() => setSelectedDoc(doc)}
                  approverCCs={getCostCentersForEmail(doc.approverEmail)}
                  formatCostCenter={formatCostCenter}
                  onRelationsMap={(() => {
                    const internalId = (doc as any).__internalId as string | undefined;
                    if (!internalId) return undefined;
                    const exp = expenses.find((e) => e.id === internalId);
                    return exp ? () => setRelationsMapExpense(exp) : undefined;
                  })()}
                />

              </motion.div>
            ))}
          </div>
        ) : (
          <div className="glass-card p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Nº Doc</th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Valor</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Fornecedor</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Aprovador</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Solicitante</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Vencimento</th>
                  <th className="text-center py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc, i) => {
                  const overdue = isOverdue(doc.dueDate);
                  return (
                    <motion.tr
                      key={doc.approvalRequestId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${overdue ? "bg-destructive/5" : ""}`}
                    >
                      <td className="py-3 px-3">
                        <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">{doc.docTypeName}</span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-foreground font-semibold">#{doc.docNum}</td>
                      <td className="py-3 px-3 text-right font-mono text-foreground font-medium">{formatCurrency(doc.docTotal, doc.currency)}</td>
                      <td className="py-3 px-3 text-foreground">{doc.cardName}</td>
                      <td className="py-3 px-3 text-foreground font-medium">{doc.currentApprover}</td>
                      <td className="py-3 px-3 text-muted-foreground">{doc.requester}</td>
                      <td className={`py-3 px-3 font-mono text-xs ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                        {formatDate(doc.dueDate)}
                        {overdue && <span className="ml-1 text-[10px]">⚠</span>}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedDoc(doc)} className="text-primary hover:text-primary/80">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </TabsContent>

          <TabsContent value="my-requests" className="mt-0">
            <MyRequestsTab />
          </TabsContent>
        </Tabs>
      </main>

      <ApprovalDetailModal
        doc={selectedDoc}
        open={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        onAction={handleApprovalAction}
        onRetryRefresh={handleRetryRefresh}
        onDelegate={(d) => setDelegationDoc(d)}
        isActioning={isActioning}
        actionPhase={actionPhase}
        isSuperUser={isSuperUser}
        currentUserName={session.userName}
        currentUserEmail={session.userName}
        approverCCs={getCostCentersForEmail(selectedDoc?.approverEmail || "")}
        formatCostCenter={formatCostCenter}
        rules={rules}
        isAdmin={isAdmin}
        canApprove={(() => {
          if (!selectedDoc) return false;
          // Bloqueia auto-aprovação: quem criou/solicitou o documento
          // nunca pode aprovar, mesmo sendo admin ou SAP Superuser.
          const isRequester =
            codeEq(selectedDoc.requesterCode) ||
            approverMatches(selectedDoc.requester, session.userName);
          if (isRequester) return false;
          const isDesignated =
            codeEq(selectedDoc.approverCode) ||
            approverMatches(selectedDoc.currentApprover, session.userName) ||
            matchesSubstitutedOfficial(selectedDoc.currentApprover) ||
            (!!selectedDoc.approverEmail &&
              officialIdentifiers.includes(selectedDoc.approverEmail.toLowerCase()));
          return isAdmin || isDesignated;
        })()}
      />


      <RelationsMap
        open={!!relationsMapExpense}
        onClose={() => setRelationsMapExpense(null)}
        expense={relationsMapExpense as any}
        title="Mapa de Relações"
      />

      <DelegationDialog
        open={!!delegationDoc}
        onClose={() => setDelegationDoc(null)}
        doc={delegationDoc}
        onConfirm={handleDelegate}
        isSubmitting={isDelegating}
      />
    </div>
  );
}
