import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { docNumberLabel, isInternalDoc, matchesDocQuery } from "@/lib/doc-number";
import { UserCompanyMenu } from "@/components/UserCompanyMenu";
import { useCanViewAllDocuments } from "@/hooks/useCanViewAllDocuments";
import { useMyCapabilities } from "@/hooks/useMyCapabilities";
import { useDirectorateScope } from "@/hooks/useDirectorateScope";
import cactusLogo from "@/assets/cactus-logo.png.asset.json";
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
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  LayoutGrid,
  List,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useApprovals, type ApprovalDoc, type DocumentLine } from "@/hooks/useApprovals";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import { useExpenses, type Expense } from "@/hooks/useExpenses";
import { useApprovalsFeed, type ApprovalFeedDoc } from "@/hooks/useApprovalsFeed";
import { expenseRead } from "@/lib/expense-read";
import { useMyRequests, type MyRequestDoc, type ApprovalHistoryEntry } from "@/hooks/useMyRequests";
import { useLazyList } from "@/hooks/useLazyList";
import { savePostLoginPath } from "@/lib/post-login-redirect";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Activity, LogOut, Eye, CheckCircle, XCircle, Paperclip, X, CheckCircle2, XOctagon, History, UserCog, ChevronsUpDown, Check, Network, FileDown, Link2, Undo2, Briefcase } from "lucide-react";
import { copyDocLink, readDocParam, setDocParam } from "@/lib/doc-deep-link";
import { excludeRequesterApprovers, isSameAsRequester } from "@/lib/self-approval";
import { exportListReportPdf, exportListReportCsv } from "@/lib/report-pdf";
import { useSap } from "@/contexts/SapContext";
import { gateSync } from "@/contexts/PermissionsV2Context";
import { useAuth } from "@/hooks/useAuth";
import { useModuleAccess } from "@/hooks/usePermissions";
import { sapAction, sapQuery, sapDownloadAttachment, clearClientCache, ensureUserSapSession, type SapSession } from "@/lib/sap-client";
import { toast } from "sonner";
import { useSapUsers } from "@/hooks/useSapUsers";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { cn } from "@/lib/utils";
import { Split, ScanSearch } from "lucide-react";
import { ApprovalRuleExplainDialog } from "@/components/ApprovalRuleExplainDialog";
import { getRateioInfo } from "@/lib/rateio";
import type { ExplainVariables } from "@/lib/approval-rule-explain";
import { useApproverCostCenters } from "@/hooks/useApproverCostCenters";
import { useActiveOfficialsForMe, useSubstituteGrantsForMe, SUBSTITUTES_CHANGED_EVENT } from "@/hooks/useApproverSubstitutes";
import { useCostCenterNames } from "@/hooks/useCostCenterNames";
import { shouldShowRateio, sumSelectedShare, type RateioInfo } from "@/lib/rateio";
import { segmentDocByRules, segmentsForApprover, isTrulySegmented, lineSegmentKey, type ApprovalSegment } from "@/lib/approvalSegments";
import { useApprovalRules, type ApprovalRule } from "@/hooks/useApprovalRules";
import { Checkbox } from "@/components/ui/checkbox";
import { RelationsMap } from "@/components/RelationsMap";
import { SegmentFallbackAlert } from "@/components/SegmentFallbackAlert";
import { ParallelTracksPanel } from "@/components/ParallelTracksPanel";


import SubstituteApproversTab from "@/components/SubstituteApproversTab";


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
import { InternalApprovalHistory } from "@/components/InternalApprovalHistory";
import { ExpenseUpdateNotice } from "@/components/ExpenseRevisionHistory";

import { AttachmentViewer } from "@/components/AttachmentViewer";
import { displayUserName } from "@/lib/user-display";
import { isDesignatedApprover, matchesApproverIdentity } from "@/lib/approval-authz";
import { getImpersonation } from "@/lib/impersonation";
import { isPayrollOrTaxFlow } from "@/hooks/useCurrentUserCostCenter";


function formatCurrency(value: number, currency: string = "BRL") {
  const code = /^[A-Z]{3}$/.test((currency || "").toUpperCase()) ? currency.toUpperCase() : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return `${code} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  }
}

function parseDateFlexible(dateStr: string): Date | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  // DD/MM/YYYY ou DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = parseInt(dmy[2], 10);
    let y = parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCDate() !== d || dt.getUTCMonth() !== m - 1) return null;
    return dt;
  }
  // ISO YYYY-MM-DD (força UTC pra evitar shift de timezone)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, m - 1, d));
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  const dt = parseDateFlexible(dateStr);
  if (!dt) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(dt);
}

type DueStatus = "missing" | "overdue" | "warning" | "normal";

function daysUntilDue(dueDate: string): number | null {
  if (!dueDate) return null;
  const dt = parseDateFlexible(dueDate);
  if (!dt) return null;
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dueUtc = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  return Math.floor((dueUtc - todayUtc) / 86_400_000);
}

function getDueStatus(dueDate: string): DueStatus {
  if (!dueDate) return "missing";
  const days = daysUntilDue(dueDate);
  if (days === null) return "missing";
  if (days <= 2) return "overdue";
  if (days <= 5) return "warning";
  return "normal";
}

/** Colunas ordenáveis da tabela de aprovações pendentes. */
type SortKey =
  | "docTypeName"
  | "docNum"
  | "docTotal"
  | "cardName"
  | "currentApprover"
  | "requester"
  | "docDate"
  | "dueDate";

/** Centros de custo distintos presentes nas linhas do documento. */
function docCostCenters(doc: ApprovalDoc): string[] {
  const set = new Set<string>();
  for (const l of doc.documentLines || []) {
    const c = (l.CostingCode || "").trim();
    if (c) set.add(c);
  }
  return Array.from(set);
}

/** Projetos distintos presentes nas linhas do documento. */
function docProjects(doc: ApprovalDoc): string[] {
  const set = new Set<string>();
  for (const l of doc.documentLines || []) {
    const p = (l.Project || "").trim();
    if (p) set.add(p);
  }
  return Array.from(set);
}

/** Natureza do documento: compra, venda ou outro tipo (pagamento, etc.). */
type DocKind = "purchase" | "sales" | "other";

function docKind(doc: { docTypeName?: string; __explain?: { docType?: string } }): DocKind {
  const internal = doc.__explain?.docType;
  if (internal === "sales") return "sales";
  const name = (doc.docTypeName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/venda|saida|entrega|cliente|faturamento/.test(name)) return "sales";
  if (/compra|entrada|fornecedor|mercadoria|despesa|reembolso/.test(name)) return "purchase";
  if (internal === "purchase") return "purchase";
  return "other";
}

const DOC_KIND_LABEL: Record<DocKind, string> = {
  purchase: "Compra",
  sales: "Venda",
  other: "Outro",
};

const DOC_KIND_CLASS: Record<DocKind, string> = {
  purchase: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
  sales: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

/** Como chamar o parceiro de negócio conforme a natureza do documento. */
function partnerLabel(doc: { docTypeName?: string; __explain?: { docType?: string } }): string {
  const kind = docKind(doc);
  if (kind === "sales") return "Cliente";
  if (kind === "purchase") return "Fornecedor";
  return "Parceiro";
}

/** Selo visual que deixa explícita a natureza do documento. */
function DocKindBadge({ doc, className = "" }: { doc: { docTypeName?: string; __explain?: { docType?: string } }; className?: string }) {
  const kind = docKind(doc);
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${DOC_KIND_CLASS[kind]} ${className}`}
    >
      {DOC_KIND_LABEL[kind]}
    </span>
  );
}


type ApprovalTransferUserOption = SapSearchOption & { email?: string };

function sortUserOptions(options: ApprovalTransferUserOption[]): ApprovalTransferUserOption[] {
  return [...options].sort((a, b) =>
    (a.name || a.code).localeCompare(b.name || b.code, "pt-BR", { sensitivity: "base" }),
  );
}

function pendingCountsByApprover(docs: ApprovalDoc[]): Array<{ approver: string; count: number }> {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const internalId = (doc as unknown as { __internalId?: string }).__internalId;
    if (!internalId) continue;
    const key = (doc.currentApprover || "Sem aprovador").trim() || "Sem aprovador";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([approver, count]) => ({ approver, count }))
    .sort((a, b) => b.count - a.count || a.approver.localeCompare(b.approver, "pt-BR"));
}

function ApprovalCard({
  doc,
  onOpen,
  approverCCs,
  formatCostCenter,
  onRelationsMap,
  onBehalfOf,
  substituteName,
  selectedForTransfer,
  onToggleTransfer,
}: {
  doc: ApprovalDoc;
  onOpen: () => void;
  approverCCs: Set<string>;
  formatCostCenter: (code?: string | null) => string;
  onRelationsMap?: () => void;
  onBehalfOf?: { name: string; email: string } | null;
  substituteName?: string | null;
  selectedForTransfer?: boolean;
  onToggleTransfer?: (checked: boolean) => void;
}) {
  const dueStatus = getDueStatus(doc.dueDate);
  const overdue = dueStatus === "overdue";
  const dueWarning = dueStatus === "warning";
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

  // Projeto "principal" para exibir no card (agora determinante das regras de aprovação)
  const primaryProject = (() => {
    const codes = Array.from(new Set(
      (doc.documentLines || [])
        .map((l) => (l.Project || "").trim())
        .filter((c) => c.length > 0),
    ));
    if (codes.length === 0) return null;
    return { code: codes[0], multi: codes.length > 1 };
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      role="button"
      tabIndex={0}
      aria-label={`Abrir aprovação ${doc.docTypeName} nº ${docNumberLabel(doc)}, ${doc.cardName}, valor ${formatCurrency(doc.docTotal, doc.currency)}${overdue ? ", vencida" : dueWarning ? ", com alerta de vencimento" : ""}`}
      className={`glass-card p-5 flex flex-col gap-3 cursor-pointer hover:ring-1 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-all ${overdue ? "border-destructive/40" : dueWarning ? "border-amber-500/40 bg-amber-500/5" : ""}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2 min-w-0">
          {onToggleTransfer && (
            <Checkbox
              checked={!!selectedForTransfer}
              onCheckedChange={(v) => onToggleTransfer(v === true)}
              onClick={(ev) => ev.stopPropagation()}
              aria-label={`Selecionar ${docNumberLabel(doc)} para transferência`}
              className="mt-1"
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <DocKindBadge doc={doc} />
              <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {doc.docTypeName}
              </span>
            </div>
            <h3 className="text-foreground font-semibold mt-2 font-mono">{docNumberLabel(doc)}</h3>
          </div>
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
            {doc.viewerSegmented && (
              <span className="text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400">
                Valor da sua alçada
              </span>
            )}
            {overdue && (
              <span className="text-[10px] font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded-full uppercase">
                Vencido
              </span>
            )}
            {dueWarning && (
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full uppercase">
                Alerta
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
            <Split className="w-3.5 h-3.5 text-primary/70 shrink-0" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">C. Custo</span>
            {showRateio && (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                Rateado
              </span>
            )}
            <span className="text-foreground font-medium truncate">{formatCostCenter(primaryCC.code)}</span>
          </div>
        )}
        {primaryProject && (
          <div className="flex items-center gap-2 text-muted-foreground min-w-0">
            <Briefcase className="w-3.5 h-3.5 text-primary/70 shrink-0" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">Projeto</span>
            {primaryProject.multi && (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-sky-500/15 text-sky-600 border border-sky-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                Múltiplos
              </span>
            )}
            <span className="text-foreground font-medium truncate">{primaryProject.code}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <User className="w-3.5 h-3.5 text-primary/70" />
          <span>
            Aprovador:{" "}
            {onBehalfOf && substituteName ? (
              <span
                className="text-foreground font-medium"
                title={`Aprovador original: ${onBehalfOf.name} — você atua como substituto`}
              >
                {substituteName}
              </span>
            ) : doc.delegatedFrom ? (
              <span className="text-foreground font-medium">
                <span className="line-through text-muted-foreground/80 font-normal">{doc.delegatedFrom}</span>
                <span className="mx-1 text-primary" aria-hidden="true">→</span>
                {doc.currentApprover}
              </span>
            ) : (
              <span className="text-foreground font-medium">{doc.currentApprover}</span>
            )}
          </span>
        </div>

        {onBehalfOf && (
          <div
            className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1"
            title={`Você está aprovando como substituto de ${onBehalfOf.name}`}
          >
            <UserCog className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              Aprovando em nome de <span className="font-semibold">{onBehalfOf.name}</span>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <FileText className="w-3.5 h-3.5 text-primary/70" />
          <span>Solicitante: <span className="text-foreground font-medium">{doc.requester}</span></span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="w-3.5 h-3.5 text-primary/70" />
            <span>Criado: {formatDate(doc.docDate)}</span>
          </div>
          <div className={`flex items-center gap-1 text-xs font-medium ${overdue ? "text-destructive" : dueWarning ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
            <Clock className="w-3 h-3" />
            {formatDate(doc.dueDate)}
            {dueWarning && <span className="text-[10px]">⚠</span>}
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
  const eligibleUsers = [...users]
    .filter((u) => u.Locked !== "tYES" && (u.UserName || u.UserCode))
    .sort((a, b) =>
      (a.UserName || a.UserCode || "").localeCompare(b.UserName || b.UserCode || "", "pt-BR", { sensitivity: "base" }),
    );

  const handleConfirm = async () => {
    if (!selectedUser || !selectedKey) {
      toast.error("Selecione um usuário para transferir.");
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
            Transferir aprovação
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="text-sm bg-muted/30 rounded-lg p-3 space-y-1">
            <p className="text-muted-foreground text-xs">Documento</p>
            <p className="text-foreground font-medium">
              <span className="font-mono">{docNumberLabel(doc)}</span> · {doc?.docTypeName}
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
            <Label className="text-xs text-muted-foreground mb-1.5 block">Motivo da transferência</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: redistribuição de fila, aprovador em férias..."
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
              Transferir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransferApprovalsDialog({
  open,
  onClose,
  docs,
  userOptions,
  usersLoading,
  pendingCounts,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onClose: () => void;
  docs: ApprovalDoc[];
  userOptions: ApprovalTransferUserOption[];
  usersLoading: boolean;
  pendingCounts: Array<{ approver: string; count: number }>;
  onConfirm: (params: { user: ApprovalTransferUserOption; reason: string }) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [selectedUser, setSelectedUser] = useState<ApprovalTransferUserOption | null>(null);
  const [reason, setReason] = useState("Transferência administrativa de aprovações pendentes");

  useEffect(() => {
    if (!open) {
      setSelectedUser(null);
      setReason("Transferência administrativa de aprovações pendentes");
    }
  }, [open]);

  const totalAmount = docs.reduce((sum, doc) => sum + Number(doc.docTotal || 0), 0);
  const distinctCurrentApprovers = pendingCounts.filter((row) =>
    docs.some((doc) => (doc.currentApprover || "Sem aprovador").trim() === row.approver),
  );

  const handleConfirm = async () => {
    if (!selectedUser) {
      toast.error("Selecione o novo aprovador.");
      return;
    }
    if (docs.length === 0) {
      toast.error("Selecione pelo menos uma aprovação interna.");
      return;
    }
    await onConfirm({ user: selectedUser, reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            Transferir aprovações
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Selecionadas</p>
              <p className="text-lg font-semibold text-foreground">{docs.length}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Aprovadores atuais</p>
              <p className="text-lg font-semibold text-foreground">{distinctCurrentApprovers.length || 0}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Valor total</p>
              <p className="text-lg font-semibold text-foreground">{formatCurrency(totalAmount)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Novo aprovador</Label>
            <CachedSearchCombobox
              options={userOptions}
              isLoading={usersLoading}
              value={selectedUser}
              onChange={(opt) => setSelectedUser(opt as ApprovalTransferUserOption | null)}
              placeholder="Buscar usuário por nome, código ou e-mail..."
              required
              footerHint={`${userOptions.length} usuário(s) disponíveis em ordem alfabética`}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Motivo</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={isSubmitting}
            />
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium text-foreground mb-2">Pendências por aprovador</p>
            {pendingCounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma aprovação interna pendente nos filtros atuais.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {pendingCounts.map((row) => (
                  <div key={row.approver} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-muted-foreground">{row.approver}</span>
                    <Badge variant="outline" className="font-mono">{row.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={isSubmitting || !selectedUser || docs.length === 0} className="gap-1.5">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
              Transferir
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
  onReprocessApproval,
  onRevokeDelegation,
  isReprocessingApproval,
  isRevokingDelegation,
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
  onBehalfOf,
}: {
  doc: ApprovalDoc | null;
  open: boolean;
  onClose: () => void;
  onAction: (code: number, action: "approve" | "reject", remarks: string, opts?: { idempotencyKey?: string }) => Promise<void>;
  onRetryRefresh: () => Promise<void>;
  onDelegate: (doc: ApprovalDoc) => void;
  onReprocessApproval: (doc: ApprovalDoc) => void;
  onRevokeDelegation: (doc: ApprovalDoc) => void;
  isReprocessingApproval: boolean;
  isRevokingDelegation: boolean;
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
  onBehalfOf?: { name: string; email: string } | null;
}) {
  const [remarks, setRemarks] = useState("");
  const [riskConfirm, setRiskConfirm] = useState<{ action: "approve" | "reject"; idempotencyKey: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"mutation" | "refresh" | null>(null);
  const [downloadingName, setDownloadingName] = useState<string | null>(null);
  const [showAllLines, setShowAllLines] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const confirmInFlightRef = useRef(false);
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
  // Documentos com Tipo de Rateio ≠ "Não" (folha/imposto/reembolso/viagens)
  // são rateios sistêmicos; TODOS os aprovadores veem o documento completo.
  const specialRateio =
    !!(doc?.rateioType && doc.rateioType !== "padrao") ||
    isPayrollOrTaxFlow(doc?.rateioType, (doc?.documentLines || []).map((l) => l.ItemCode));
  // Máscara visual (blur) das partes de outros aprovadores — vale também para
  // admins/super, que podem alternar para o documento completo quando precisarem.
  const maskOtherSegments =
    !doc?.viewerSegmented && segmented && !specialRateio && mySegments.length > 0 && !showAllLines;

  const visibleLines = doc?.documentLines || [];

  // Metadados/variáveis para o Raio-X da regra de aprovação (somente leitura).
  const explainMeta = (doc as unknown as {
    __explain?: { ruleId: string | null; currentLevel: number | null; docType: string; requesterName: string };
  })?.__explain ?? { ruleId: null, currentLevel: null, docType: "purchase", requesterName: doc?.requester || "" };

  const explainVars: ExplainVariables = useMemo(() => {
    const lines = doc?.documentLines || [];
    const info = getRateioInfo(lines);
    const uniq = (arr: string[]) => Array.from(new Set(arr.map((s) => (s || "").trim()).filter(Boolean)));
    return {
      costCenters: uniq(lines.map((l) => l.CostingCode)),
      projects: uniq(lines.map((l) => l.Project)),
      totalAmount: Number(doc?.docTotal || 0),
      currency: doc?.currency || "BRL",
      itemCodes: uniq(lines.map((l) => l.ItemCode)),
      itemNames: uniq(lines.map((l) => l.Description)),
      supplierName: doc?.cardName || "",
      supplierCode: doc?.cardCode || "",
      requesterName: explainMeta.requesterName || doc?.requester || "",
      docType: explainMeta.docType || "purchase",
      rateioType: doc?.rateioType || "padrao",
      rateioByCC: info.byCC,
    };
  }, [doc, explainMeta.docType, explainMeta.requesterName]);

  // Mapeia (centro de custo + projeto) → segmento (para saber a qual aprovador
  // cada linha pertence quando exibimos com blur).
  const segmentByCC = useMemo(() => {
    const m = new Map<string, ApprovalSegment>();
    for (const s of segments) {
      if (s.segmentKey === "__all__") continue;
      m.set(s.segmentKey, s);
    }
    return m;
  }, [segments]);
  const myCCs = useMemo(
    () => new Set(mySegments.map((s) => s.segmentKey)),
    [mySegments],
  );
  const isLineMine = useCallback(
    (line: DocumentLine): boolean => {
      if (!maskOtherSegments) return true;
      return myCCs.has(lineSegmentKey(line));
    },
    [maskOtherSegments, myCCs],
  );
  const visibleTotal = maskOtherSegments
    ? mySegments.reduce((s, seg) => s + (doc?.currency !== "BRL" ? seg.amountFC : seg.amount), 0)
    : (doc?.docTotal || 0);
  const persistedSegments = doc?.approvalSegments || [];


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

  // Viewer state — usamos modal em vez de abrir pop-up (mobile bloqueia).
  const [viewer, setViewer] = useState<{ name: string; url: string | null } | null>(null);
  const viewerUrlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (viewerUrlRef.current && viewerUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(viewerUrlRef.current);
      }
    };
  }, []);
  const openViewer = (name: string, url: string) => {
    if (viewerUrlRef.current && viewerUrlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(viewerUrlRef.current);
    }
    viewerUrlRef.current = url;
    setViewer({ name, url });
  };
  const closeViewer = () => {
    if (viewerUrlRef.current && viewerUrlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(viewerUrlRef.current);
      viewerUrlRef.current = null;
    }
    setViewer(null);
  };

  const handleDownloadAttachment = async (name: string) => {
    if (!doc || !doc.attachmentEntry || !session || session.erpType !== "sap") {
      toast.error("Anexo indisponível");
      return;
    }
    setDownloadingName(name);
    // Abre imediatamente o modal em estado de loading para não depender de pop-up.
    setViewer({ name, url: null });
    try {
      const { blob } = await sapDownloadAttachment(session, doc.attachmentEntry, name);
      const url = URL.createObjectURL(blob);
      openViewer(name, url);
    } catch (e) {
      console.error("Erro ao baixar anexo:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao baixar anexo");
      setViewer(null);
    } finally {
      setDownloadingName(null);
    }
  };



  if (!doc) return null;

  const dueStatus = getDueStatus(doc.dueDate);
  const overdue = dueStatus === "overdue";
  const dueWarning = dueStatus === "warning";
  const isOtherApprover = isSuperUser &&
    !approverMatches(doc.currentApprover, currentUserName) &&
    !approverMatches(doc.currentApprover, currentUserEmail || "");

  const handleAction = (action: "approve" | "reject") => {
    // Sempre confirmar antes de aprovar/rejeitar — mostra resumo do que
    // está sendo decidido e destaca quando é super-usuário agindo em
    // documento de outro aprovador.
    setActionError(null);

    // Gate v2 (síncrono, snapshot em RAM). Em modo `off`/`shadow` sempre
    // libera; em `enforce` respeita o veredito. Negativas geram log
    // fire-and-forget — zero impacto na latência do clique.
    const gate = gateSync({
      module: "approvals",
      action: "approve",
      clientAllows: canApprove,
      companyDb: session?.companyDB ?? null,
      identifier: session?.userName ?? null,
    });
    if (!gate.allow) {
      toast.error("Você não tem permissão para esta ação nesta empresa.");
      return;
    }

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
    if (!riskConfirm || !doc || isActioning || confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
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
    } finally {
      confirmInFlightRef.current = false;
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
        <DialogContent className="!p-0 !gap-0 !flex !flex-col w-screen h-[100dvh] max-w-none rounded-none border-0 sm:w-[95vw] sm:h-auto sm:!max-h-[90vh] sm:max-w-2xl sm:rounded-lg sm:border !overflow-hidden">

          <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {doc.docTypeName}
                </span>
                <span className="font-mono text-sm sm:text-base">{docNumberLabel(doc)}</span>
                <span className="ml-auto text-right">
                  {doc.viewerSegmented && (
                    <span className="block text-[10px] font-medium uppercase text-muted-foreground">Valor da sua alçada</span>
                  )}
                  <span className="text-lg sm:text-2xl font-bold font-mono">{formatCurrency(visibleTotal, doc.currency)}</span>
                </span>
              </DialogTitle>
            </DialogHeader>

            {onBehalfOf && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <UserCog className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Você está aprovando em nome de{" "}
                  <strong className="font-semibold">{onBehalfOf.name}</strong>
                  {onBehalfOf.email && (
                    <span className="text-amber-600/80 dark:text-amber-400/80"> · {onBehalfOf.email}</span>
                  )}
                  . A ação será registrada como sua, na condição de substituto ativo.
                </span>
              </div>
            )}
          </div>


          <div className="shrink-0 flex flex-wrap justify-end gap-2 px-4 sm:px-6 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowExplain(true)}
              title="Entenda qual regra da matriz foi aplicada e por quê"
            >
              <ScanSearch className="w-3.5 h-3.5" /> Raio-X da regra
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                const internalId = (doc as unknown as { __internalId?: string }).__internalId;
                const key = internalId ? `internal:${internalId}` : `sap:${doc.approvalRequestId}`;
                void copyDocLink(window.location.pathname, key);
              }}
              title="Copiar link direto desta aprovação"
            >
              <Link2 className="w-3.5 h-3.5" /> Copiar link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                void exportListReportPdf({
                  title: `Pedido de Aprovação — ${doc.cardName}`,
                  subtitle: `${docNumberLabel(doc)} · ${doc.docTypeName}`,
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
                  fileName: `aprovacao_${docNumberLabel(doc).replace("#", "")}`,
                });
              }}
            >
              <FileDown className="w-3.5 h-3.5" /> Exportar relatório
            </Button>
          </div>


          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 pb-4">
          <div className="space-y-4 mt-2 min-w-0 [&_p]:break-words">

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
                {doc.delegatedFrom ? (
                  <p className="text-foreground font-medium">
                    <span className="line-through text-muted-foreground/80 font-normal">{doc.delegatedFrom}</span>
                    <span className="mx-1 text-primary" aria-hidden="true">→</span>
                    {doc.currentApprover}
                  </p>
                ) : (
                  <p className="text-foreground font-medium">{doc.currentApprover}</p>
                )}
                {doc.delegatedFrom && (
                  <p className="text-[11px] text-muted-foreground">Delegado de {doc.delegatedFrom}</p>
                )}
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
                <p className={!doc.dueDate ? "text-destructive font-semibold" : overdue ? "text-destructive font-semibold" : dueWarning ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-foreground"}>
                  {doc.dueDate ? formatDate(doc.dueDate) : "sem data"}
                  {overdue && doc.dueDate && " ⚠ Vencido"}
                  {dueWarning && doc.dueDate && " ⚠ Alerta de vencimento"}
                </p>
              </div>
              {doc.daysOpen > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Dias em Aberto</p>
                  <p className="text-foreground font-mono">{doc.daysOpen}</p>
                </div>
              )}
            </div>

            {/* Aviso de atualização: pedido já enviado antes, agora alterado */}
            <ExpenseUpdateNotice
              expenseId={(doc as unknown as { __internalId?: string }).__internalId}
              revisionNumber={(doc as unknown as { __revision?: number }).__revision}
            />

            {/* Histórico detalhado — apenas para aprovações internas */}

            {(doc as unknown as { __internalId?: string }).__internalId && !doc.viewerSegmented && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <InternalApprovalHistory
                  expenseId={(doc as unknown as { __internalId: string }).__internalId}
                />
              </div>
            )}


            {/* Remarks */}
            {doc.remarks && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Observações</p>
                <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap break-words">{doc.remarks}</p>

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
                    const ccKey = (cc.code || "").trim() || "__no_cc__";
                    const mineCC = !maskOtherSegments || myCCs.has(ccKey);
                    return (
                      <label
                        key={cc.code}
                        title={!mineCC ? "Centro de custo da alçada de outro aprovador" : undefined}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border border-border transition-colors ${
                          mineCC
                            ? "bg-background/40 hover:bg-background/70 cursor-pointer"
                            : "bg-muted/10 cursor-not-allowed"
                        }`}
                      >
                        <Checkbox
                          checked={mineCC ? checked : false}
                          disabled={!mineCC}
                          onCheckedChange={(v) => {
                            if (!mineCC) return;
                            setSelectedCCs((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(cc.code);
                              else next.delete(cc.code);
                              return next;
                            });
                          }}
                        />
                        <div className={`flex-1 min-w-0 ${!mineCC ? "blur-sm select-none" : ""}`}>
                          <p className="text-sm text-foreground font-medium truncate">{formatCostCenter(cc.code)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {cc.pct.toFixed(1)}% do documento
                          </p>
                        </div>
                        <span className={`text-sm font-mono font-semibold text-foreground ${!mineCC ? "blur-sm select-none" : ""}`}>
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

            {/* Alerta de alçada resolvida por fallback (segmentos sem regra própria) */}
            <SegmentFallbackAlert
              expenseId={(doc as unknown as { __internalId?: string }).__internalId}
              segments={persistedSegments}
              formatCostCenter={formatCostCenter}
              onReprocessed={() => { void onRetryRefresh(); }}
            />

            {/* Status das trilhas paralelas (regra padrão + reembolso) */}
            <ParallelTracksPanel
              segments={persistedSegments}
              restrictedSegmentCount={doc.restrictedSegmentCount || 0}
              formatCostCenter={formatCostCenter}
            />


            {/* Painel de segmentação por regra */}

            {segmented && persistedSegments.length === 0 && (
              <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Split className="w-4 h-4 text-primary" />
                  <h4 className="text-sm font-semibold text-foreground">
                    Aprovação segmentada por regra
                  </h4>
                  <Badge variant="outline" className="text-[10px]">
                    {segments.length} segmentos
                  </Badge>
                  {maskOtherSegments && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                      Vendo só sua parte
                    </span>
                  )}

                  {specialRateio && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5">
                      Folha/impostos — visão completa
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {specialRateio
                    ? "Rateio sistêmico de folha/impostos: todos os aprovadores visualizam todas as linhas do documento."
                    : "As linhas deste documento caem em regras de aprovação diferentes. Cada aprovador vê apenas as linhas e o valor da sua alçada."}
                </p>
                <div className="space-y-1.5">
                  {segments.map((seg) => {
                    const isMine = mySegments.some((m) => m.segmentKey === seg.segmentKey);
                    const masked = maskOtherSegments && !isMine;
                    return (
                      <div
                        key={seg.costCenter}
                        title={masked ? "Segmento da alçada de outro aprovador" : undefined}
                        className={`rounded-lg border p-2.5 text-xs ${
                          isMine
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-border bg-background/40"
                        }`}
                      >
                        <div className={`flex items-center justify-between gap-2 flex-wrap ${masked ? "blur-sm select-none" : ""}`}>
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
                        <div className={`mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground ${masked ? "blur-sm select-none" : ""}`}>
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
                {segmented && mySegments.length > 0 && (
                  <div className="pt-2 border-t border-primary/20 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Total dos seus segmentos:{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {formatCurrency(visibleTotal, doc.currency)}
                      </span>
                    </span>
                    {(isAdmin || isSuperUser) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setShowAllLines((v) => !v)}
                      >
                        {showAllLines ? "Ver só minha parte" : "Ver documento completo"}
                      </Button>
                    )}
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
                    {maskOtherSegments && (
                      <span className="ml-2 normal-case tracking-normal text-[10px] text-muted-foreground">
                        (linhas de outros aprovadores estão borradas)
                      </span>
                    )}
                  </p>
                </div>
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">

                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="text-left py-2 px-3 text-muted-foreground">Código</th>
                        <th className="text-left py-2 px-3 text-muted-foreground">Descrição</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Qtd</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Preço Unit.</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Total</th>
                        <th className="text-left py-2 px-3 text-muted-foreground">C. Custo</th>
                        <th className="text-left py-2 px-3 text-muted-foreground">Projeto</th>

                      </tr>
                    </thead>
                    <tbody>
                      {visibleLines.map((line, i) => {
                        const mine = isLineMine(line);
                        const key = lineSegmentKey(line);
                        const seg = segmentByCC.get(key);
                        const otherApprover = !mine
                          ? (seg?.approverNames?.[0] || seg?.approverEmails?.[0] || "outro aprovador")
                          : null;
                        return (
                          <tr
                            key={i}
                            className={`border-b border-border/50 ${
                              !mine ? "bg-muted/10" : ""
                            }`}
                            title={!mine ? `Linha da alçada de ${otherApprover}` : undefined}
                          >
                            <td className={`py-2 px-3 font-mono text-muted-foreground ${!mine ? "blur-sm select-none" : ""}`}>{line.ItemCode}</td>
                            <td className="py-2 px-3 text-foreground">
                              {!mine ? (
                                <span className="flex items-center gap-2">
                                  <span className="blur-sm select-none">{line.Description}</span>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] shrink-0 border-muted-foreground/40 text-muted-foreground font-normal"
                                  >
                                    Alçada de {otherApprover}
                                  </Badge>
                                </span>
                              ) : (
                                line.Description
                              )}
                            </td>
                            <td className={`py-2 px-3 text-right font-mono ${!mine ? "blur-sm select-none" : ""}`}>{line.Quantity}</td>
                            <td className={`py-2 px-3 text-right font-mono ${!mine ? "blur-sm select-none" : ""}`}>{formatCurrency(doc.currency !== "BRL" && line.PriceFC ? line.PriceFC : line.UnitPrice, doc.currency)}</td>
                            <td className={`py-2 px-3 text-right font-mono font-medium ${!mine ? "blur-sm select-none" : ""}`}>{formatCurrency(doc.currency !== "BRL" && line.LineTotalFC ? line.LineTotalFC : line.LineTotal, doc.currency)}</td>
                            <td className={`py-2 px-3 text-muted-foreground ${!mine ? "blur-sm select-none" : ""}`}>{line.CostingCode ? formatCostCenter(line.CostingCode) : "—"}</td>
                            <td className={`py-2 px-3 text-muted-foreground ${!mine ? "blur-sm select-none" : ""}`}>{line.Project || "—"}</td>

                          </tr>
                        );
                      })}
                      {(doc.restrictedItemCount || 0) > 0 && (
                        <tr className="border-b border-border/50 bg-muted/10">
                          <td colSpan={7} className="px-3 py-3">
                            <div className="flex items-center gap-3" aria-label="Itens de outras ramificações com detalhes restritos">
                              <div className="h-3 flex-1 rounded bg-muted-foreground/10" />
                              <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">
                                {doc.restrictedItemCount} linha{doc.restrictedItemCount === 1 ? "" : "s"} de outras ramificações ofuscada{doc.restrictedItemCount === 1 ? "" : "s"}
                              </span>
                              <div className="h-3 flex-1 rounded bg-muted-foreground/10" />
                            </div>
                          </td>
                        </tr>
                      )}
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
                        setViewer({ name: att.file_name, url: null });
                        try {
                          const { sapFunctionFetch } = await import("@/lib/auth-fetch");
                          const res = await sapFunctionFetch("expense-attachment-storage", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "sign", file_path: att.file_path }),
                          });
                          const data = await res.json().catch(() => null);
                          if (!res.ok || !data?.signed_url) throw new Error(data?.error || "URL indisponível");
                          openViewer(att.file_name, data.signed_url as string);
                        } catch (e) {
                           console.error("Erro ao abrir anexo:", e);
                           toast.error(e instanceof Error ? e.message : "Não foi possível abrir o anexo");
                           setViewer(null);
                         }
                      }}
                      className="w-full text-left text-xs bg-muted/20 hover:bg-muted/40 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                      title="Visualizar anexo"
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
              <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 rounded-lg px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
                <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />
                <span>Você está atuando como super-usuário. O aprovador designado é <strong>{doc.currentApprover}</strong>.</span>
              </div>
            )}

          </div>
          </div>

            {/* Action area — fica fora da área rolável para não sobrepor o conteúdo */}
            <div className="shrink-0 px-4 sm:px-6 pt-4 pb-4 sm:pb-6 bg-background border-t border-border space-y-3 shadow-[0_-12px_24px_-8px_hsl(var(--background))]">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Comentário (opcional)</p>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Adicione um comentário à sua decisão..."
                  className="bg-background border-border text-sm"
                  rows={2}
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isActioning}
                  className="w-full sm:w-auto"
                >
                  Cancelar
                </Button>
                {/* Transferência disponível apenas para aprovações internas (Regra Interna).
                    Aprovações nativas do SAP não podem ser transferidas daqui porque a
                    decisão precisa ser enviada pelo próprio usuário SAP. */}
                {canApprove && doc.approvalRequestId <= 0 && (
                  <Button
                    variant="outline"
                    onClick={() => onDelegate(doc)}
                    disabled={isActioning}
                    className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10 w-full sm:w-auto"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Transferir
                  </Button>
                )}
                {isAdmin && doc.approvalRequestId <= 0 && (
                  <Button
                    variant="outline"
                    onClick={() => onReprocessApproval(doc)}
                    disabled={isActioning || isReprocessingApproval}
                    className="gap-1.5 border-amber-500/40 text-amber-600 dark:text-amber-300 hover:bg-amber-500/10 w-full sm:w-auto"
                  >
                    {isReprocessingApproval
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <RefreshCw className="w-4 h-4" />}
                    Reprocessar Aprovação
                  </Button>
                )}
                {canApprove && doc.approvalRequestId <= 0 && doc.delegatedFrom && (
                  <Button
                    variant="outline"
                    onClick={() => onRevokeDelegation(doc)}
                    disabled={isActioning || isRevokingDelegation}
                    className="gap-1.5 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 w-full sm:w-auto"
                    title={`Revogar delegação e devolver aprovação para ${doc.delegatedFrom}`}
                  >
                    {isRevokingDelegation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                    Revogar delegação
                  </Button>
                )}
                {canApprove ? (
                  <>
                    <Button
                      variant="destructive"
                      onClick={() => handleAction("reject")}
                      disabled={isActioning}
                      className="gap-1.5 w-full sm:w-auto"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Rejeitar
                    </Button>
                    <Button
                      onClick={() => handleAction("approve")}
                      disabled={isActioning}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      Aprovar
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground italic sm:self-center text-center sm:text-right">
                    Somente leitura — você não é o aprovador deste documento
                  </span>
                )}
              </div>
            </div>
            {/* Raio-X: renderizado DENTRO do modal de detalhes para que o Radix
                aninhe corretamente os focus scopes (dois diálogos irmãos abertos
                ao mesmo tempo disputavam o foco e derrubavam a tela). */}
            {showExplain && (
              <ApprovalRuleExplainDialog
                open={showExplain}
                onClose={() => setShowExplain(false)}
                docTitle={`${doc.docTypeName} ${docNumberLabel(doc)} · ${doc.cardName}`}
                appliedRuleId={explainMeta.ruleId}
                currentLevel={explainMeta.currentLevel}
                currentApprover={doc.currentApprover || ""}
                vars={explainVars}
              />
            )}
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
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Documento</span>
                    <span className="font-mono">{docNumberLabel(doc)}</span>
                  </div>
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
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-2 text-amber-900 dark:text-amber-100">
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
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
      <AttachmentViewer
        open={!!viewer}
        onClose={closeViewer}
        name={viewer?.name || ""}
        url={viewer?.url ?? null}
        loading={!!viewer && !viewer.url}
      />
    </>
  );
}

function mapInternalExpense(e: ApprovalFeedDoc, ruleName?: string | null): ApprovalDoc & { __internalId?: string } {
  const isPagcorp = e.origin === "pagcorp";
  const isRevision = Number(e.revision_number || 1) > 1;
  const internalType = isRevision
    ? `Atualização de Pedido de ${e.doc_type === "sales" ? "Venda" : "Compra"} · v${e.revision_number}`
    : "Despesa Interna";
  return {
    approvalRequestId: -Math.abs(parseInt(e.id.replace(/\D/g, "").slice(0, 9) || "0", 10) || 1),
    docType: isPagcorp ? "Despesa PagCorp" : internalType,
    docTypeName: isPagcorp ? "Despesa PagCorp" : internalType,
    docNum: Number(e.sap_doc_num || 0),
    docEntry: 0,
    docTotal: Number(e.total_amount || 0),
    currency: e.currency || "BRL",
    cardCode: e.supplier_code || "",
    cardName: e.supplier_name || "—",
    requester: displayUserName(e.requester_name),
    currentApprover: e.current_approver && e.current_approver.trim() ? displayUserName(e.current_approver) : "Administrador",
    delegatedFrom: (e.original_approver || "").trim() && (e.original_approver || "").trim().toLowerCase() !== (e.current_approver || "").trim().toLowerCase()
      ? displayUserName(e.original_approver)
      : undefined,

    approverEmail: "",
    currentStage: "Aprovação Interna",
    status: "pending",
    docDate: e.created_at,
    dueDate: e.due_date || "",
    remarks: e.remarks || "",
    approvalModel: (ruleName || "").trim() || "Regra Interna",
    daysOpen: Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86_400_000),
    attachmentEntry: 0,
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
    rateioType: (e.rateio_type as string | null) || "padrao",
    approvalSegments: e.approval_segments || [],
    viewerSegmented: e.viewer_segmented === true,
    restrictedSegmentCount: Number(e.restricted_segment_count || 0),
    restrictedItemCount: Number(e.restricted_item_count || 0),
    __internalId: e.id,
    __revision: Number(e.revision_number || 1),

    __explain: {
      ruleId: e.approval_rule_id || null,
      currentLevel: e.current_level_order ?? null,
      docType: ((e as unknown as { doc_type?: string }).doc_type || "purchase"),
      requesterName: e.requester_name || "",
    },
  } as ApprovalDoc & { __internalId?: string };
}

function escapeSapString(value: string): string {
  return value.replace(/'/g, "''");
}

function approverMatches(approver: string, userName: string): boolean {
  return isDesignatedApprover(userName, approver, null);
}

interface SapApprovalDecisionRow {
  Status?: string;
  UserID?: number;
  ApprovalRequestStep?: number;
  Remarks?: string;
  [key: string]: unknown;
}

interface SapApprovalRequestPayload {
  Code?: number;
  Status?: string;
  ApprovalRequestDecisions?: SapApprovalDecisionRow[];
}

function isPendingSapDecision(status?: string): boolean {
  return !status || status === "ardPending" || status === "asWithoutDecision" || status === "asPending";
}

function isCompletedSapDecision(status: string | undefined, action: "approve" | "reject"): boolean {
  return action === "approve" ? status === "ardApproved" : status === "ardNotApproved";
}

async function getCurrentSapUserKey(session: SapSession): Promise<number> {
  const filter = encodeURIComponent(`UserCode eq '${escapeSapString(session.userName)}'`);
  const res = await sapQuery(
    session,
    `Users?$filter=${filter}&$select=InternalKey,UserCode,UserName,eMail`,
    undefined,
    false,
  );
  const payload = res.data as { value?: Array<{ InternalKey?: number }> } | Array<{ InternalKey?: number }> | null;
  const users = Array.isArray(payload) ? payload : (payload?.value || []);
  const key = Number(users[0]?.InternalKey);
  if (!Number.isFinite(key) || key <= 0) {
    throw new Error(`Usuário SAP '${session.userName}' não encontrado para registrar a decisão.`);
  }
  return key;
}

async function getSapApprovalRequest(session: SapSession, code: number): Promise<SapApprovalRequestPayload> {
  const res = await sapQuery(
    session,
    `ApprovalRequests(${code})?$select=Code,Status&$expand=ApprovalRequestDecisions`,
    undefined,
    false,
  );
  return (res.data || {}) as SapApprovalRequestPayload;
}

function findPendingDecisionIndex(decisions: SapApprovalDecisionRow[], userKey: number): number {
  return decisions.findIndex((d) => Number(d.UserID) === userKey && isPendingSapDecision(d.Status));
}

function findCompletedDecisionForAction(decisions: SapApprovalDecisionRow[], userKey: number, action: "approve" | "reject") {
  return decisions.find((d) => Number(d.UserID) === userKey && isCompletedSapDecision(d.Status, action));
}

function formatSapApprovalError(message: string, doc?: ApprovalDoc | null): string {
  if (/not permitted|não.*permit|permiss/i.test(message)) {
    return [
      "O SAP recusou a decisão para a sessão atual.",
      "Isso normalmente acontece quando o UserCode logado não é a decisão pendente real no SAP ou quando falta autorização geral para aprovar no SAP Business One.",
      doc?.currentApprover ? `Aprovador exibido na lista: ${doc.currentApprover}.` : null,
      `Detalhe SAP: ${message}`,
    ].filter(Boolean).join(" ");
  }
  return message;
}

async function decideSapApprovalRequest(
  session: SapSession,
  code: number,
  action: "approve" | "reject",
  remarks: string,
  doc?: ApprovalDoc | null,
): Promise<{ recoveredFromSapError: boolean }> {
  // A decisão é sempre aplicada ao usuário da sessão do Service Layer. Se a
  // sessão ativa for técnica (ApiUser), o SAP recusa com "You are not
  // permitted to perform this action" — por isso exigimos sessão do usuário.
  session = await ensureUserSapSession(session);

  // Idempotência: se já existe decisão finalizada para este usuário com a
  // mesma ação, tratamos como sucesso silencioso. Se a leitura falhar, seguimos
  // para o PATCH — o SAP aplica a decisão ao usuário da sessão atual.
  let userKey: number | null = null;
  try {
    userKey = await getCurrentSapUserKey(session);
    const request = await getSapApprovalRequest(session, code);
    const decisions = request.ApprovalRequestDecisions || [];
    if (findCompletedDecisionForAction(decisions, userKey, action)) {
      return { recoveredFromSapError: true };
    }
  } catch {
    // Ignora — deixamos o SAP validar no PATCH abaixo.
  }

  try {
    // SAP B1 aplica esta decisão ao usuário da sessão atual do Service Layer.
    // Enviar UserID/outras linhas pode ser interpretado como tentativa de
    // editar decisão de outro aprovador (erro -6006).
    await sapAction(session, `ApprovalRequests(${code})`, "PATCH", {
      ApprovalRequestDecisions: [{
        Status: action === "approve" ? "ardApproved" : "ardNotApproved",
        Remarks: remarks || undefined,
      }],
    });
    return { recoveredFromSapError: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (userKey !== null) {
      try {
        const fresh = await getSapApprovalRequest(session, code);
        const freshDecisions = fresh.ApprovalRequestDecisions || [];
        if (findCompletedDecisionForAction(freshDecisions, userKey, action)) {
          return { recoveredFromSapError: true };
        }
      } catch { /* keep original SAP error */ }
    }
    throw new Error(formatSapApprovalError(message, doc));
  }
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
            <span className="font-mono">{docNumberLabel(doc)}</span>
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
    const has = (v: unknown) => String(v ?? "").toLowerCase().includes(q);
    return (
      has(r.docNum) ||
      matchesDocQuery(r as never, search) ||
      has(r.cardName) ||
      has(r.docTypeName) ||
      has(r.approvalModel)
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
            placeholder="Buscar por nº ou código interno, fornecedor, tipo..."
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
                  <td className="py-3 px-3 font-mono text-xs text-foreground font-semibold">{docNumberLabel(doc)}</td>
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

      {reqHasMore ? (
        <div ref={reqSentinelRef} className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>Carregando mais… ({visibleRequests.length} de {reqTotal})</span>
          <Button variant="ghost" size="sm" onClick={reqLoadMore}>Mostrar mais</Button>
        </div>
      ) : reqTotal > reqInitial ? (
        <div className="text-center py-3 text-xs text-muted-foreground">{reqTotal} pedido(s) exibidos</div>
      ) : null}

      <MyRequestDetailModal doc={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default function ApprovalsPage() {
  const { session, logout } = useSap();
  const { user: authUser, isAdmin: isLovableAdmin } = useAuth();
  const navigate = useNavigate();
  const { approvals, isLoading, isRefreshing, error, lastUpdatedAt, refresh, refreshCache, removeLocal: removeApprovalLocal } = useApprovals();
  // Documentos internos pendentes vêm de UM único feed servidor-side
  // (`approvals-feed`): escopo de visibilidade, itens, anexos e aprovadores do
  // nível atual já resolvidos, com pintura imediata a partir do cache local.
  const {
    docs: feedDocs,
    privileged: feedPrivileged,
    isLoading: isLoadingFeed,
    refresh: refreshFeed,
    removeLocal: removeFeedLocal,
  } = useApprovalsFeed();
  const purchaseExpenses = useMemo(
    () => feedDocs.filter((d) => (d as { doc_type?: string }).doc_type !== "sales"),
    [feedDocs],
  );
  const salesExpenses = useMemo(
    () => feedDocs.filter((d) => (d as { doc_type?: string }).doc_type === "sales"),
    [feedDocs],
  );
  const isLoadingPurchase = isLoadingFeed;
  const isLoadingSales = isLoadingFeed;
  // `useExpenses` fica apenas para as mutações — sem nenhuma leitura no mount.
  const { approveExpense, rejectExpense } = useExpenses("purchase", { enabled: false });
  const expenses = feedDocs;
  const refreshExpenses = () => refreshFeed();
  const removeExpenseLocal = (internalId: string) => {
    removeFeedLocal(internalId);
  };
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
  const { canViewAll: canViewAllByGroup } = useCanViewAllDocuments();
  // Grupo "Usuário Administrativo": vê todos os documentos da própria diretoria.
  const { matches: inMyDirectorate } = useDirectorateScope();
  // "Ver todas as aprovações" começa DESMARCADO por padrão para todos —
  // inclusive super-usuários/admins. Quem tem permissão pode ligar manualmente.
  // Apenas o grupo "Usuário" não enxerga a opção.
  // Uma vez concedida, a permissão de "ver todas" não é retirada no meio da
  // sessão: revalidações incompletas faziam o toggle (e a lista) sumirem.
  const grantedShowAllRef = useRef(false);
  if (isAdmin || canViewAllApprovals || canViewAllByGroup) grantedShowAllRef.current = true;
  const canToggleShowAll =
    isAdmin || canViewAllApprovals || canViewAllByGroup || grantedShowAllRef.current;

  const { has: hasCapability } = useMyCapabilities();
  const [showAll, setShowAll] = useState<boolean>(false);
  // O grupo pode optar por já abrir a tela com "Ver todas" ligado.
  const appliedShowAllDefault = useRef(false);
  useEffect(() => {
    if (appliedShowAllDefault.current) return;
    if (canToggleShowAll && hasCapability("view_all_default_on")) {
      appliedShowAllDefault.current = true;
      setShowAll(true);
    }
  }, [canToggleShowAll, hasCapability]);
  const [delegationDoc, setDelegationDoc] = useState<ApprovalDoc | null>(null);
  const [reprocessApprovalDoc, setReprocessApprovalDoc] = useState<ApprovalDoc | null>(null);
  const [showSubstitutes, setShowSubstitutes] = useState(false);

  const [isDelegating, setIsDelegating] = useState(false);
  const [isReprocessingApproval, setIsReprocessingApproval] = useState(false);
  const [isRevokingDelegation, setIsRevokingDelegation] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "purchase" | "sales">("all");
  const [originFilter, setOriginFilter] = useState<"all" | "erp" | "internal">("all");
  const [minValue, setMinValue] = useState<string>("");
  const [maxValue, setMaxValue] = useState<string>("");
  const [createdFrom, setCreatedFrom] = useState<string>("");
  const [createdTo, setCreatedTo] = useState<string>("");
  const [dueFrom, setDueFrom] = useState<string>("");
  const [dueTo, setDueTo] = useState<string>("");
  const [ccFilter, setCcFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [selectedTransferIds, setSelectedTransferIds] = useState<Set<string>>(new Set());
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [isTransferringApprovals, setIsTransferringApprovals] = useState(false);
  // Ordenação da tabela — por padrão, vencimento mais antigo primeiro.
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "docTotal" ? "desc" : "asc");
    }
  };

  const companyLabel = getLabel(session?.companyDB || "");
  const { getCostCentersForEmail } = useApproverCostCenters(session?.companyDB);
  const { officials: activeOfficials, refresh: refreshActiveOfficials } = useActiveOfficialsForMe();
  const { users: transferUsers, isLoading: transferUsersLoading } = useSapUsers();
  const transferUserOptions = useMemo<ApprovalTransferUserOption[]>(
    () => sortUserOptions(
      transferUsers
        .filter((u) => u.Locked !== "tYES" && (u.UserName || u.UserCode || u.eMail))
        .map((u) => ({
          code: (u.UserCode || u.eMail || u.UserName || "").trim(),
          name: (u.UserName || u.UserCode || u.eMail || "").trim(),
          extra: (u.eMail || "").trim() || undefined,
          email: (u.eMail || "").trim() || undefined,
        }))
        .filter((u) => u.code && u.name),
    ),
    [transferUsers],
  );
  const { grants: substituteGrants, refresh: refreshSubstituteGrants } = useSubstituteGrantsForMe();

  // ── Recarregamento automático quando as permissões de substituto mudam ──
  // 1) Mesma sessão: evento disparado ao criar/revogar uma substituição.
  // 2) Outra sessão (o substituto está com a tela aberta): revalida os grants
  //    ao voltar o foco na aba e a cada 60s; se a lista mudou, recarrega a fila.
  const grantsSignature = useMemo(
    () =>
      substituteGrants
        .map((g) => `${g.id}:${g.official_email}:${g.starts_at}:${g.ends_at}:${(g.cost_center_prefixes || []).join("|")}`)
        .sort()
        .join(";"),
    [substituteGrants],
  );
  const grantsSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = grantsSignatureRef.current;
    grantsSignatureRef.current = grantsSignature;
    if (prev === null || prev === grantsSignature) return;
    // Permissões mudaram: recarrega a fila de aprovações com os novos escopos.
    void refreshFeed();
    void refresh();
    toast.info("Suas permissões de substituição foram atualizadas — lista recarregada");
  }, [grantsSignature, refreshFeed, refresh]);

  useEffect(() => {
    const revalidate = () => {
      void refreshSubstituteGrants();
      void refreshActiveOfficials();
    };
    const onVisible = () => { if (document.visibilityState === "visible") revalidate(); };
    window.addEventListener(SUBSTITUTES_CHANGED_EVENT, revalidate);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(revalidate, 60_000);
    return () => {
      window.removeEventListener(SUBSTITUTES_CHANGED_EVENT, revalidate);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [refreshSubstituteGrants, refreshActiveOfficials]);

  // Somente leitura nesta tela — evita centenas de writes de backfill no load.
  // A matriz só é necessária quando o usuário abre um documento (raio-x /
  // segmentação). Carregar no mount custava centenas de regras + níveis.
  const { rules } = useApprovalRules({ backfill: false, enabled: !!selectedDoc });

  // Nome da regra de alçada aplicada a cada despesa interna (consulta leve:
  // só id + nome das regras referenciadas pelos documentos em tela).
  const [ruleNameById, setRuleNameById] = useState<Record<string, string>>({});
  const ruleIdsKey = useMemo(
    () =>
      Array.from(
        new Set(
          (expenses || [])
            .map((e) => (e as { approval_rule_id?: string | null }).approval_rule_id || "")
            .filter(Boolean),
        ),
      )
        .sort()
        .join(","),
    [expenses],
  );
  useEffect(() => {
    const ids = ruleIdsKey ? ruleIdsKey.split(",") : [];
    const missing = ids.filter((id) => !ruleNameById[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("approval_rules")
        .select("id, name")
        .in("id", missing);
      if (cancelled || !data) return;
      setRuleNameById((prev) => {
        const next = { ...prev };
        for (const r of data as Array<{ id: string; name: string }>) next[r.id] = r.name;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [ruleIdsKey, ruleNameById]);


  // Merge SAP approvals with internal pending expenses.
  // Os aprovadores do nível atual já vêm resolvidos pelo servidor
  // (`level_approvers`) — a tela não precisa mais baixar a matriz inteira só
  // para descobrir quem aprova cada documento.
  const internalPending = useMemo(
    () =>
      (expenses || [])
        .filter((e) => e.status === "pendente_aprovacao")
        .map((e) => {
          const doc = mapInternalExpense(
            e,
            ruleNameById[(e as { approval_rule_id?: string | null }).approval_rule_id || ""] || null,
          );
          // O solicitante nunca conta como aprovador do nível — a aprovação
          // dele é escalada para os demais aprovadores / próximo nível.
          const current = excludeRequesterApprovers(
            ((e as { level_approvers?: Array<{ name: string; email: string }> }).level_approvers) || [],
            e.requester_name,
            e.requester_email,
          );
          if (current.length > 0) {
            if (!doc.approverEmail && current[0]?.email) doc.approverEmail = current[0].email;
            // Uma delegação explícita em `current_approver` tem precedência.
            const hasOverride = !!(e.current_approver && e.current_approver.trim());
            if (!hasOverride) {
              const names = current
                .map((l) => displayUserName(l.name || l.email || ""))
                .filter(Boolean);
              if (names.length > 0) doc.currentApprover = names.join(" / ");
            }
            // Lista completa do nível atual — usada pelo filtro "Para aprovar".
            (doc as unknown as { __levelApprovers?: Array<{ name: string; email: string }> }).__levelApprovers =
              current;
          }
          return doc;
        }),
    [expenses, ruleNameById],
  );


  // Deduplica por chave única — evita mostrar o mesmo lançamento duas vezes
  // quando o usuário é aprovador principal E substituto ativo do aprovador
  // atual (ou tem múltiplas regras de substituição sobrepostas).
  const allApprovals: ApprovalDoc[] = useMemo(() => {
    const merged: ApprovalDoc[] = [...internalPending, ...approvals];
    const seen = new Set<string>();
    const out: ApprovalDoc[] = [];
    for (const d of merged) {
      const internalId = (d as unknown as { __internalId?: string }).__internalId;
      const key = internalId ? `internal:${internalId}` : `sap:${d.approvalRequestId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvals, expenses]);

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

  // Deep-link: read `?doc=<key>` e abre o modal correspondente assim que o
  // documento aparecer em `allApprovals`. Para chaves `internal:<uuid>` (docs
  // internos criados no ERP Flow), esperamos o carregamento das despesas antes
  // de decidir que o doc não existe mais. Se ele já não estiver pendente,
  // redireciona para Compras/Vendas mantendo o mesmo `doc`.
  useEffect(() => {
    const id = readDocParam();
    if (!id || selectedDoc) return;
    // Se já abrimos um documento nesta sessão de página, o `?doc=` remanescente
    // é apenas o rastro da URL sendo limpa após fechar o modal (ex.: pós-
    // aprovação otimista, onde o item some da lista). Não mostrar erro nesse caso.
    if (hadSelectedDocRef.current) { setDocParam(null); return; }
    const keyOf = (d: ApprovalDoc) => {
      const internalId = (d as unknown as { __internalId?: string }).__internalId;
      return internalId ? `internal:${internalId}` : `sap:${d.approvalRequestId}`;
    };
    const found = allApprovals.find((d) => keyOf(d) === id);
    if (found) { setSelectedDoc(found); return; }

    // Só decide "não é mais pendente" depois de tudo carregado — evita redirect
    // prematuro quando as listas ainda estão sendo buscadas.
    const isInternal = id.startsWith("internal:");
    const stillLoading = isInternal
      ? (isLoadingPurchase || isLoadingSales)
      : isLoading;
    if (stillLoading) return;

    if (isInternal) {
      const rawId = id.slice("internal:".length);
      const purchaseHit = purchaseExpenses.find((e) => e.id === rawId);
      const salesHit = salesExpenses.find((e) => e.id === rawId);
      const hit = purchaseHit || salesHit;
      if (hit) {
        toast.info("Este documento não está mais pendente.", {
          description: `Abrindo em ${salesHit ? "Vendas" : "Compras"}…`,
        });
        setDocParam(null);
        navigate(`${salesHit ? "/vendas/pedidos" : "/compras"}?doc=${encodeURIComponent(rawId)}`);
      } else {
        // A listagem desta tela traz apenas pendentes. Antes de dizer que o
        // documento não existe, faz uma consulta pontual pelo id.
        setDocParam(null);
        void (async () => {
          const { data: found } = await expenseRead("expenses")
            .select("id, doc_type")
            .eq("id", rawId)
            .limit(1);
          const row = Array.isArray(found) ? found[0] : null;
          if (row) {
            const isSales = (row as { doc_type?: string }).doc_type === "sales";
            toast.info("Este documento não está mais pendente.", {
              description: `Abrindo em ${isSales ? "Vendas" : "Compras"}…`,
            });
            navigate(`${isSales ? "/vendas/pedidos" : "/compras"}?doc=${encodeURIComponent(rawId)}`);
          } else {
            toast.error("Documento não encontrado.", {
              description: "O link pode estar inválido, pertencer a outra empresa ou você não tem permissão para visualizá-lo.",
            });
          }
        })();
      }
    } else {
      // Chave `sap:<id>` inexistente na listagem carregada.
      toast.error("Aprovação SAP não encontrada.", {
        description: "A solicitação pode já ter sido processada ou não está mais disponível.",
      });
      setDocParam(null);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvals, purchaseExpenses, salesExpenses, isLoading, isLoadingPurchase, isLoadingSales]);



  // Keep `?doc=<key>` in sync with the selected approval so it can be shared.
  // Só limpa o param depois que o modal foi realmente aberto uma vez — evita
  // apagar o deep-link no mount antes das listas terminarem de carregar.
  const hadSelectedDocRef = useRef(false);
  useEffect(() => {
    if (selectedDoc) {
      hadSelectedDocRef.current = true;
      const internalId = (selectedDoc as unknown as { __internalId?: string }).__internalId;
      setDocParam(internalId ? `internal:${internalId}` : `sap:${selectedDoc.approvalRequestId}`);
    } else if (hadSelectedDocRef.current) {
      setDocParam(null);
    }
  }, [selectedDoc]);


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
    if (!session) { savePostLoginPath(); navigate("/"); }
  }, [session, navigate]);

  // Filter: por padrão mostra apenas aprovações em que o usuário é aprovador OU solicitante.
  // Admin pode usar o toggle "Ver todas" para visualizar todos os lançamentos.
  // Se o usuário tem substituição ativa, os documentos dos aprovadores oficiais também aparecem.
  const effectiveShowAll = canToggleShowAll && showAll;
  const sessionUserName = session?.userName || "";
  const sessionCompanyDb = session?.companyDB || "";
  const sessionUser = sessionUserName.toLowerCase().trim();
  const authEmail = authUser?.email || "";
  const authDisplayName = String(
    authUser?.user_metadata?.full_name ||
    authUser?.user_metadata?.name ||
    authUser?.user_metadata?.display_name ||
    "",
  );
  const impersonation = getImpersonation();
  // Uma pessoa pode ter UserCode, nome e e-mails em domínios diferentes. Na
  // impersonação, a sessão técnica pode ser do admin, portanto o alvo salvo é
  // parte obrigatória da identidade usada para filtrar e autorizar.
  // O feed servidor-side também usa a conta Supabase/IdP para resolver aliases;
  // sem ela, usuários que entram por login gerenciado veem a fila mas o botão
  // local não reconhece que eles são o aprovador atual.
  const currentUserIdentities = useMemo(
    () => [
      sessionUserName,
      authEmail,
      authDisplayName,
      impersonation?.companyDB === sessionCompanyDb ? impersonation.targetUser : null,
      impersonation?.companyDB === sessionCompanyDb ? impersonation.targetEmail : null,
      impersonation?.companyDB === sessionCompanyDb ? impersonation.targetName : null,
    ],
    [
      sessionUserName,
      authEmail,
      authDisplayName,
      impersonation?.companyDB,
      impersonation?.targetUser,
      impersonation?.targetEmail,
      impersonation?.targetName,
      sessionCompanyDb,
    ],
  );
  const isCurrentUserApprover = (doc: ApprovalDoc): boolean =>
    matchesApproverIdentity(
      currentUserIdentities,
      doc.approverCode,
      doc.currentApprover,
      doc.approverEmail,
    );
  /**
   * Escopo por centro de custo da substituição: quando o grant define
   * `cost_center_prefixes` (ex.: ["1.8"]), a substituição só vale para
   * documentos cujos CCs pertençam àquela diretoria. Sem prefixos = todos.
   */
  const ccScopeAllows = useCallback(
    (prefixes: string[] | null | undefined, ccs: string[]): boolean => {
      const list = (prefixes || []).map((p) => (p || "").trim()).filter(Boolean);
      if (list.length === 0) return true;
      if (ccs.length === 0) return false;
      return ccs.some((raw) => {
        const c = (raw || "").trim();
        if (!c) return false;
        return list.some((p) => c === p || c.startsWith(`${p}.`));
      });
    },
    [],
  );
  const identifiersOf = useCallback(
    (officials: typeof activeOfficials) =>
      officials.flatMap((o) => {
        const e = (o.official_email || "").toLowerCase();
        const prefix = e.split("@")[0];
        const name = (o.official_name || "").toLowerCase();
        return [e, prefix, name].filter(Boolean);
      }),
    [],
  );
  /** Officials cuja substituição vale para ESTE documento (respeita o escopo de CC). */
  const officialsForDoc = useCallback(
    (d: ApprovalDoc | null | undefined) => {
      if (!d) return [] as typeof activeOfficials;
      const ccs = docCostCenters(d);
      return activeOfficials.filter((o) => ccScopeAllows(o.cost_center_prefixes, ccs));
    },
    [activeOfficials, ccScopeAllows],
  );
  const identifiersForDoc = useCallback(
    (d: ApprovalDoc | null | undefined) => identifiersOf(officialsForDoc(d)),
    [identifiersOf, officialsForDoc],
  );
  const codeEq = (code?: string, doc?: ApprovalDoc) => {
    if (!code) return false;
    const c = code.toLowerCase().trim();
    if (c === sessionUser) return true;
    return identifiersForDoc(doc).includes(c);
  };
  const matchesSubstitutedOfficial = (approver: string, doc?: ApprovalDoc) => {
    const ids = identifiersForDoc(doc);
    if (!approver || ids.length === 0) return false;
    const a = approver.toLowerCase().trim();
    return ids.some((id) => id === a || a.includes(id) || id.includes(a));
  };
  // Retorna o aprovador oficial substituído por este documento — ou null se o
  // usuário é o aprovador/solicitante direto (não está atuando como substituto).
  const getSubstitutedOfficial = useCallback((d: ApprovalDoc): { name: string; email: string } | null => {
    const scopedOfficials = officialsForDoc(d);
    if (scopedOfficials.length === 0) return null;
    // Match direto (não é substituição)
    const directCode = (code?: string) => !!code && code.toLowerCase().trim() === sessionUser;
    if (
      directCode(d.approverCode) ||
      directCode(d.requesterCode) ||
      approverMatches(d.currentApprover, sessionUserName) ||
      approverMatches(d.requester, sessionUserName)
    ) return null;
    const approver = (d.currentApprover || "").toLowerCase().trim();
    const email = (d.approverEmail || "").toLowerCase().trim();
    for (const o of scopedOfficials) {
      const e = (o.official_email || "").toLowerCase();
      const prefix = e.split("@")[0];
      const name = (o.official_name || "").toLowerCase();
      if (email && (email === e || (prefix && email.startsWith(prefix + "@")))) {
        return { name: o.official_name || o.official_email, email: o.official_email };
      }
      if (approver) {
        if (prefix && (approver === prefix || approver.includes(prefix) || prefix.includes(approver))) {
          return { name: o.official_name || o.official_email, email: o.official_email };
        }
        if (name && (approver === name || approver.includes(name) || name.includes(approver))) {
          return { name: o.official_name || o.official_email, email: o.official_email };
        }
      }
    }
    return null;
  }, [officialsForDoc, sessionUser, sessionUserName]);

  /**
   * Recomputa se o usuário logado pode aprovar/rejeitar o documento dado —
   * usado tanto para exibir o botão quanto para revalidar imediatamente antes
   * de disparar a ação (defesa contra permissão que expirou entre a
   * renderização e o clique — ex.: substituição revogada/expirada, grant
   * fora da janela, delegação retirada no SAP, etc.).
   * Recebe o snapshot atual de `substituteGrants` para permitir revalidação
   * com dados recém-carregados.
   */
  const canApproveDocWith = useCallback(
    (doc: ApprovalDoc | null | undefined, grantsSnapshot: typeof substituteGrants): boolean => {
      if (!doc) return false;
      const isRequester =
        codeEq(doc.requesterCode, doc) ||
        approverMatches(doc.requester, sessionUserName) ||
        currentUserIdentities.some((id) =>
          isSameAsRequester(doc.requester, doc.requester, id, id),
        );
      // Bloqueio de auto-aprovação — vale para TODOS (inclusive super-usuário):
      // o solicitante nunca aprova o próprio documento; a decisão fica com os
      // demais aprovadores do nível ou escala para o próximo.
      if (isRequester) return false;

      const isDirectApprover = isCurrentUserApprover(doc);
      if (isDirectApprover) return true;

      // Substituto ativo: se o usuário é atualmente substituto oficial do aprovador
      // do documento (activeOfficials cobre a janela "agora"), permite a ação —
      // independente da docDate cair fora do grant, pois a aprovação acontece agora.
      const approverEmailNow = (doc.approverEmail || "").toLowerCase().trim();
      const approverNameNow = (doc.currentApprover || "").toLowerCase().trim();
      const isActiveSubstitute = identifiersForDoc(doc).some((id) => {
        if (!id) return false;
        if (approverEmailNow && (approverEmailNow === id || approverEmailNow.startsWith(`${id}@`))) return true;
        if (approverNameNow && (approverNameNow === id || approverNameNow.includes(id) || id.includes(approverNameNow))) return true;
        return false;
      });
      if (isActiveSubstitute) return true;



      const docCcs = docCostCenters(doc);
      const docRefTs = (() => {
        const d = doc.docDate;
        const t = d ? new Date(d).getTime() : NaN;
        return Number.isFinite(t) ? t : Date.now();
      })();
      const approverEmailLower = (doc.approverEmail || "").toLowerCase().trim();
      const approverNameLower = (doc.currentApprover || "").toLowerCase().trim();
      return grantsSnapshot.some((g) => {
        if (!ccScopeAllows(g.cost_center_prefixes, docCcs)) return false;
        const startsTs = new Date(g.starts_at).getTime();
        const endsTs = new Date(g.ends_at).getTime();
        if (!(startsTs <= docRefTs && docRefTs < endsTs)) return false;
        const ge = (g.official_email || "").toLowerCase();
        const gPrefix = ge.split("@")[0];
        const gn = (g.official_name || "").toLowerCase();
        if (approverEmailLower) {
          if (approverEmailLower === ge) return true;
          if (gPrefix && approverEmailLower.startsWith(`${gPrefix}@`)) return true;
        }
        if (approverNameLower) {
          if (gPrefix && (approverNameLower === gPrefix || approverNameLower.includes(gPrefix))) return true;
          if (gn && (approverNameLower === gn || approverNameLower.includes(gn) || gn.includes(approverNameLower))) return true;
        }
        return false;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionUserName, sessionUser, currentUserIdentities, identifiersForDoc, ccScopeAllows, isSuperUser],
  );
  const userApprovals = effectiveShowAll
    ? allApprovals
    : allApprovals.filter(
        (a) =>
          // Para documentos internos, o `approvals-feed` já aplica no servidor
          // o recorte por aliases, grupos, diretoria, substituição e aprovadores
          // do nível atual. Usuários sem privilégio devem ver esse snapshot como
          // fonte de verdade; o navegador nem sempre conhece todos os aliases.
          (!feedPrivileged && Boolean((a as unknown as { __internalId?: string }).__internalId)) ||
          isCurrentUserApprover(a) ||
          codeEq(a.requesterCode, a) ||
          approverMatches(a.requester, sessionUserName) ||
          // Aprovadores paralelos do nível atual (mesmo `level_order`).
          ((a as unknown as { __levelApprovers?: Array<{ name: string; email: string }> }).__levelApprovers || []).some(
            (l) =>
              matchesApproverIdentity(currentUserIdentities, null, l.name, l.email) ||
              (!!l.email && identifiersForDoc(a).includes(l.email.toLowerCase())),
          ) ||
          matchesSubstitutedOfficial(a.currentApprover, a) ||

          (a.approverEmail && identifiersForDoc(a).includes(a.approverEmail.toLowerCase())) ||
          // Aprovador original ainda vê o documento que delegou (mesmo sem "Ver todas").
          (a.delegatedFrom && approverMatches(a.delegatedFrom, sessionUserName)) ||
          // Diretoria do usuário administrativo (CC 1.6.% para quem é 1.6.1.2).
          docCostCenters(a).some((c) => inMyDirectorate(c)),
      );


  const minV = minValue ? parseFloat(minValue.replace(",", ".")) : null;
  const maxV = maxValue ? parseFloat(maxValue.replace(",", ".")) : null;
  const createdFromD = createdFrom ? new Date(createdFrom).getTime() : null;
  const createdToD = createdTo ? new Date(createdTo).getTime() + 86399999 : null;
  const dueFromD = dueFrom ? new Date(dueFrom).getTime() : null;
  const dueToD = dueTo ? new Date(dueTo).getTime() + 86399999 : null;

  const preFiltered = userApprovals.filter((a) => {
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

    // Centro de custo / Projeto (multi-seleção)
    if (ccFilter.length > 0) {
      const codes = docCostCenters(a);
      if (!codes.some((c) => ccFilter.includes(c))) return false;
    }
    if (projectFilter.length > 0) {
      const projs = docProjects(a);
      if (!projs.some((p) => projectFilter.includes(p))) return false;
    }

    if (originFilter !== "all") {
      const internal = isInternalDoc(a as never);
      if (originFilter === "internal" && !internal) return false;
      if (originFilter === "erp" && internal) return false;
    }

    if (!search) return true;
    const q = search.toLowerCase();
    const has = (v: unknown) => String(v ?? "").toLowerCase().includes(q);
    return (
      has(a.docNum) ||
      matchesDocQuery(a as never, search) ||
      has(a.cardName) ||
      has(a.requester) ||
      has(a.currentApprover) ||
      has(a.docTypeName) ||
      (a.documentLines || []).some((l) => has(l?.Project))
    );

  });

  // Opções disponíveis para os filtros — derivadas apenas dos documentos
  // visíveis ao usuário (antes dos filtros de CC/Projeto, para não zerar a lista).
  const ccOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of userApprovals) for (const c of docCostCenters(a)) set.add(c);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: formatCostCenter(v) || v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userApprovals, formatCostCenter]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of userApprovals) for (const p of docProjects(a)) set.add(p);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [userApprovals]);

  const overdueCount = preFiltered.filter((a) => getDueStatus(a.dueDate) === "overdue").length;
  const dueWarningCount = preFiltered.filter((a) => getDueStatus(a.dueDate) === "warning").length;

  const filtered = useMemo(() => {
    const base = onlyOverdue ? preFiltered.filter((a) => getDueStatus(a.dueDate) === "overdue") : preFiltered;
    const dir = sortDir === "asc" ? 1 : -1;
    const ts = (d?: string | null) => {
      const t = d ? new Date(d).getTime() : NaN;
      // Documentos sem data ficam sempre no fim, independente da direção.
      return Number.isFinite(t) ? t : null;
    };
    return [...base].sort((a, b) => {
      switch (sortKey) {
        case "docNum":
          return (Number(a.docNum) - Number(b.docNum)) * dir;
        case "docTotal":
          return (a.docTotal - b.docTotal) * dir;
        case "docTypeName":
          return a.docTypeName.localeCompare(b.docTypeName, "pt-BR") * dir;
        case "cardName":
          return a.cardName.localeCompare(b.cardName, "pt-BR") * dir;
        case "currentApprover":
          return a.currentApprover.localeCompare(b.currentApprover, "pt-BR") * dir;
        case "requester":
          return a.requester.localeCompare(b.requester, "pt-BR") * dir;
        case "docDate": {
          const ta = ts(a.docDate);
          const tb = ts(b.docDate);
          if (ta === null && tb === null) return 0;
          if (ta === null) return 1;
          if (tb === null) return -1;
          return (ta - tb) * dir;
        }
        case "dueDate":
        default: {
          const ta = ts(a.dueDate);
          const tb = ts(b.dueDate);
          if (ta === null && tb === null) return 0;
          if (ta === null) return 1;
          if (tb === null) return -1;
          return (ta - tb) * dir;
        }
      }
    });
  }, [preFiltered, onlyOverdue, sortKey, sortDir]);

  const totalValue = filtered.reduce((sum, a) => sum + a.docTotal, 0);
  const transferEligibleDocs = useMemo(
    () => filtered.filter((doc) => Boolean((doc as unknown as { __internalId?: string }).__internalId)),
    [filtered],
  );
  const selectedTransferDocs = useMemo(
    () => transferEligibleDocs.filter((doc) => selectedTransferIds.has((doc as unknown as { __internalId: string }).__internalId)),
    [transferEligibleDocs, selectedTransferIds],
  );
  const transferPendingCounts = useMemo(
    () => pendingCountsByApprover(transferEligibleDocs),
    [transferEligibleDocs],
  );
  const allTransferEligibleSelected = transferEligibleDocs.length > 0 && selectedTransferDocs.length === transferEligibleDocs.length;
  useEffect(() => {
    if (selectedTransferIds.size === 0) return;
    const eligibleIds = new Set(
      transferEligibleDocs.map((doc) => (doc as unknown as { __internalId: string }).__internalId),
    );
    setSelectedTransferIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => eligibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectedTransferIds.size, transferEligibleDocs]);

  const { visibleItems: visibleApprovals, hasMore: apprHasMore, loadMore: apprLoadMore, sentinelRef: apprSentinelRef, total: apprTotal, initial: apprInitial } =
    useLazyList(filtered, {
      initial: 30,
      step: 10,
      resetDeps: [search, typeFilter, originFilter, minValue, maxValue, createdFrom, createdTo, dueFrom, dueTo, showAll, viewMode, onlyOverdue, sortKey, sortDir, ccFilter.join(","), projectFilter.join(",")],
    });

  const handleApprovalAction = async (
    code: number,
    action: "approve" | "reject",
    remarks: string,
    opts?: { idempotencyKey?: string },
  ) => {
    if (!session) return;

    // ===== Pré-validação: a permissão de aprovar ainda vale AGORA? =====
    // Entre a renderização do modal e o clique, a janela de substituição
    // pode ter expirado, o grant pode ter sido revogado, ou o SAP pode ter
    // alterado o aprovador designado (ex.: delegação retirada). Recarregamos
    // os grants e recomputamos o canApprove imediatamente antes de disparar
    // a ação — se falhar, abortamos e avisamos o usuário.
    let liveGrants = substituteGrants;
    try {
      await refreshSubstituteGrants();
      const { data: userData } = await supabase.auth.getUser();
      const authEmail = (userData.user?.email || "").toLowerCase();
      const sapUser = (session.userName || "").toLowerCase().trim();
      const identifiers = Array.from(
        new Set(
          [authEmail, sapUser, authEmail.split("@")[0], sapUser.split("@")[0]].filter(Boolean),
        ),
      );
      const results = await Promise.all(
        identifiers.map((id) =>
          supabase.rpc("substitute_grants_for_me" as never, { _substitute_identifier: id } as never),
        ),
      );
      const seen = new Set<string>();
      const merged: typeof substituteGrants = [];
      for (const r of results) {
        const rows = ((r.data as typeof substituteGrants) || []);
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          merged.push(row);
        }
      }
      liveGrants = merged;
    } catch (e) {
      console.warn("Falha ao revalidar grants de substituição:", e);
    }

    const doc = selectedDoc;
    const internalDoc = (selectedDoc as any)?.__internalId;
    const adminInternalOverride = Boolean(internalDoc && isAdmin);

    // Papel do usuário na ação — usado para registrar no histórico:
    //   - substitute → grant vigente cobrindo a docDate
    //   - delegation → SAP recebeu delegate_approval prévio que apontou p/ mim
    //   - approver   → aprovador designado direto do fluxo
    const resolveActingRole = async (
      d: typeof doc,
      grantsSnapshot: typeof substituteGrants,
    ): Promise<"approver" | "substitute" | "delegation"> => {
      if (!d) return "approver";
      const docRefTs = (() => {
        const dt = d.docDate;
        const t = dt ? new Date(dt).getTime() : NaN;
        return Number.isFinite(t) ? t : Date.now();
      })();
      const approverEmailLower = (d.approverEmail || "").toLowerCase().trim();
      const approverNameLower = (d.currentApprover || "").toLowerCase().trim();
      const asSubstitute = grantsSnapshot.some((g) => {
        const startsTs = new Date(g.starts_at).getTime();
        const endsTs = new Date(g.ends_at).getTime();
        if (!(startsTs <= docRefTs && docRefTs < endsTs)) return false;
        const ge = (g.official_email || "").toLowerCase();
        const gPrefix = ge.split("@")[0];
        const gn = (g.official_name || "").toLowerCase();
        if (approverEmailLower) {
          if (approverEmailLower === ge) return true;
          if (gPrefix && approverEmailLower.startsWith(`${gPrefix}@`)) return true;
        }
        if (approverNameLower) {
          if (gPrefix && (approverNameLower === gPrefix || approverNameLower.includes(gPrefix))) return true;
          if (gn && (approverNameLower === gn || approverNameLower.includes(gn) || gn.includes(approverNameLower))) return true;
        }
        return false;
      });
      if (asSubstitute) return "substitute";
      // Checa se recebi essa aprovação via delegate_approval registrado no
      // audit_log — se sim, marcamos como "delegation".
      try {
        const { data: audit } = await supabase
          .from("audit_log")
          .select("details")
          .eq("action", "delegate_approval")
          .eq("entity_id", String(code))
          .order("created_at", { ascending: false })
          .limit(1);
        const row = (audit || [])[0] as any;
        const det = row?.details || {};
        const me = (session.userName || "").toLowerCase().trim();
        const newEmail = (det.newApproverEmail || "").toLowerCase();
        const newName = (det.newApproverName || "").toLowerCase();
        if (me && (me === newEmail || me === newName || (newEmail && me === newEmail.split("@")[0]))) {
          return "delegation";
        }
      } catch { /* ignore */ }
      return "approver";
    };

    if (!canApproveDocWith(doc, liveGrants) && !adminInternalOverride) {
      // Registra a tentativa negada no histórico (auditoria).
      try {
        const attemptedRole = await resolveActingRole(doc, liveGrants);
        const { logAuditAction } = await import("@/hooks/useAuditLog");
        await logAuditAction({
          action: "approval_attempt_denied",
          entity_type: doc && (doc as any).__internalId ? "expense" : "approval_request",
          entity_id: String((doc as any)?.__internalId || code),
          actor_email: session.userName,
          company_db: session.companyDB,
          details: {
            attemptedAction: action,
            attemptedRole,
            reason: "permission_expired_between_render_and_click",
            docNum: doc?.docNum,
            docType: doc?.docTypeName,
            cardName: doc?.cardName,
            approver: doc?.currentApprover,
            approverEmail: doc?.approverEmail,
            docDate: doc?.docDate,
          },
        });
      } catch { /* logging não pode bloquear a UX */ }

      toast.error(
        "Sua permissão para aprovar/rejeitar este documento expirou (substituição encerrada, delegação retirada ou aprovador alterado). Atualize a página e tente novamente.",
        { duration: 7000 },
      );
      setActionPhase("idle");
      return;
    }

    // Papel efetivo com o qual o usuário está agindo (para logs de sucesso).
    const actingRole = await resolveActingRole(doc, liveGrants);

    setActionPhase("sending");
    try {
      // ===== Fase 1: mutação (aprovar/rejeitar) =====
      try {
        if (internalDoc) {
          const result = action === "approve"
            ? await approveExpense(internalDoc, remarks, opts?.idempotencyKey, { skipRefresh: true })
            : await rejectExpense(internalDoc, remarks, opts?.idempotencyKey, { skipRefresh: true });
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
          const doc = approvals.find((a) => a.approvalRequestId === code);
          // Rastreabilidade de substituto no SAP: quando o usuário está aprovando
          // em nome de outro, anexamos uma nota estruturada às Remarks enviadas
          // ao SAP e também replicamos no audit log local. Assim conseguimos
          // rastrear "quem aprovou" (session.userName) e "em nome de quem"
          // mesmo após a decisão sincronizar via `approval_history`.
          const onBehalfOf = doc ? getSubstitutedOfficial(doc) : null;
          const substitutionNote = onBehalfOf
            ? `Ação executada por SUBSTITUTO (${session.userName}) em nome de ${onBehalfOf.name}${onBehalfOf.email ? ` <${onBehalfOf.email}>` : ""}.`
            : null;
          const roleNote =
            actingRole === "delegation"
              ? `Ação executada por DELEGAÇÃO (${session.userName}).`
              : actingRole === "approver" && !substitutionNote
                ? null
                : null;
          const remarksForSap = [remarks, substitutionNote, roleNote]
            .filter(Boolean)
            .join(" — ") || remarks;

          const result = await decideSapApprovalRequest(
            session as SapSession,
            code,
            action,
            remarksForSap,
            doc,
          );
          clearClientCache();
          toast.success(
            result.recoveredFromSapError
              ? (action === "approve"
                ? "Aprovação já havia sido registrada no SAP; lista atualizada."
                : "Rejeição já havia sido registrada no SAP; lista atualizada.")
              : (action === "approve" ? "Aprovação realizada com sucesso!" : "Documento rejeitado."),
          );

          // Audit log em background — não bloqueia o fechamento do modal.
          void (async () => {
            try {
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
                  substitutedForName: onBehalfOf?.name ?? null,
                  substitutedForEmail: onBehalfOf?.email ?? null,
                  actedAsSubstitute: !!onBehalfOf,
                  actingRole,
                },
              });
            } catch (auditErr) {
              console.warn("Audit log falhou (não bloqueante):", auditErr);
            }
          })();
        }
      } catch (mutationErr) {
        console.error("Approval action error:", mutationErr);
        const message = mutationErr instanceof Error ? mutationErr.message : "Erro ao processar ação";
        toast.error(message);
        throw mutationErr instanceof Error ? mutationErr : new Error(message);
      }

      // Remoção otimista: tira o documento da lista imediatamente e reescreve
      // o cache local. A UI atualiza na hora sem esperar o SAP replicar.
      if (internalDoc) {
        removeExpenseLocal(internalDoc);
      } else {
        removeApprovalLocal(code);
      }

      // Fecha o modal e libera a UI imediatamente.
      setSelectedDoc(null);
      setActionPhase("idle");

      // ===== Fase 2: reconciliação em background =====
      // Só atualiza a lista realmente afetada (interna OU SAP), com um
      // pequeno atraso para dar tempo do SAP processar a decisão. Se falhar,
      // o cache local otimista já mantém a UI consistente até o próximo ciclo.
      void (async () => {
        try {
          await new Promise((r) => setTimeout(r, 1500));
          if (internalDoc) {
            await refreshFeed();
          } else {
            // Dispara sync do histórico em paralelo — não bloqueia o refresh.
            try {
              const { sapFunctionFetch } = await import("@/lib/auth-fetch");
              void sapFunctionFetch("approval-history-sync", { method: "POST" }).catch(() => {});
            } catch { /* best-effort */ }
            await refreshCache();
          }
        } catch (refreshErr) {
          console.warn("Reconciliação em background falhou (UI já atualizada):", refreshErr);
        }
      })();
    } catch (err) {
      setActionPhase("idle");
      throw err;
    }
  };

  const handleRetryRefresh = async () => {
    const internalDoc = (selectedDoc as any)?.__internalId;
    setActionPhase("refreshing");
    try {
      if (internalDoc) {
        await refreshExpenses();
      } else {
        await refreshCache();
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
    // Qualquer aprovador responsável pelo documento pode delegar.

    setIsDelegating(true);
    try {
      const internalId = (delegationDoc as unknown as { __internalId?: string }).__internalId;
      const isInternal = !!internalId || delegationDoc.approvalRequestId <= 0;

      if (!isInternal) {
        throw new Error(
          "Aprovações do SAP não podem ser delegadas daqui — a decisão precisa ser enviada pelo próprio usuário SAP.",
        );
      }

      if (!internalId) {
        throw new Error("Documento interno sem identificador — recarregue a lista e tente novamente.");
      }

      // A atualização de `expenses.current_approver` precisa passar pela
      // edge function `expense-delegate` porque o RLS da tabela bloqueia
      // UPDATE via anon key (usuários deste app se autenticam por SAP, não
      // por auth.uid()). O servidor também grava o audit_log — sem isso a
      // delegação ficava apenas no log, sem alterar o aprovador real.
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const resp = await sapFunctionFetch("expense-delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delegate",
          expense_id: internalId,
          new_approver_email: params.userEmail,
          new_approver_name: params.userName,
          reason: params.reason,
          doc_num: delegationDoc.docNum,
          doc_type: delegationDoc.docTypeName,
          card_name: delegationDoc.cardName,
          doc_total: delegationDoc.docTotal,
          currency: delegationDoc.currency,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || `Falha ao delegar (HTTP ${resp.status})`);
      }

      toast.success(`Aprovação transferida para ${params.userName}.`);
      setDelegationDoc(null);
      setSelectedDoc(null);
      await refreshFeed();
    } catch (e) {
      console.error("Delegation error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao delegar aprovação");
    } finally {
      setIsDelegating(false);
    }
  };

  const handleBulkTransferApprovals = async (params: { user: ApprovalTransferUserOption; reason: string }) => {
    if (!session) return;
    const expenseIds = selectedTransferDocs
      .map((doc) => (doc as unknown as { __internalId?: string }).__internalId)
      .filter(Boolean) as string[];
    if (expenseIds.length === 0) {
      toast.error("Selecione pelo menos uma aprovação interna.");
      return;
    }
    setIsTransferringApprovals(true);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const resp = await sapFunctionFetch("transfer-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_db: session.companyDB,
          expense_ids: expenseIds,
          to_user_code: params.user.code,
          to_user_name: params.user.name,
          to_user_email: params.user.email || params.user.extra || null,
          reason: params.reason || "Transferência administrativa de aprovações pendentes",
          dry_run: false,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(payload?.error || `Falha ao transferir aprovações (HTTP ${resp.status})`);
      }
      const transferred = Array.isArray(payload?.transferred) ? payload.transferred.length : 0;
      const errors = Array.isArray(payload?.errors) ? payload.errors.length : 0;
      if (transferred > 0) {
        toast.success(`${transferred} aprovação(ões) transferida(s) para ${params.user.name}.`);
      } else {
        toast.info("Nenhuma aprovação foi transferida.");
      }
      if (errors > 0) {
        toast.warning(`${errors} aprovação(ões) tiveram erro na transferência.`);
      }
      setSelectedTransferIds(new Set());
      setShowTransferDialog(false);
      await refreshFeed();
    } catch (e) {
      console.error("Bulk transfer error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao transferir aprovações");
    } finally {
      setIsTransferringApprovals(false);
    }
  };

  const handleReprocessApproval = async () => {
    if (!session || !reprocessApprovalDoc || isReprocessingApproval) return;
    const expenseId = (reprocessApprovalDoc as unknown as { __internalId?: string }).__internalId;
    if (!expenseId) {
      toast.error("Documento interno sem identificador — recarregue a lista e tente novamente.");
      return;
    }

    setIsReprocessingApproval(true);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const response = await sapFunctionFetch("expense-reassign-approver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_db: session.companyDB,
          expense_ids: [expenseId],
          only_unmatched: false,
          dry_run: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Falha ao reprocessar aprovação (HTTP ${response.status})`);
      }
      const result = Array.isArray(payload?.results) ? payload.results[0] : null;
      if (result?.error) throw new Error(result.error);
      if (result?.skipped) {
        toast.warning(`A aprovação não foi alterada: ${result.skipped}.`);
      } else if (result?.finalized) {
        toast.success("Regra reavaliada. As aprovações existentes concluíram o fluxo.");
      } else {
        const preserved = Array.isArray(result?.preserved_levels)
          ? result.preserved_levels.length
          : Number(result?.preserved_levels || 0);
        toast.success(
          preserved > 0
            ? `Regra reavaliada com ${preserved} nível(is) já aprovado(s) preservado(s).`
            : "Regra reavaliada e próximo aprovador atualizado.",
        );
      }
      setReprocessApprovalDoc(null);
      setSelectedDoc(null);
      await refreshFeed();
    } catch (error) {
      console.error("Approval reprocess error:", error);
      toast.error(error instanceof Error ? error.message : "Falha ao reprocessar aprovação.");
    } finally {
      setIsReprocessingApproval(false);
    }
  };

  const handleRevokeDelegation = async (doc: ApprovalDoc) => {
    if (!session) return;
    // Qualquer aprovador do documento pode revogar a própria delegação.

    const internalId = (doc as unknown as { __internalId?: string }).__internalId;
    if (!internalId) {
      toast.error("Somente aprovações internas permitem revogar delegação.");
      return;
    }
    if (!doc.delegatedFrom) {
      toast.error("Este documento não possui delegação ativa.");
      return;
    }
    const confirmed = window.confirm(
      `Revogar delegação e devolver a aprovação para ${doc.delegatedFrom}?`,
    );
    if (!confirmed) return;
    setIsRevokingDelegation(true);
    try {
      // Igual à delegação, a revogação passa pela edge function
      // `expense-delegate` para contornar o RLS de `expenses` e gravar o
      // audit_log `revoke_delegation` no mesmo passo.
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const resp = await sapFunctionFetch("expense-delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revoke",
          expense_id: internalId,
          doc_num: doc.docNum,
          doc_type: doc.docTypeName,
          card_name: doc.cardName,
          doc_total: doc.docTotal,
          currency: doc.currency,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || `Falha ao revogar delegação (HTTP ${resp.status})`);
      }

      const restored = payload.current_approver || doc.delegatedFrom || "aprovador original";
      toast.success(`Delegação revogada. Aprovação devolvida para ${restored}.`);
      setSelectedDoc(null);
      await refreshFeed();
    } catch (e) {
      console.error("Revoke delegation error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao revogar delegação");
    } finally {
      setIsRevokingDelegation(false);
    }
  };



  const selectedInternalId = (selectedDoc as unknown as { __internalId?: string } | null)?.__internalId;
  const canActOnSelectedDoc = canApproveDocWith(selectedDoc, substituteGrants) || Boolean(isAdmin && selectedInternalId);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="p-1.5 sm:p-2 rounded-lg bg-primary/10 glow-primary shrink-0">
              <img src={cactusLogo.url} alt="Logo" className="w-4 h-4 sm:w-5 sm:h-5 object-contain" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-foreground truncate">Aprovações</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate hidden sm:block">Acompanhamento de aprovações</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">



            {lastUpdatedAt && (
              <span className="text-xs text-muted-foreground hidden md:inline">
                Cache: {new Date(lastUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button variant="ghost" size="icon" onClick={refresh} disabled={isLoading} className="text-muted-foreground hover:text-foreground h-10 w-10 sm:h-9 sm:w-9" title="Recarregar" aria-label="Recarregar">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <div className="hidden sm:flex items-center gap-2 sm:gap-4">
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSubstitutes(true)}
              className="gap-2"
              title="Definir substituto de alçada durante férias/ausências"
            >
              <UserCog className="w-4 h-4" />
              Substituto
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
                  { header: "Doc #", cell: (a: typeof filtered[number]) => docNumberLabel(a as never) },
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
            </div>
            <UserCompanyMenu />

          </div>
        </div>

      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
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
            <button
              type="button"
              onClick={() => setOnlyOverdue((v) => !v)}
              aria-pressed={onlyOverdue}
              title={onlyOverdue ? "Mostrar todas as pendentes" : "Mostrar apenas as vencidas"}
              className={`glass-card px-4 py-3 flex items-center gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                onlyOverdue
                  ? "border-destructive bg-destructive/10 ring-1 ring-destructive/40"
                  : "border-destructive/30 hover:bg-destructive/5"
              }`}
            >
              <Calendar className="w-4 h-4 text-destructive" aria-hidden="true" />
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Vencidos
                  {onlyOverdue && <X className="w-3 h-3" aria-hidden="true" />}
                </p>
                <p className="text-lg font-bold font-mono text-destructive">{overdueCount}</p>
              </div>
            </button>
          )}
          {dueWarningCount > 0 && (
            <div className="glass-card px-4 py-3 flex items-center gap-3 border-amber-500/30 bg-amber-500/5">
              <Calendar className="w-4 h-4 text-amber-500" aria-hidden="true" />
              <div>
                <p className="text-xs text-muted-foreground">Alerta de vencimento</p>
                <p className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400">{dueWarningCount}</p>
              </div>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nº ou código interno, fornecedor, aprovador, projeto..."
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
          {isAdmin && transferEligibleDocs.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  if (allTransferEligibleSelected) {
                    setSelectedTransferIds(new Set());
                  } else {
                    setSelectedTransferIds(new Set(
                      transferEligibleDocs.map((doc) => (doc as unknown as { __internalId: string }).__internalId),
                    ));
                  }
                }}
              >
                <CheckCircle2 className={`w-4 h-4 ${allTransferEligibleSelected ? "text-primary" : "text-muted-foreground"}`} />
                {allTransferEligibleSelected ? "Limpar seleção" : "Selecionar internas"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
                disabled={selectedTransferDocs.length === 0}
                onClick={() => setShowTransferDialog(true)}
                title="Transferir aprovações internas selecionadas para outro aprovador"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Transferir ({selectedTransferDocs.length})
              </Button>
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
                    originFilter !== "all",
                    !!minValue,
                    !!maxValue,
                    !!createdFrom,
                    !!createdTo,
                    !!dueFrom,
                    !!dueTo,
                    ccFilter.length > 0,
                    projectFilter.length > 0,
                  ].filter(Boolean).length;
                  return active > 0 ? (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{active}</Badge>
                  ) : null;
                })()}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[calc(100vw-2rem)] sm:w-[420px] max-w-[420px] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Filtros</p>
                {(typeFilter !== "all" || originFilter !== "all" || minValue || maxValue || createdFrom || createdTo || dueFrom || dueTo || ccFilter.length > 0 || projectFilter.length > 0) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTypeFilter("all");
                      setOriginFilter("all");
                      setMinValue("");
                      setMaxValue("");
                      setCreatedFrom("");
                      setCreatedTo("");
                      setDueFrom("");
                      setDueTo("");
                      setCcFilter([]);
                      setProjectFilter([]);
                    }}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    Limpar
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Centro de custo</Label>
                  <FilterMultiSelect
                    options={ccOptions}
                    selected={ccFilter}
                    onChange={setCcFilter}
                    placeholder="Todos os centros de custo"
                    searchPlaceholder="Buscar centro de custo..."
                    emptyText="Sem centros de custo nos documentos"
                    ariaLabel="Filtrar por centro de custo"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Projeto</Label>
                  <FilterMultiSelect
                    options={projectOptions}
                    selected={projectFilter}
                    onChange={setProjectFilter}
                    placeholder="Todos os projetos"
                    searchPlaceholder="Buscar projeto..."
                    emptyText="Sem projetos nos documentos"
                    ariaLabel="Filtrar por projeto"
                  />
                </div>
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
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Origem</Label>
                <div className="flex items-center gap-1">
                  {([
                    ["all", "Todas"],
                    ["erp", "Nº do ERP"],
                    ["internal", "Despesa interna"],
                  ] as const).map(([key, lbl]) => (
                    <button
                      key={key}
                      onClick={() => setOriginFilter(key)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        originFilter === key
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
          <div
            role="group"
            aria-label="Alternar entre visualização em cards e tabela"
            className="flex items-center border border-border rounded-lg overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              aria-pressed={viewMode === "cards"}
              aria-label="Visualizar como cards"
              title="Cards"
              className={`p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${viewMode === "cards" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              aria-pressed={viewMode === "table"}
              aria-label="Visualizar como tabela"
              title="Tabela"
              className={`p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${viewMode === "table" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">Tabela</span>
            </button>
          </div>
        </div>



        {activeOfficials.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <UserCog className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">Modo substituto ativo</p>
              <p className="text-xs mt-0.5 text-amber-700/80 dark:text-amber-300/80">
                Você pode aprovar em nome de{" "}
                <span className="font-semibold">
                  {activeOfficials.map((o) => o.official_name || o.official_email).join(", ")}
                </span>
                . Os documentos correspondentes aparecem marcados na lista.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className={`p-4 rounded-md border text-sm ${allApprovals.length > 0
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}>{error}</div>
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
            {visibleApprovals.map((doc, i) => {
              const internalId = (doc as any).__internalId as string | undefined;
              return (
                <motion.div key={doc.approvalRequestId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <ApprovalCard
                  doc={doc}
                  onOpen={() => setSelectedDoc(doc)}
                  approverCCs={getCostCentersForEmail(doc.approverEmail)}
                  formatCostCenter={formatCostCenter}
                  substituteName={displayUserName(session.userName)}
                  onBehalfOf={getSubstitutedOfficial(doc)}
                  onRelationsMap={(() => {
                    const internalId = (doc as any).__internalId as string | undefined;
                    if (!internalId) return undefined;
                    const exp = expenses.find((e) => e.id === internalId);
                    return exp ? () => setRelationsMapExpense(exp) : undefined;
                  })()}
                  selectedForTransfer={internalId ? selectedTransferIds.has(internalId) : false}
                  onToggleTransfer={isAdmin && internalId ? (checked) => {
                    setSelectedTransferIds((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(internalId);
                      else next.delete(internalId);
                      return next;
                    });
                  } : undefined}
                />

                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {isAdmin && (
                    <th className="py-3 px-3 text-left">
                      <span className="sr-only">Selecionar</span>
                    </th>
                  )}
                  {([
                    ["docTypeName", "Tipo", "left"],
                    ["docNum", "Nº Doc", "left"],
                    ["docTotal", "Valor", "right"],
                    ["cardName", "Fornecedor", "left"],
                    ["currentApprover", "Aprovador", "left"],
                    ["requester", "Solicitante", "left"],
                    ["dueDate", "Vencimento", "left"],
                  ] as [SortKey, string, "left" | "right"][]).map(([key, label, align]) => {
                    const isActive = sortKey === key;
                    return (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                        className={`py-1 px-1 text-xs font-medium text-muted-foreground uppercase tracking-wider ${align === "right" ? "text-right" : "text-left"}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          title={`Ordenar por ${label}`}
                          className={`inline-flex items-center gap-1 rounded px-2 py-2 uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${isActive ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
                        >
                          {label}
                          {isActive ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="w-3 h-3" aria-hidden="true" />
                            ) : (
                              <ArrowDown className="w-3 h-3" aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" aria-hidden="true" />
                          )}
                        </button>
                      </th>
                    );
                  })}
                  <th className="text-center py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleApprovals.map((doc, i) => {
                  const dueStatus = getDueStatus(doc.dueDate);
                  const overdue = dueStatus === "overdue";
                  const dueWarning = dueStatus === "warning";
                  const internalId = (doc as any).__internalId as string | undefined;
                  const linkedExpense = internalId ? expenses.find((e) => e.id === internalId) : undefined;
                  const onBehalfOf = getSubstitutedOfficial(doc);
                  return (
                    <motion.tr
                      key={doc.approvalRequestId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${
                        overdue ? "bg-destructive/5" : dueWarning ? "bg-amber-500/5" : ""
                      }`}
                      onClick={() => setSelectedDoc(doc)}
                    >
                      {isAdmin && (
                        <td className="py-3 px-3" onClick={(ev) => ev.stopPropagation()}>
                          {internalId ? (
                            <Checkbox
                              checked={selectedTransferIds.has(internalId)}
                              onCheckedChange={(v) => {
                                setSelectedTransferIds((prev) => {
                                  const next = new Set(prev);
                                  if (v === true) next.add(internalId);
                                  else next.delete(internalId);
                                  return next;
                                });
                              }}
                              aria-label={`Selecionar ${docNumberLabel(doc)} para transferência`}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      <td className="py-3 px-3">
                        <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">{doc.docTypeName}</span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-foreground font-semibold">{docNumberLabel(doc)}</td>
                      <td className="py-3 px-3 text-right font-mono text-foreground font-medium">{formatCurrency(doc.docTotal, doc.currency)}</td>
                      <td className="py-3 px-3 text-foreground">{doc.cardName}</td>
                      <td className="py-3 px-3 text-foreground font-medium">
                        <div className="flex flex-col gap-1">
                          <span>{doc.currentApprover}</span>
                          {onBehalfOf && (
                            <span
                              className="inline-flex items-center gap-1 self-start text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5"
                              title={`Você está aprovando como substituto de ${onBehalfOf.name}`}
                            >
                              <UserCog className="w-3 h-3" aria-hidden="true" />
                              em nome de {onBehalfOf.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">{doc.requester}</td>
                      <td className={`py-3 px-3 font-mono text-xs ${
                        overdue
                          ? "text-destructive font-semibold"
                          : dueWarning
                            ? "text-amber-600 dark:text-amber-400 font-semibold"
                            : "text-muted-foreground"
                      }`}>
                        {formatDate(doc.dueDate)}
                        {(overdue || dueWarning) && <span className="ml-1 text-[10px]">⚠</span>}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-primary hover:text-primary/80"
                            title="Ver detalhes"
                            onClick={(ev) => { ev.stopPropagation(); setSelectedDoc(doc); }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {linkedExpense && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              title="Mapa de relações"
                              onClick={(ev) => { ev.stopPropagation(); setRelationsMapExpense(linkedExpense); }}
                            >
                              <Network className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {apprHasMore ? (
          <div ref={apprSentinelRef} className="flex flex-col items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>Carregando mais… ({visibleApprovals.length} de {apprTotal})</span>
            <Button variant="ghost" size="sm" onClick={apprLoadMore}>Mostrar mais</Button>
          </div>
        ) : apprTotal > apprInitial ? (
          <div className="text-center py-4 text-xs text-muted-foreground">{apprTotal} pedido(s) exibidos</div>
        ) : null}
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
        onReprocessApproval={(d) => setReprocessApprovalDoc(d)}
        onRevokeDelegation={handleRevokeDelegation}
        isReprocessingApproval={isReprocessingApproval}
        isRevokingDelegation={isRevokingDelegation}
        isActioning={isActioning}
        actionPhase={actionPhase}
        isSuperUser={isSuperUser}
        currentUserName={session.userName}
        currentUserEmail={authEmail || session.userName}
        approverCCs={getCostCentersForEmail(selectedDoc?.approverEmail || "")}
        formatCostCenter={formatCostCenter}
        rules={rules}
        isAdmin={isAdmin}
        onBehalfOf={selectedDoc ? getSubstitutedOfficial(selectedDoc) : null}
        canApprove={canActOnSelectedDoc}
      />


      <RelationsMap
        open={!!relationsMapExpense}
        onClose={() => setRelationsMapExpense(null)}
        expense={relationsMapExpense as any}
        title="Mapa de Relações"
      />

      {delegationDoc ? (
        <DelegationDialog
          open
          onClose={() => setDelegationDoc(null)}
          doc={delegationDoc}
          onConfirm={handleDelegate}
          isSubmitting={isDelegating}
        />
      ) : null}

      <TransferApprovalsDialog
        open={showTransferDialog}
        onClose={() => setShowTransferDialog(false)}
        docs={selectedTransferDocs}
        userOptions={transferUserOptions}
        usersLoading={transferUsersLoading}
        pendingCounts={transferPendingCounts}
        onConfirm={handleBulkTransferApprovals}
        isSubmitting={isTransferringApprovals}
      />

      <AlertDialog
        open={!!reprocessApprovalDoc}
        onOpenChange={(open) => {
          if (!open && !isReprocessingApproval) setReprocessApprovalDoc(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reprocessar aprovação?</AlertDialogTitle>
            <AlertDialogDescription>
              A matriz atual será reavaliada para este documento. Aprovações já realizadas por pessoas que continuam na nova regra serão mantidas, sem solicitar uma nova decisão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReprocessingApproval}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isReprocessingApproval}
              onClick={(event) => {
                event.preventDefault();
                void handleReprocessApproval();
              }}
              className="gap-1.5"
            >
              {isReprocessingApproval
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              Reprocessar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showSubstitutes} onOpenChange={(o) => {
        setShowSubstitutes(o);
        if (!o) refreshSubstituteGrants();
      }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delegação temporária de alçada</DialogTitle>
          </DialogHeader>
          <SubstituteApproversTab isAdmin={isAdmin} />
        </DialogContent>
      </Dialog>

    </div>
  );
}
