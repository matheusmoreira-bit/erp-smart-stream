import { useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useApprovals, type ApprovalDoc, type DocumentLine } from "@/hooks/useApprovals";
import { useExpenses } from "@/hooks/useExpenses";
import { useNavigate } from "react-router-dom";
import { Activity, LogOut, Eye, CheckCircle, XCircle, Paperclip, X } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { sapAction, clearClientCache } from "@/lib/sap-client";
import { toast } from "sonner";
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

function formatCurrency(value: number, currency: string = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
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

function ApprovalCard({ doc, onOpen }: { doc: ApprovalDoc; onOpen: () => void }) {
  const overdue = isOverdue(doc.dueDate);

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
        <div className="text-right">
          <p className="text-lg font-bold text-foreground font-mono">{formatCurrency(doc.docTotal, doc.currency)}</p>
          {overdue && (
            <span className="text-[10px] font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded-full uppercase">
              Vencido
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="w-3.5 h-3.5 text-primary/70" />
          <span className="truncate">{doc.cardName}</span>
        </div>
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
      </div>
    </motion.div>
  );
}

function ApprovalDetailModal({
  doc,
  open,
  onClose,
  onAction,
  isActioning,
  isSuperUser,
  currentUserName,
}: {
  doc: ApprovalDoc | null;
  open: boolean;
  onClose: () => void;
  onAction: (code: number, action: "approve" | "reject", remarks: string) => Promise<void>;
  isActioning: boolean;
  isSuperUser: boolean;
  currentUserName: string;
}) {
  const [remarks, setRemarks] = useState("");
  const [riskConfirm, setRiskConfirm] = useState<{ action: "approve" | "reject" } | null>(null);

  if (!doc) return null;

  const overdue = isOverdue(doc.dueDate);
  const isOtherApprover = isSuperUser && doc.currentApprover.toLowerCase() !== currentUserName.toLowerCase();

  const handleAction = (action: "approve" | "reject") => {
    if (isOtherApprover) {
      setRiskConfirm({ action });
    } else {
      onAction(doc.approvalRequestId, action, remarks);
    }
  };

  const confirmRiskAction = () => {
    if (riskConfirm && doc) {
      onAction(doc.approvalRequestId, riskConfirm.action, remarks);
      setRiskConfirm(null);
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
                <p className={overdue ? "text-destructive font-semibold" : "text-foreground"}>
                  {formatDate(doc.dueDate)}
                  {overdue && " ⚠ Vencido"}
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

            {/* Document Lines */}
            {doc.documentLines.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Itens do Documento</p>
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
                      {doc.documentLines.map((line, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-2 px-3 font-mono text-muted-foreground">{line.ItemCode}</td>
                          <td className="py-2 px-3 text-foreground">{line.Description}</td>
                          <td className="py-2 px-3 text-right font-mono">{line.Quantity}</td>
                          <td className="py-2 px-3 text-right font-mono">{formatCurrency(line.UnitPrice)}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium">{formatCurrency(line.LineTotal)}</td>
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
                  {doc.attachmentNames.split("|").map((name, i) => (
                    <p key={i} className="text-xs text-muted-foreground bg-muted/20 px-3 py-1.5 rounded">
                      {name.trim()}
                    </p>
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
              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isActioning}
                >
                  Cancelar
                </Button>
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
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Risk confirmation dialog for super-user acting on another's document */}
      <AlertDialog open={!!riskConfirm} onOpenChange={(v) => { if (!v) setRiskConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              Ação em documento de outro aprovador
            </AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a <strong>{riskConfirm?.action === "approve" ? "aprovar" : "rejeitar"}</strong> o documento <strong>#{doc?.docNum}</strong> que está atribuído ao aprovador <strong>{doc?.currentApprover}</strong>.
              <br /><br />
              Esta ação será registrada como realizada por super-usuário. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRiskAction}
              className={riskConfirm?.action === "reject" ? "bg-destructive hover:bg-destructive/90" : "bg-emerald-600 hover:bg-emerald-700"}
            >
              Sim, {riskConfirm?.action === "approve" ? "aprovar" : "rejeitar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function ApprovalsPage() {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const { approvals, isLoading, error, refresh } = useApprovals();
  const { getLabel } = useCompanies(true);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<ApprovalDoc | null>(null);
  const [isActioning, setIsActioning] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Redirect to login if no session
  if (!session) {
    navigate("/");
    return null;
  }

  const isSuperUser = session.isSuperUser;
  const companyLabel = getLabel(session?.companyDB || "");

  // Filter: non-super-users see only their own approvals; super-users can toggle
  const userApprovals = (!isSuperUser || !showAll)
    ? approvals.filter((a) => a.currentApprover.toLowerCase() === session.userName.toLowerCase())
    : approvals;

  const filtered = userApprovals.filter((a) => {
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

  const handleApprovalAction = async (code: number, action: "approve" | "reject", remarks: string) => {
    if (!session) return;
    setIsActioning(true);
    try {
      // Internal expense doc has negative approvalRequestId and __internalId
      const internalDoc = (selectedDoc as any)?.__internalId;
      if (internalDoc) {
        if (action === "approve") {
          await approveExpense(internalDoc, remarks);
          toast.success("Despesa interna aprovada!");
        } else {
          await rejectExpense(internalDoc, remarks);
          toast.success("Despesa interna rejeitada.");
        }
        setSelectedDoc(null);
        refreshExpenses();
        return;
      }

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

      setSelectedDoc(null);
      refresh();
    } catch (e) {
      console.error("Approval action error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao processar ação");
    } finally {
      setIsActioning(false);
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
              <h1 className="text-xl font-bold text-foreground">SAP B1 <span className="text-gradient">Analytics</span></h1>
              <p className="text-xs text-muted-foreground">Acompanhamento de Aprovações</p>
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
            <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
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
          {isSuperUser && (
            <div className="flex items-center gap-2 glass-card px-3 py-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <Label htmlFor="show-all" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                Ver todas as aprovações
              </Label>
              <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
            </div>
          )}
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
                <ApprovalCard doc={doc} onOpen={() => setSelectedDoc(doc)} />
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
      </main>

      <ApprovalDetailModal
        doc={selectedDoc}
        open={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        onAction={handleApprovalAction}
        isActioning={isActioning}
        isSuperUser={isSuperUser}
        currentUserName={session.userName}
      />
    </div>
  );
}
