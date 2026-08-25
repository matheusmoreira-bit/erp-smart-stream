import { useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Check,
  X,
  Paperclip,
  RefreshCw,
  Loader2,
  ChevronLeft,
  Search,
  FileText,
  ScanLine,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

import { useSap } from "@/contexts/SapContext";
import { useExpenses, useStatusLabel, type Expense } from "@/hooks/useExpenses";
import { isDesignatedApprover, isPendingApproval } from "@/lib/approval-authz";
import { isSameAsRequester } from "@/lib/self-approval";

/**
 * Tela mobile-first de aprovações (destino do PWA instalável).
 * Foco em três ações: aprovar, consultar status e anexar comprovantes.
 * A autorização real continua no edge function `expense-approval-action`;
 * aqui o filtro é apenas de visualização.
 */

const brl = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(
    Number(value || 0),
  );

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("pt-BR") : "—";
};

type ViewTab = "pending" | "status";

export default function MobileApprovals() {
  const { session } = useSap();
  const statusLabel = useStatusLabel();
  const navigate = useNavigate();
  const {
    expenses,
    isLoading,
    refresh,
    approveExpense,
    rejectExpense,
    addAttachments,
  } = useExpenses("purchase");

  const [tab, setTab] = useState<ViewTab>("pending");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ expense: Expense; action: "approve" | "reject" } | null>(
    null,
  );
  const [remarks, setRemarks] = useState("");
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const caller = session?.userName || "";

  const myPending = useMemo(
    () =>
      expenses.filter(
        (e) =>
          isPendingApproval(e.status) &&
          isDesignatedApprover(caller, e.current_approver || null, (e as any).current_approver_email || null) &&
          // Auto-aprovação: o solicitante nunca aprova o próprio documento.
          !isSameAsRequester(e.requester_name || null, e.requester_email || null, caller, caller),
      ),
    [expenses, caller],
  );

  const myDocuments = useMemo(
    () =>
      expenses.filter(
        (e) =>
          isDesignatedApprover(caller, e.requester_name || null, e.requester_email || null) ||
          isDesignatedApprover(caller, e.current_approver || null, null),
      ),
    [expenses, caller],
  );

  const list = useMemo(() => {
    const base = tab === "pending" ? myPending : myDocuments;
    const term = search.trim().toLowerCase();
    const filtered = term
      ? base.filter((e) =>
          [e.supplier_name, e.requester_name, e.cost_center, e.project, String(e.sap_doc_num ?? "")]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term)),
        )
      : base;
    return [...filtered].sort(
      (a, b) =>
        new Date(a.due_date || a.created_at).getTime() - new Date(b.due_date || b.created_at).getTime(),
    );
  }, [tab, myPending, myDocuments, search]);

  if (!session) return <Navigate to="/" replace />;

  const confirmDecision = async () => {
    if (!decision) return;
    const { expense, action } = decision;
    setBusyId(expense.id);
    try {
      if (action === "approve") {
        await approveExpense(expense.id, remarks || undefined, crypto.randomUUID());
        toast.success("Documento aprovado");
      } else {
        if (!remarks.trim()) {
          toast.error("Informe o motivo da reprovação");
          setBusyId(null);
          return;
        }
        await rejectExpense(expense.id, remarks, crypto.randomUUID());
        toast.success("Documento reprovado");
      }
      setDecision(null);
      setRemarks("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao registrar a decisão");
    } finally {
      setBusyId(null);
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length || !uploadTarget) return;
    setBusyId(uploadTarget);
    try {
      await addAttachments(uploadTarget, Array.from(files));
      toast.success("Comprovante anexado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao anexar");
    } finally {
      setBusyId(null);
      setUploadTarget(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="min-h-screen bg-background pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex items-center gap-2 px-3 py-3">
          <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">Aprovações</h1>
            <p className="truncate text-xs text-muted-foreground">
              {session.userName} · {session.companyDB}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Capturar nota por foto"
            onClick={() => navigate("/captura/nota")}
          >
            <ScanLine className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Atualizar"
            onClick={() => refresh()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-5 w-5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="px-3 pb-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as ViewTab)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pending">Pendentes ({myPending.length})</TabsTrigger>
              <TabsTrigger value="status">Status</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              inputMode="search"
              placeholder="Buscar fornecedor, CC, projeto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar documentos"
            />
          </div>
        </div>
      </header>

      <main className="space-y-3 px-3 py-4">
        {isLoading && list.length === 0 ? (
          <>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <FileText className="h-10 w-10 opacity-50" />
            <p className="text-sm">
              {tab === "pending"
                ? "Nenhuma aprovação pendente para você."
                : "Nenhum documento encontrado."}
            </p>
          </div>
        ) : (
          list.map((exp) => (
            <Card key={exp.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{exp.supplier_name || "Sem fornecedor"}</p>
                  <p className="text-xs text-muted-foreground">
                    Solicitante: {exp.requester_name || "—"}
                  </p>
                </div>
                <Badge variant={isPendingApproval(exp.status) ? "default" : "secondary"}>
                  {statusLabel(exp.status)}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Valor:{" "}
                  <strong className="text-foreground">
                    {brl(exp.total_amount, exp.currency)}
                  </strong>
                </span>
                <span>Vencimento: {formatDate(exp.due_date)}</span>
                <span className="truncate">CC: {exp.cost_center || "—"}</span>
                <span className="truncate">Projeto: {exp.project || "—"}</span>
                {exp.sap_doc_num ? <span>SAP: {exp.sap_doc_num}</span> : null}
                <span>Anexos: {exp.attachments?.length ?? 0}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {isPendingApproval(exp.status) && tab === "pending" && (
                  <>
                    <Button
                      className="flex-1"
                      size="sm"
                      disabled={busyId === exp.id}
                      onClick={() => {
                        setRemarks("");
                        setDecision({ expense: exp, action: "approve" });
                      }}
                    >
                      {busyId === exp.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-4 w-4" />
                      )}
                      Aprovar
                    </Button>
                    <Button
                      className="flex-1"
                      size="sm"
                      variant="destructive"
                      disabled={busyId === exp.id}
                      onClick={() => {
                        setRemarks("");
                        setDecision({ expense: exp, action: "reject" });
                      }}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Reprovar
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === exp.id}
                  onClick={() => {
                    setUploadTarget(exp.id);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip className="mr-1 h-4 w-4" />
                  Comprovante
                </Button>
              </div>
            </Card>
          ))
        )}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />

      <Dialog open={!!decision} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decision?.action === "approve" ? "Confirmar aprovação" : "Confirmar reprovação"}
            </DialogTitle>
          </DialogHeader>
          {decision && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">{decision.expense.supplier_name}</p>
              <p className="text-muted-foreground">
                {brl(decision.expense.total_amount, decision.expense.currency)} ·{" "}
                {decision.expense.cost_center || "sem CC"}
              </p>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={
                  decision.action === "approve"
                    ? "Observação (opcional)"
                    : "Motivo da reprovação (obrigatório)"
                }
                rows={3}
              />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDecision(null)}>
              Cancelar
            </Button>
            <Button
              variant={decision?.action === "reject" ? "destructive" : "default"}
              onClick={confirmDecision}
              disabled={!!busyId}
            >
              {busyId ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
