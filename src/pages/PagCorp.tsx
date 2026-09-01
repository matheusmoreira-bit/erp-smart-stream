import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { UserCompanyMenu } from "@/components/UserCompanyMenu";
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
  Paperclip,
  FileText,
  ShieldOff,
  CheckCircle,
  Network,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
import { normalizeTaxKey, formatTaxId } from "@/lib/tax-id";

import { useCredentials } from "@/hooks/useCredentials";
import { toast } from "sonner";
import { useCompanies } from "@/hooks/useCompanies";
import { PagCorpIntegrateDialog } from "@/components/PagCorpIntegrateDialog";
import { PagCorpConsolidateDialog } from "@/components/PagCorpConsolidateDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PagCorpPresentationDialog } from "@/components/PagCorpPresentationDialog";
import { SapValidationDialog } from "@/components/SapValidationDialog";
import { RelationsMap, type RelationsMapExpense } from "@/components/RelationsMap";
import { CreateExpenseModal } from "@/components/CreateExpenseModal";
import { useExpenses } from "@/hooks/useExpenses";
import { supabase } from "@/integrations/supabase/client";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { generatePagCorpPresentation, type PresentationPeriod } from "@/lib/pagcorp-presentation";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { PageTitle } from "@/components/PageTitle";
import { isPagCorpAiEligible } from "@/lib/pagcorp-document-classification";

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
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
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

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return formatDate(dateStr);
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function transactionText(t: PagCorpTransaction, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = t[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function DetailValue({ label, value, wide = false }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground whitespace-pre-wrap break-words">{value || "—"}</dd>
    </div>
  );
}

function PagCorpTransactionDetails({
  transaction: t,
  onOpenAttachments,
}: {
  transaction: PagCorpTransaction;
  onOpenAttachments: (transaction: PagCorpTransaction) => void;
}) {
  const receiptCount = (t.receipts?.length || 0) + (t.attachments?.length || 0);
  const holder = transactionText(t, "employeeName", "userName", "holderName", "cardholderName")
    || t.cardName
    || t.accountAlias
    || t.accountName
    || null;
  const accountabilityStatus = t.accountabilityStatus
    || (t.accountabilityApproved ? "Aprovada" : t.hasAccountability ? "Em análise" : "Pendente");
  const sapDocuments = t.integrationLinks?.length
    ? t.integrationLinks.map((link) => `PC #${link.docNum ?? link.docEntry ?? "—"}`).join(", ")
    : t.sapDocNum != null || t.sapDocEntry != null
      ? `${t.postingType === "journal_entry" ? "LCM" : "PC"} #${t.sapDocNum ?? t.sapDocEntry}`
      : null;

  return (
    <div className="grid gap-6 py-2 lg:grid-cols-3 lg:divide-x lg:divide-border">
      <section className="space-y-3 lg:pr-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CreditCard className="h-4 w-4 text-primary" />
          Transação
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <DetailValue label="ID PagCorp" value={String(t.id)} />
          <DetailValue label="Data da transação" value={formatDateTime(t.date)} />
          <DetailValue label="Classificação" value={t.eventClassification || null} />
          <DetailValue label="Status da transação" value={t.status || null} />
          <DetailValue label="Portador" value={holder} wide />
          <DetailValue
            label="Cartão"
            value={t.cardLastDigits ? `Final ${t.cardLastDigits}` : t.cardId ? `ID ${t.cardId}` : null}
          />
          <DetailValue label="Conta" value={t.accountCode || null} />
          <DetailValue label="Descrição" value={t.description} wide />
          <DetailValue
            label="Estabelecimento"
            value={[t.merchantName, t.merchantTaxId ? formatTaxId(t.merchantTaxId) : null].filter(Boolean).join(" · ") || null}
            wide
          />
        </dl>
      </section>

      <section className="space-y-3 lg:px-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" />
          Prestação de contas
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <DetailValue label="Status" value={accountabilityStatus} />
          <DetailValue label="ID da prestação" value={t.accountabilityId != null ? String(t.accountabilityId) : null} />
          <DetailValue label="Data da prestação" value={formatDateTime(t.accountabilityDate)} />
          <DetailValue label="Anexos" value={receiptCount > 0 ? String(receiptCount) : "Nenhum"} />
          <DetailValue label="Descrição da prestação" value={t.accountabilityDescription} wide />
          {receiptCount > 0 && (
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                onClick={() => onOpenAttachments(t)}
              >
                <Paperclip className="h-3.5 w-3.5" />
                Abrir anexos
              </Button>
            </div>
          )}
        </dl>
      </section>

      <section className="space-y-3 lg:pl-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Aprovação e integração
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <DetailValue label="Data da aprovação" value={formatDateTime(t.accountabilityApprovedAt)} />
          <DetailValue label="Aprovador" value={t.accountabilityApproverName} />
          <DetailValue
            label="Integração"
            value={t.integrated ? "Integrada ao ERP" : t.isReversed ? "Estornada" : "Não integrada"}
          />
          <DetailValue label="Tipo de lançamento" value={t.postingType === "journal_entry" ? "Lançamento contábil" : t.integrated ? "Pedido de compra" : null} />
          <DetailValue label="Documentos ERP" value={sapDocuments} wide />
          <DetailValue
            label="Baixa"
            value={t.paymentFoundInSap || t.settlementStatus === "settled"
              ? `Concluída${t.settlementPaymentDocNum ? ` #${t.settlementPaymentDocNum}` : ""}`
              : t.nfFoundInSap ? "Aguardando baixa" : null}
            wide
          />
        </dl>
      </section>
    </div>
  );
}
// Traduz uma transação PagCorp para o formato consumido pelo `RelationsMap`.
// Fluxo esperado nas etapas do mapa:
//   rascunho          → transação PagCorp existe
//   pendente_aprovacao → prestação de contas enviada (em análise)
//   aprovado          → prestação de contas aprovada
//   pc_lancado        → PC criado no SAP (t.integrated)
//   nf_entrada        → NF de entrada vinculada (derivada pelo próprio mapa)
//   pagamento         → VendorPayment emitido (settlementStatus === 'settled')
function buildRelationsExpense(
  t: PagCorpTransaction | null,
  companyDb: string | null | undefined,
): RelationsMapExpense | null {
  if (!t) return null;
  let status: string = "rascunho";
  if (t.settlementStatus === "settled") status = "finalizado";
  else if (t.integrated && t.sapDocEntry != null) status = "pc_lancado";
  else if (t.hasAccountability && t.accountabilityApproved) status = "aprovado";
  else if (t.hasAccountability) status = "pendente_aprovacao";
  return {
    id: `pagcorp:${t.id}`,
    status,
    company_db: companyDb ?? null,
    sap_doc_entry: (t.sapDocEntry as number | null) ?? null,
    sap_doc_num: (t.sapDocNum as number | null) ?? null,
    total_amount: Number(t.amount) || 0,
    currency: t.currency ?? null,
    supplier_name: (t.cardName as string) || (t.accountName as string) || "PagCorp",
    supplier_code: (t.accountCode as string) || null,
    requester_name: ((t as any).employeeName as string) || ((t as any).userName as string) || null,
    requester_email: ((t as any).employeeEmail as string) || ((t as any).userEmail as string) || null,
    created_at: t.date || undefined,
  };
}


export default function PagCorp() {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { transactions, isLoading, error, fetchTransactions, integrateDirect, integrateJournalBatch, integrateConsolidated, classifyDocuments } = usePagCorp();
  const { createExpense } = useExpenses();
  const { fetchCredentials } = useCredentials();
  const { getLabel } = useCompanies(true);

  useEffect(() => {
    if (!session?.companyDB) return;
    fetchCredentials(session.companyDB, "sap");
  }, [fetchCredentials, session?.companyDB]);



  /**
   * A integração PagCorp → SAP é feita 100% no servidor (`pagcorp-to-sap`),
   * que faz o /Login com as CREDENCIAIS DE SERVIÇO da empresa
   * (system_credentials: username/password). Portanto não exigimos mais
   * sessão/senha do usuário aqui — apenas a empresa selecionada.
   */
  const checkSapCredentials = async (): Promise<boolean> => {
    const db = session?.companyDB || "";
    if (!db) {
      toast.error("Selecione uma empresa para integrar");
      return false;
    }
    return true;
  };



  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "review" | "done">("all");
  const [settlementFilter, setSettlementFilter] = useState<"all" | "not_integrated" | "integrated_pending" | "settled">("all");
  const [cardFilter, setCardFilter] = useState<string>("all");
  const [reprocessingGroup, setReprocessingGroup] = useState<string | null>(null);
  const [batchReprocessing, setBatchReprocessing] = useState(false);
  const [validateDialog, setValidateDialog] = useState<{ open: boolean; tx: PagCorpTransaction | null }>({ open: false, tx: null });
  const [relationsDialog, setRelationsDialog] = useState<{ open: boolean; tx: PagCorpTransaction | null }>({ open: false, tx: null });
  const [integrateDialog, setIntegrateDialog] = useState<{
    open: boolean;
    tx: PagCorpTransaction | null;
    transactions: PagCorpTransaction[];
    type: "generic" | "accountability";
    postingType: "purchase_order" | "journal_entry";
  }>({ open: false, tx: null, transactions: [], type: "generic", postingType: "purchase_order" });
  const [accountabilityModal, setAccountabilityModal] = useState<{
    open: boolean;
    tx: PagCorpTransaction | null;
  }>({ open: false, tx: null });
  const [integrating, setIntegrating] = useState<string | number | null>(null);
  const [settling, setSettling] = useState<string | number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [batchQueue, setBatchQueue] = useState<PagCorpTransaction[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchActive, setBatchActive] = useState(false);
  const [consolidateDialog, setConsolidateDialog] = useState<{
    open: boolean;
    transactions: PagCorpTransaction[];
  }>({ open: false, transactions: [] });
  const [dateConflictDialog, setDateConflictDialog] = useState<{
    open: boolean;
    oldest: string;
    kept: number;
    dropped: number;
    filtered: PagCorpTransaction[];
  }>({ open: false, oldest: "", kept: 0, dropped: 0, filtered: [] });
  const [presentationDialogOpen, setPresentationDialogOpen] = useState(false);
  const [showNondeductible, setShowNondeductible] = useState(false);
  const [integratingNondeductible, setIntegratingNondeductible] = useState(false);
  // Grupos de PCs consolidados (várias transações → um único PC no SAP)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(new Set());
  const toggleTransaction = (id: string | number) =>
    setExpandedTransactions((prev) => {
      const key = String(id);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // True when modal close is programmatic (after success), so we don't cancel the batch
  const programmaticCloseRef = useRef(false);
  const classificationInflightRef = useRef(new Set<string | number>());
  const [reanalyzingIds, setReanalyzingIds] = useState<Set<string | number>>(new Set());
  // Monitor da fila de leitura por IA
  const [aiQueueRunning, setAiQueueRunning] = useState(0);
  const [aiQueuePaused, setAiQueuePaused] = useState(false);


  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    // Períodos maiores que um mês são permitidos: a busca é feita em janelas
    // de 30 dias encadeadas. Só garantimos que início <= fim.
    if (value && endDate) {
      if (new Date(value).getTime() > new Date(endDate).getTime()) {
        setEndDate(value);
      }
    }
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    if (value && startDate) {
      if (new Date(value).getTime() < new Date(startDate).getTime()) {
        setStartDate(value);
      }
    }
  };

  useEffect(() => {
    if (!session?.companyDB) return;
    fetchTransactions(startDate, endDate, session.companyDB);
  }, [fetchTransactions, session?.companyDB]);

  useEffect(() => {
    const companyDb = session?.companyDB;
    if (!companyDb || aiQueuePaused) return;
    const pending = transactions.filter((transaction) =>
      isPagCorpAiEligible(transaction) &&
      (!transaction.documentAnalysisStatus || transaction.documentAnalysisStatus === "pending") &&
      ((transaction.receipts?.length || 0) > 0 || (transaction.attachments?.length || 0) > 0) &&
      !classificationInflightRef.current.has(transaction.id)
    );
    const availableSlots = Math.max(0, 3 - classificationInflightRef.current.size);
    for (const transaction of pending.slice(0, availableSlots)) {
      classificationInflightRef.current.add(transaction.id);
      setAiQueueRunning(classificationInflightRef.current.size);
      void classifyDocuments(transaction, companyDb).finally(() => {
        classificationInflightRef.current.delete(transaction.id);
        setAiQueueRunning(classificationInflightRef.current.size);
      });
    }
  }, [classifyDocuments, session?.companyDB, transactions, aiQueuePaused]);



  const handleRefresh = () => fetchTransactions(startDate, endDate, session?.companyDB);

  /**
   * Reprocessa a leitura de anexos por IA de UMA transação.
   * Não descarta o que já foi classificado: se o reprocessamento falhar, a
   * classificação anterior (se houver) é mantida em tela e no banco.
   */
  const handleReanalyze = async (t: PagCorpTransaction) => {
    const companyDb = session?.companyDB;
    if (!companyDb || reanalyzingIds.has(t.id)) return;
    setReanalyzingIds((prev) => new Set(prev).add(t.id));
    try {
      const result = await classifyDocuments(t, companyDb, { force: true });
      if (result.status === "completed" && !result.errorMessage) {
        toast.success("Leitura da IA concluída", {
          description: result.hasFiscalDocument
            ? "Documento fiscal identificado — sugerido Pedido de Compra."
            : "Sem documento fiscal — sugerido Lançamento Contábil (LCM).",
        });
      } else if (result.errorMessage && result.status === "completed") {
        toast.warning("Reprocessamento falhou — leitura anterior mantida", {
          description: result.errorMessage,
        });
      } else {
        toast.error("Não foi possível ler os anexos com a IA", {
          description: result.errorMessage || "Tente novamente ou siga com o lançamento manual.",
        });
      }
    } finally {
      setReanalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(t.id);
        return next;
      });
    }
  };


  // Dispara a baixa automática (Pagamento de Fornecedor no SAP) para uma
  // transação já integrada. O watcher só emite baixa se o PC já estiver
  // fechado (indicando NF de entrada lançada); do contrário retorna
  // awaiting_invoice e o cron continua tentando periodicamente.
  const handleAutoSettle = async (t: PagCorpTransaction) => {
    if (!t.integrationLogId) {
      toast.error("Log de integração não localizado para esta transação.");
      return;
    }
    setSettling(t.id);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const resp = await sapFunctionFetch("pagcorp-settlement-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: t.integrationLogId, forceRetry: true }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
      const result = Array.isArray(data?.results) ? data.results[0] : null;
      const status = result?.status;
      if (status === "settled") {
        toast.success("Baixa automática emitida no SAP.");
      } else if (status === "awaiting_invoice") {
        toast.info("Ainda aguardando NF de entrada lançar o PC no SAP.");
      } else if (status === "awaiting_settlement") {
        toast.warning(result?.error === "ptax_missing"
          ? "PTAX ainda não publicada — nova tentativa após a publicação do BCB."
          : "Sem conta contábil de baixa cadastrada para a classificação do evento desta transação.");
      } else if (status === "error") {
        toast.error(`Falha na baixa: ${result?.error || "erro desconhecido"}`);
      } else if (data?.skipped) {
        toast.info("Já existe uma baixa em andamento para esta transação.");
      } else {
        toast.message("Baixa automática enfileirada.");
      }
      await fetchTransactions(startDate, endDate, session?.companyDB);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao acionar baixa automática.");
    } finally {
      setSettling(null);
    }
  };

  // Reprocessa a baixa de um grupo consolidado (todas as transações compartilham
  // o mesmo integrationLogId → uma única chamada ao watcher cobre o grupo inteiro).
  const handleReprocessGroup = async (groupKey: string, txs: PagCorpTransaction[]) => {
    const logId = txs.find((t) => t.integrationLogId)?.integrationLogId;
    if (!logId) {
      toast.error("Log de integração não localizado para este grupo.");
      return;
    }
    setReprocessingGroup(groupKey);
    try {
      const resp = await sapFunctionFetch("pagcorp-settlement-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId, forceRetry: true }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
      const result = Array.isArray(data?.results) ? data.results[0] : null;
      const status = result?.status;
      if (status === "settled") {
        toast.success(`Baixa emitida no SAP (${txs.length} transações).`);
      } else if (status === "awaiting_invoice") {
        toast.info("Aguardando NF de entrada lançar o PC no SAP.");
      } else if (status === "awaiting_settlement") {
        toast.warning(result?.error === "ptax_missing"
          ? "PTAX ainda não publicada — nova tentativa após a publicação do BCB."
          : "Sem conta contábil de baixa cadastrada para a classificação do evento.");
      } else if (status === "error") {
        toast.error(`Falha na baixa: ${result?.error || "erro desconhecido"}`);
      } else if (data?.skipped) {
        toast.info("Já existe uma baixa em andamento para este grupo.");
      } else {
        toast.message("Baixa enfileirada para reprocessamento.");
      }
      await fetchTransactions(startDate, endDate, session?.companyDB);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reprocessar baixa.");
    } finally {
      setReprocessingGroup(null);
    }
  };

  // Reprocessa a baixa em lote para todas as transações filtradas que já tenham
  // a NF de entrada lançada (settlementStatus = 'awaiting_settlement') ou que
  // estejam em 'error' retentável. Cada integrationLogId gera 1 chamada ao
  // watcher (o watcher já cobre todas as linhas daquele PC).
  const handleBatchReprocessSettlement = async () => {
    const eligible = filteredTransactions.filter(
      (t) =>
        t.integrationLogId &&
        t.settlementStatus &&
        t.settlementStatus !== "settled" &&
        (t.settlementStatus === "awaiting_settlement" || t.settlementStatus === "error"),
    );
    const uniqueLogIds = Array.from(
      new Set(eligible.map((t) => t.integrationLogId as string)),
    );
    if (uniqueLogIds.length === 0) {
      toast.info("Nenhuma transação com NF de entrada lançada aguardando baixa.");
      return;
    }
    const confirmed = window.confirm(
      `Reprocessar a baixa de ${uniqueLogIds.length} grupo(s) (${eligible.length} transações)?`,
    );
    if (!confirmed) return;

    setBatchReprocessing(true);
    let settled = 0;
    let awaiting = 0;
    let errors = 0;
    let skipped = 0;
    try {
      for (const logId of uniqueLogIds) {
        try {
          const resp = await sapFunctionFetch("pagcorp-settlement-watcher", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logId, forceRetry: true }),
          });
          const data = await resp.json().catch(() => null);
          if (!resp.ok) {
            errors++;
            continue;
          }
          if (data?.skipped) {
            skipped++;
            continue;
          }
          const results: Array<{ status?: string }> = Array.isArray(data?.results)
            ? data.results
            : [];
          if (results.some((r) => r.status === "settled")) settled++;
          else if (results.some((r) => r.status === "error")) errors++;
          else awaiting++;
        } catch {
          errors++;
        }
      }
      toast.success(
        `Reprocessamento concluído — baixados: ${settled}, aguardando: ${awaiting}, erros: ${errors}${
          skipped ? `, ignorados: ${skipped}` : ""
        }.`,
      );
      await fetchTransactions(startDate, endDate, session?.companyDB);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no reprocessamento em lote.");
    } finally {
      setBatchReprocessing(false);
    }
  };


  const filteredTransactions = useMemo(() => {
    let list = transactions;

    // Exibe somente compras reais — estornos, cancelamentos e outras classificações
    // administrativas (recarga, tarifa, ajuste etc.) são ocultados.
    const ALLOWED_CLASSIFICATIONS = new Set([
      "compra nacional",
      "compra internacional",
      "compra internacional - saldo dolar utilizado",
    ]);
    list = list.filter((t) => {
      const raw = (t as { eventClassification?: string }).eventClassification;
      if (!raw) return true; // sem classificação: mantém (dados legados)
      const norm = String(raw).replace(/\s+/g, " ").trim().toLowerCase();
      return ALLOWED_CLASSIFICATIONS.has(norm);
    });

    // Nondeductible visibility: off = hide nondeductible cards
    if (!showNondeductible) {
      list = list.filter((t) => !t.isNondeductible);
    }

    if (statusFilter === "pending") {
      list = list.filter((t) => !t.hasAccountability);
    } else if (statusFilter === "review") {
      list = list.filter((t) => t.hasAccountability && !t.accountabilityApproved);
    } else if (statusFilter === "done") {
      list = list.filter((t) => t.hasAccountability && t.accountabilityApproved);
    }

    if (settlementFilter === "not_integrated") {
      list = list.filter((t) => !t.integrated);
    } else if (settlementFilter === "integrated_pending") {
      list = list.filter((t) => t.integrated && t.settlementStatus !== "settled");
    } else if (settlementFilter === "settled") {
      list = list.filter((t) => t.settlementStatus === "settled");
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      const qKey = normalizeTaxKey(search);
      list = list.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          (t.accountName || "").toLowerCase().includes(q) ||
          (t.merchantName || "").toLowerCase().includes(q) ||
          (!!qKey && normalizeTaxKey(t.merchantTaxId).includes(qKey))
      );
    }


    if (cardFilter !== "all") {
      list = list.filter((t) => {
        const key = (t.cardLastDigits && String(t.cardLastDigits).trim()) ||
          (t.cardName && String(t.cardName).trim()) || "—";
        return key === cardFilter;
      });
    }

    // Sort by purchase date, most recent first
    return [...list].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
  }, [transactions, search, statusFilter, settlementFilter, cardFilter, showNondeductible]);

  /**
   * Constrói a lista de renderização com agrupamento visual:
   * quando 2+ transações compartilham o mesmo integrationLogId (ou sapDocEntry),
   * significa que foram integradas juntas em um único Pedido de Compra
   * consolidado no SAP. Renderizamos um cabeçalho colapsável para tornar isso
   * óbvio no leitor.
   */
  /** Estatísticas da fila de leitura por IA (monitor). */
  const aiQueueStats = useMemo(() => {
    const eligible = filteredTransactions.filter(
      (t) => isPagCorpAiEligible(t) && !t.integrated && !t.isReversed,
    );
    const withFiles = eligible.filter(
      (t) => (t.receipts?.length || 0) > 0 || (t.attachments?.length || 0) > 0,
    );
    const completed = eligible.filter((t) => t.documentAnalysisStatus === "completed").length;
    const errors = eligible.filter((t) => t.documentAnalysisStatus === "error");
    const pending = withFiles.filter(
      (t) => !t.documentAnalysisStatus || t.documentAnalysisStatus === "pending",
    );
    const noFiles = eligible.filter(
      (t) =>
        (t.receipts?.length || 0) === 0 &&
        (t.attachments?.length || 0) === 0 &&
        t.documentAnalysisStatus !== "completed" &&
        t.documentAnalysisStatus !== "error",
    ).length;
    const total = eligible.length;
    return {
      total,
      completed,
      errors: errors.length,
      errorList: errors,
      pending: pending.length,
      noFiles,
      running: aiQueueRunning,
      progress: total > 0 ? Math.round(((completed + errors.length) / total) * 100) : 100,
    };
  }, [filteredTransactions, aiQueueRunning]);

  /** Reprocessa em série todas as leituras que falharam. */
  const handleReprocessQueueErrors = async () => {
    const list = aiQueueStats.errorList;
    if (!list.length) return;
    toast.info(`Reprocessando ${list.length} leitura(s) com falha...`);
    for (const t of list) {
      // eslint-disable-next-line no-await-in-loop
      await handleReanalyze(t);
    }
  };

  const rowItems = useMemo(() => {
    const groupKeyOf = (t: PagCorpTransaction): string | null => {
      if (!t.integrated) return null;
      // Consolidação real acontece no SAP: N transações → 1 PO (mesmo DocEntry/DocNum).
      // O integrationLogId é 1:1 com a transação, então não serve para agrupar.
      if (t.sapDocEntry != null) return `de:${t.sapDocEntry}`;
      if (t.sapDocNum != null) return `dn:${t.sapDocNum}`;
      return null;
    };
    const groups = new Map<string, PagCorpTransaction[]>();
    for (const t of filteredTransactions) {
      const k = groupKeyOf(t);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(t);
    }
    type Item =
      | { type: "single"; tx: PagCorpTransaction }
      | { type: "group"; key: string; txs: PagCorpTransaction[] };
    const out: Item[] = [];
    const seen = new Set<string>();
    for (const t of filteredTransactions) {
      const k = groupKeyOf(t);
      if (k && (groups.get(k)?.length ?? 0) >= 2) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ type: "group", key: k, txs: groups.get(k)! });
        }
        continue;
      }
      out.push({ type: "single", tx: t });
    }
    return out;
  }, [filteredTransactions]);

  // Lista única de cartões para o filtro
  const cardOptions = useMemo(() => {
    const set = new Map<string, string>();
    transactions.forEach((t) => {
      const key = (t.cardLastDigits && String(t.cardLastDigits).trim()) ||
        (t.cardName && String(t.cardName).trim()) || "";
      if (!key) return;
      const label = `${t.accountAlias || t.accountName || t.cardName || "Cartão"}${t.cardLastDigits ? ` •••${t.cardLastDigits}` : ""}`;
      if (!set.has(key)) set.set(key, label);
    });
    return Array.from(set.entries()).map(([value, label]) => ({ value, label }));
  }, [transactions]);

  const nondeductiblePending = useMemo(
    () => transactions.filter((t) => t.isNondeductible && !t.integrated),
    [transactions],
  );

  const integrateAllNondeductible = async () => {
    if (!session?.companyDB) return;
    if (!(await checkSapCredentials())) return;
    // If the user has selected nondeductible rows, integrate just those; else all pending
    const selectedNd = nondeductiblePending.filter((t) => selectedIds.has(t.id));
    const targets = selectedNd.length > 0 ? selectedNd : nondeductiblePending;
    if (targets.length === 0) {
      toast.info("Nenhuma transação indedutível pendente no período");
      return;
    }
    // Group by supplier_code mapped on the card
    const groups = new Map<string, { name?: string; txs: PagCorpTransaction[] }>();
    targets.forEach((t) => {
      const code = t.nondeductibleSupplierCode!;
      if (!groups.has(code)) groups.set(code, { name: t.nondeductibleSupplierName, txs: [] });
      groups.get(code)!.txs.push(t);
    });

    setIntegratingNondeductible(true);
    const tId = toast.loading(`Integrando ${targets.length} transações em ${groups.size} PC(s)…`);
    let ok = 0;
    let fail = 0;
    try {
      for (const [code, g] of groups) {
        try {
          const result = await integrateConsolidated(
            g.txs,
            session.companyDB,
            code,
            g.name,
            session.userName || undefined,
            undefined,
            true,
          );
          ok++;
          toast.success(`PC consolidado #${result.purchaseOrder?.DocNum} (${g.txs.length} itens)`);
        } catch (e) {
          fail++;
          toast.error(`Falha no fornecedor ${code}`, {
            description: e instanceof Error ? e.message : "Erro",
          });
        }
      }
      toast.dismiss(tId);
      toast.success(`Concluído: ${ok} PC(s) criados${fail ? `, ${fail} com falha` : ""}`);
      await fetchTransactions(startDate, endDate, session.companyDB);
    } finally {
      setIntegratingNondeductible(false);
    }
  };

  // Group totals by currency
  const totalsByCurrency = useMemo(() => {
    const map: Record<string, number> = {};
    filteredTransactions.forEach((t) => {
      const cur = t.currency || "BRL";
      map[cur] = (map[cur] || 0) + (t.amount || 0);
    });
    return map;
  }, [filteredTransactions]);

  const openIntegrateDialog = async (
    t: PagCorpTransaction,
    type: "generic" | "accountability",
    opts: { fallback?: boolean; forcePostingType?: "purchase_order" | "journal_entry" } = {},
  ) => {
    if (!(await checkSapCredentials())) return;
    // O usuário sempre pode escolher o caminho, mesmo sem retorno da IA.
    const postingType = opts.forcePostingType
      || t.postingType
      || (t.hasFiscalDocument ? "purchase_order" : opts.fallback ? "purchase_order" : "journal_entry");
    if (type === "accountability" && postingType === "purchase_order") {
      setAccountabilityModal({ open: true, tx: t });
    } else {
      setIntegrateDialog({ open: true, tx: t, transactions: [t], type, postingType });
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

  // A seleção não depende mais da IA: o usuário decide o caminho no modal.
  const selectableTransactions = useMemo(
    () => filteredTransactions.filter((t) => !t.integrated && !t.isReversed),
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
    const postingType = t.postingType || (t.hasFiscalDocument ? "purchase_order" : "journal_entry");
    if (t.hasAccountability && postingType === "purchase_order") {
      setAccountabilityModal({ open: true, tx: t });
    } else {
      setIntegrateDialog({ open: true, tx: t, transactions: [t], type: t.hasAccountability ? "accountability" : "generic", postingType });
    }
  };

  const startBatch = async () => {
    if (!(await checkSapCredentials())) return;
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

  /**
   * Unified "Integrar em lote": decide between consolidate (single PC with N
   * lines) and sequential per-transaction batch based on the selection.
   *
   *  - 1 selected            → open single integrate dialog
   *  - ≥2 selected, all sem prestação → consolidar em 1 PC
   *  - ≥2 selected, com indicação LCM → um lançamento contábil em lote
   */
  const proceedBatchUnified = (list: PagCorpTransaction[]) => {
    if (list.length === 0) {
      toast.info("Nenhuma transação elegível");
      return;
    }
    if (list.length === 1) {
      const t = list[0];
      openIntegrateDialog(t, t.hasAccountability ? "accountability" : "generic");
      return;
    }
    const postingTypes = list.map((t) => t.postingType || (t.hasFiscalDocument ? "purchase_order" : "journal_entry"));
    if (postingTypes.every((type) => type === "purchase_order")) {
      setConsolidateDialog({ open: true, transactions: list });
      return;
    }
    const currencies = new Set(list.map((item) => String(item.currency || "BRL").toUpperCase()));
    if (currencies.size > 1) {
      toast.error("O lote contábil possui moedas diferentes", {
        description: "Selecione despesas da mesma moeda para gerar um único LCM.",
      });
      return;
    }
    setIntegrateDialog({
      open: true,
      tx: list[0],
      transactions: list,
      type: "generic",
      postingType: "journal_entry",
    });
  };

  const handleIntegrateBatchUnified = async () => {
    if (!(await checkSapCredentials())) return;
    const selected = selectableTransactions.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) {
      toast.info("Selecione ao menos uma transação");
      return;
    }
    const allPurchaseOrders = selected.every((item) =>
      (item.postingType || (item.hasFiscalDocument ? "purchase_order" : "journal_entry")) === "purchase_order"
    );
    if (selected.length > 1 && allPurchaseOrders) {
      // 1) Portadores/cartões divergentes NÃO bloqueiam mais o lançamento
      //    unificado — apenas avisamos o usuário. O fornecedor do PC é
      //    escolhido no diálogo de consolidação.
      const supplierKey = (t: PagCorpTransaction) =>
        String(t.accountCode || t.accountName || t.cardName || "").trim().toLowerCase();
      const suppliers = new Set(selected.map(supplierKey).filter(Boolean));
      if (suppliers.size > 1) {
        toast.warning("Portadores/cartões divergentes na seleção", {
          description:
            "As transações serão consolidadas em um único pedido com o fornecedor escolhido a seguir.",
        });
      }
      // 2) Datas divergentes não bloqueiam mais: o PC consolidado permite
      //    informar a data de emissão da nota (ex.: Google Cloud cobra ao
      //    longo do mês e fatura no mês seguinte). Cada linha mantém a data
      //    real da transação.

    }

    proceedBatchUnified(selected);
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

  const handleConfirmIntegrate = async (
    supplier: SapSearchOption | null,
    override: { costCenter?: string | null; project?: string | null; item?: string | null } = {},
    options: {
      markNondeductible: boolean;
      postingType: "purchase_order" | "journal_entry";
      journalEntry?: {
        debitAccount: string;
        creditAccount: string;
        costCenter?: string | null;
        project?: string | null;
        remarks?: string;
        exchangeRate?: number | null;
      };
      lineOverrides?: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }>;
    } = { markNondeductible: false, postingType: "purchase_order" },
  ) => {
    const t = integrateDialog.tx;
    const selectedTransactions = integrateDialog.transactions.length > 0 ? integrateDialog.transactions : t ? [t] : [];
    if (!t || !session?.companyDB) return;
    setIntegrating(selectedTransactions.length > 1 ? "journal-batch" : t.id);
    programmaticCloseRef.current = true;
    setIntegrateDialog({ open: false, tx: null, transactions: [], type: "generic", postingType: "purchase_order" });
    try {
      const baseOverrides =
        override.costCenter || override.project || override.item
          ? { [String(t.id)]: { costCenter: override.costCenter ?? null, project: override.project ?? null, item: override.item ?? null } }
          : undefined;
      // Overrides por transação (modo LCM) prevalecem sobre o cabeçalho.
      const lineOverrides = options.lineOverrides && Object.keys(options.lineOverrides).length > 0
        ? { ...(baseOverrides || {}), ...options.lineOverrides }
        : baseOverrides;

      // Sem prestação ⇒ indedutível por padrão; toggle do usuário tem prioridade
      const asNondeductible =
        options.markNondeductible ||
        (integrateDialog.type === "generic" && !t.hasFiscalDocument) ||
        !!t.isNondeductible;

      // Persiste marcação a nível de compra (override do cartão) — B4
      if (options.markNondeductible && supplier) {
        try {
          await supabase
            .from("pagcorp_nondeductible_expenses" as any)
            .upsert({
              pagcorp_expense_id: Number(t.id),
              company_db: session.companyDB,
              supplier_code: supplier.code,
              supplier_name: supplier.name,
              created_by: session.userName || null,
            }, { onConflict: "pagcorp_expense_id,company_db" });
        } catch (e) {
          console.warn("Falha ao persistir indedutível por compra:", e);
        }
      }

      const result = options.postingType === "journal_entry" && selectedTransactions.length > 1 && options.journalEntry
        ? await integrateJournalBatch(
            selectedTransactions,
            session.companyDB,
            session.userName || undefined,
            options.journalEntry,
            lineOverrides,
          )

        : await integrateDirect(
            t,
            integrateDialog.type,
            session.companyDB,
            supplier?.code || "",
            supplier?.name,
            session.userName || undefined,
            lineOverrides,
            asNondeductible,
            options.postingType,
            options.journalEntry,
          );
      if (result.alreadyIntegrated) {
        toast.info("Transação já estava integrada no SAP", {
          description: `DocNum #${result.docNum}`,
        });
      } else {
        toast.success(options.postingType === "journal_entry" ? "Lançamento Contábil criado no SAP" : asNondeductible ? "PC indedutível criado no SAP" : "Pedido de Compra criado no SAP", {
          description: options.postingType === "journal_entry" ? `LCM #${result.journalEntry?.JdtNum || result.journalEntry?.TransId}` : `PC #${result.purchaseOrder?.DocNum}`,
        });
      }
      await fetchTransactions(startDate, endDate, session.companyDB);
      if (selectedTransactions.length > 1) setSelectedIds(new Set());
      if (batchActive) advanceBatch();
    } catch (e) {
      toast.error("Falha na integração", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
        action: { label: "Ver histórico", onClick: () => navigate("/cartoes/historico") },
      });
      if (batchActive) advanceBatch();
    } finally {
      setIntegrating(null);
    }
  };


  const openConsolidateDialog = async () => {
    if (!(await checkSapCredentials())) return;
    const list = selectableTransactions.filter((t) => selectedIds.has(t.id));
    if (list.length < 2) {
      toast.info("Selecione 2 ou mais transações para consolidar");
      return;
    }
    setConsolidateDialog({ open: true, transactions: list });
  };

  const handleConfirmConsolidate = async (
    supplier: SapSearchOption,
    lineOverrides: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }> = {},
    documentDate?: string | null,
  ) => {
    const txs = consolidateDialog.transactions;
    if (txs.length === 0 || !session?.companyDB) return;
    try {
      const result = await integrateConsolidated(
        txs,
        session.companyDB,
        supplier.code,
        supplier.name,
        session.userName || undefined,
        lineOverrides,
        undefined,
        documentDate ?? null,
      );
      toast.success("Pedido de Compra consolidado criado no SAP", {
        description: `PC #${result.purchaseOrder?.DocNum} • ${txs.length} transações`,
      });
      setConsolidateDialog({ open: false, transactions: [] });
      setSelectedIds(new Set());
      await fetchTransactions(startDate, endDate, session.companyDB);
    } catch (e) {
      toast.error("Falha na integração consolidada", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
        action: { label: "Ver histórico", onClick: () => navigate("/cartoes/historico") },
      });
      throw e;
    }
  };


  const openAttachments = async (t: PagCorpTransaction) => {
    const sources: any[] = [
      ...(Array.isArray(t.receipts) ? t.receipts : []),
      ...(Array.isArray(t.attachments) ? t.attachments : []),
    ];

    // Receipts from PagCorp expose public URLs in `files[]`. Use them directly.
    const urls: string[] = [];
    for (const r of sources) {
      if (Array.isArray(r?.files)) {
        for (const f of r.files) {
          if (typeof f === "string") urls.push(f);
          else if (f?.url) urls.push(f.url);
        }
      }
      const direct =
        r?.url || r?.fileUrl || r?.link || r?.downloadUrl || r?.receiptUrl || r?.imageUrl || r?.file?.url;
      if (direct) urls.push(direct);
    }
    const unique = Array.from(new Set(urls));

    if (unique.length === 0) {
      toast.info("Nenhum anexo disponível para esta transação");
      return;
    }

    let opened = 0;
    for (const u of unique) {
      const w = window.open(u, "_blank", "noopener,noreferrer");
      if (w) opened++;
    }
    if (opened === 0) {
      toast.error("Não foi possível abrir os anexos", {
        description: "Verifique se o navegador está bloqueando pop-ups.",
      });
    }
  };

  const handleGeneratePresentation = async (
    period: PresentationPeriod,
    customRange?: { start: string; end: string },
  ) => {
    if (!session?.companyDB) {
      toast.error("Empresa não selecionada");
      return;
    }
    let start: Date;
    let end: Date;
    if (period === "custom" && customRange) {
      start = new Date(customRange.start + "T00:00:00");
      end = new Date(customRange.end + "T00:00:00");
    } else {
      const monthsBack = period === "monthly" ? 1 : period === "quarterly" ? 3 : 6;
      const today = new Date();
      end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      start = new Date(end);
      start.setMonth(start.getMonth() - monthsBack);
    }

    const toIso = (d: Date) => d.toISOString().slice(0, 10);

    // Fetch in 30-day chunks (PagCorp proxy limit)
    const chunks: { start: string; end: string }[] = [];
    let cursor = new Date(start);
    while (cursor < end) {
      const chunkEnd = new Date(cursor);
      chunkEnd.setDate(chunkEnd.getDate() + 29);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());
      chunks.push({ start: toIso(cursor), end: toIso(chunkEnd) });
      cursor = new Date(chunkEnd);
      cursor.setDate(cursor.getDate() + 1);
    }

    const tId = toast.loading(`Buscando transações em ${chunks.length} bloco(s)…`);
    try {
      const allItems: PagCorpTransaction[] = [];
      for (const c of chunks) {
        const qs = new URLSearchParams({
          startDate: c.start,
          endDate: c.end,
          companyDb: session.companyDB,
        }).toString();
        const res = await sapFunctionFetch(`pagcorp-proxy?${qs}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Erro ${res.status}`);
        }
        const json = await res.json();
        const items = (json.items || []).map((item: any, idx: number) => ({
          id: item.id || item.expenseId || `${c.start}-${idx}`,
          date: item.eventDate || item.date || item.expenseDate || item.createdAt || "",
          description: item.description || item.expenseDescription || "—",
          amount: item.amount || item.value || item.expenseValue || 0,
          currency: item.currencyCode || item.currency || "BRL",
          accountCode: item.accountCode || item.account || "",
          accountName: item.accountName || "",
          accountAlias: item.accountAlias || "",
          cardId: item.cardId || item.card_id || "",
          cardName: item.cardName || item.card_name || "",
          cardLastDigits: item.cardLastDigits || item.lastDigits || "",
          hasAccountability: (item.receipts || []).length > 0,
          accountabilityApproved:
            Number((item as { statusId?: unknown }).statusId) === 3 ||
            (item.receipts || []).some((r: any) => Number(r.statusId) === 3),
          attachments: item.attachments || [],
          receipts: item.receipts || [],
          integrated: false,
        }));
        allItems.push(...items as any);
      }

      // mark which are integrated NA EMPRESA ATUAL. Sem company_db não marca
      // (evita compartilhar status entre bases de teste e produção).
      const ids = allItems.map((t) => Number(t.id)).filter((n) => !Number.isNaN(n));
      if (ids.length && session?.companyDB) {
        const { data: logs } = await supabase
          .from("pagcorp_integration_log")
          .select("pagcorp_expense_id")
          .in("pagcorp_expense_id", ids)
          .eq("status", "success")
          .eq("company_db", session.companyDB);
        const set = new Set((logs || []).map((l: any) => l.pagcorp_expense_id));
        allItems.forEach((t) => {
          if (set.has(Number(t.id))) t.integrated = true;
        });
      }

      // cost center map from pagcorp_account_mapping
      const codes = [...new Set(allItems.map((t) => t.accountCode).filter(Boolean))] as string[];
      const ccMap: Record<string, { costCenter?: string | null; accountName?: string | null }> = {};
      if (codes.length) {
        const { data: maps } = await supabase
          .from("pagcorp_account_mapping")
          .select("account_code, account_name, cost_center")
          .in("account_code", codes);
        (maps || []).forEach((m: any) => {
          ccMap[m.account_code] = { costCenter: m.cost_center, accountName: m.account_name };
        });
      }

      toast.dismiss(tId);
      toast.loading("Gerando apresentação…", { id: tId });

      await generatePagCorpPresentation({
        companyLabel: companyLabel || session.companyDB,
        companyDb: session.companyDB,
        period,
        startDate: toIso(start),
        endDate: toIso(end),
        transactions: allItems,
        costCenterMap: ccMap,
      });

      toast.dismiss(tId);
      toast.success("Apresentação gerada", {
        description: `${allItems.length} transações em ${chunks.length} bloco(s).`,
      });
    } catch (e) {
      toast.dismiss(tId);
      toast.error("Falha ao gerar apresentação", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
      });
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
      const created = await createExpense({
        ...input,
        origin: "pagcorp",
        skipRules: true,
        initialStatus: "aprovado",
      }) as any;
      // Modo offline: o lançamento foi para a fila local e será enviado
      // quando a base voltar — não há documento para integrar agora.
      if (created?.queued || !created?.expense) {
        setAccountabilityModal({ open: false, tx: null });
        return;
      }
      const expense = created.expense;

      // Trigger SAP integration immediately
      let sapDocEntry: number | undefined;
      let sapDocNum: number | undefined;
      let sapError: string | undefined;
      let sapPayloadFromFn: any = null;
      let sapResponseFromFn: any = null;
      let pagcorpLoggedByFn = false;
      try {
        const res = await sapFunctionFetch("expense-to-sap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expense_id: (expense as any).id,
            sap_session_id: session.sessionId,
            sap_route_id: session.routeId,
            sap_company_db: session.companyDB,
            sap_session_expires_at: session.expiresAt,
            pagcorp_log: {
              transaction: t,
              integrationType: "accountability",
              companyDb: session.companyDB,
              integratedBy: session.userName || undefined,
            },
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Edge function returned ${res.status}`);
        sapPayloadFromFn = data?.sapPayload ?? null;
        sapResponseFromFn = data?.sapResponse ?? null;
        pagcorpLoggedByFn = data?.pagcorpLogged === true;
        if (data && data.success === false) throw new Error(data.error || "Falha ao integrar no SAP");
        sapDocEntry = data?.docEntry;
        sapDocNum = data?.docNum;
      } catch (sapErr) {
        sapError = sapErr instanceof Error ? sapErr.message : "Erro SAP desconhecido";
      }

      if (!pagcorpLoggedByFn) {
        console.warn("Função não confirmou registro do log PagCorp; mantendo resultado SAP original");
      }

      if (sapError) throw new Error(sapError);

      // Fila multi-fornecedor: quando os anexos trazem notas de CNPJs
      // diferentes, o modal encadeia um pedido por fornecedor. Enquanto
      // sobrar grupo na fila, mantemos o modal aberto — a MESMA transação
      // do cartão passa a ter N pedidos de compra vinculados.
      const queueRemaining = Number(input?.queue_remaining || 0);
      toast.success(
        queueRemaining > 0
          ? "Pedido criado e integrado no SAP — seguindo para o próximo fornecedor"
          : "Despesa criada e integrada no SAP",
        {
          description: [
            sapDocNum ? `PC #${sapDocNum}` : null,
            queueRemaining > 0 ? `${queueRemaining} fornecedor(es) restante(s) nesta transação` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        },
      );
      if (queueRemaining > 0) {
        // Não fecha o modal e não avança o lote: o encadeamento continua.
        void fetchTransactions(startDate, endDate, session.companyDB);
        return { expense };
      }
      programmaticCloseRef.current = true;
      setAccountabilityModal({ open: false, tx: null });
      await fetchTransactions(startDate, endDate, session.companyDB);
      if (batchActive) advanceBatch();
      return { expense };
    } catch (e) {
      toast.error("Falha ao integrar prestação", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
        action: { label: "Ver histórico", onClick: () => navigate("/cartoes/historico") },
      });
      throw e;
    } finally {
      setIntegrating(null);
    }
  };

  const companyLabel = getLabel(session?.companyDB || "");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PageTitle title="Cartões Corporativos" />
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <CreditCard className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Cartões Corporativos <span className="text-gradient">— Transações</span>
              </h1>
              <p className="text-xs text-muted-foreground">Cartões corporativos</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => navigate("/cartoes/historico")} className="gap-2">
              <History className="w-4 h-4" /> Histórico
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/cartoes/mapeamento")} className="gap-2">
              <MapPin className="w-4 h-4" /> Mapeamento
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/cartoes/indedutiveis")} className="gap-2">
              <ShieldOff className="w-4 h-4" /> Indedutíveis
            </Button>
            <ThemeToggle />
            <UserCompanyMenu />

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
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-44 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="review">Em análise</SelectItem>
                <SelectItem value="done">Aprovado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Integração / Baixa</label>
            <Select value={settlementFilter} onValueChange={(v) => setSettlementFilter(v as typeof settlementFilter)}>
              <SelectTrigger className="w-52 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="not_integrated">Não integrado</SelectItem>
                <SelectItem value="integrated_pending">Integrado — aguardando baixa</SelectItem>
                <SelectItem value="settled">Baixado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Cartão</label>
            <Select value={cardFilter} onValueChange={setCardFilter}>
              <SelectTrigger className="w-56 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os cartões</SelectItem>
                {cardOptions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
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
            onClick={handleIntegrateBatchUnified}
            disabled={selectedIds.size === 0 || batchActive}
            variant="secondary"
            className="gap-2"
            title="Quando todas as transações forem do mesmo tipo sem prestação, consolida em 1 único Pedido de Compra; caso contrário, integra uma a uma"
          >
            <Layers className="w-4 h-4" />
            Integrar em lote{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </Button>
          <Button
            onClick={handleBatchReprocessSettlement}
            disabled={batchReprocessing}
            variant="outline"
            className="gap-2"
            title="Reprocessa a baixa de todas as transações filtradas cuja NF de entrada já foi lançada"
          >
            {batchReprocessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <DownloadCloud className="w-4 h-4" />
            )}
            Reprocessar baixa em lote
          </Button>
          <Button
            onClick={() => setPresentationDialogOpen(true)}
            variant="outline"
            className="gap-2"
            title="Gera apresentação .pptx com resumo do período"
          >
            <FileText className="w-4 h-4" />
            Gerar Apresentação
          </Button>
          <div className="flex items-center gap-2 pl-2 border-l border-border ml-1">
            <Switch
              id="show-nondeductible"
              checked={showNondeductible}
              onCheckedChange={setShowNondeductible}
            />
            <Label htmlFor="show-nondeductible" className="text-xs text-muted-foreground cursor-pointer">
              Mostrar indedutíveis
            </Label>
          </div>
          {showNondeductible && nondeductiblePending.length > 0 && (
            <Button
              onClick={integrateAllNondeductible}
              disabled={integratingNondeductible || batchActive}
              variant="secondary"
              className="gap-2"
              title="Integra todas as indedutíveis pendentes consolidadas por fornecedor mapeado"
            >
              {integratingNondeductible ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldOff className="w-4 h-4" />
              )}
              {(() => {
                const selCount = nondeductiblePending.filter((t) => selectedIds.has(t.id)).length;
                return selCount > 0
                  ? `Integrar selecionadas (${selCount})`
                  : `Integrar indedutíveis (${nondeductiblePending.length})`;
              })()}
            </Button>
          )}
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
              <p className="text-xs text-muted-foreground mb-0.5">Valor Total</p>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground w-8">BRL</span>
                  <p className="text-base font-bold text-foreground tabular-nums">
                    {formatCurrency(totalsByCurrency["BRL"] || 0, "BRL")}
                  </p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground w-8">USD</span>
                  <p className="text-base font-bold text-foreground tabular-nums">
                    {formatCurrency(totalsByCurrency["USD"] || 0, "USD")}
                  </p>
                </div>
                {Object.keys(totalsByCurrency)
                  .filter((c) => c !== "BRL" && c !== "USD")
                  .map((cur) => (
                    <div key={cur} className="flex items-baseline gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground w-8">{cur}</span>
                      <p className="text-base font-bold text-foreground tabular-nums">
                        {formatCurrency(totalsByCurrency[cur], cur)}
                      </p>
                    </div>
                  ))}
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
                {filteredTransactions.filter((t) => !t.hasAccountability).length}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Monitor da fila de leitura por IA */}
        {aiQueueStats.total > 0 && (
          <div className="max-w-7xl mx-auto mt-3">
            <div className="glass-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Fila de leitura por IA</span>
                  <span className="text-xs text-muted-foreground">
                    {aiQueueStats.completed}/{aiQueueStats.total} concluídas
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    {aiQueueStats.running > 0 && <Loader2 className="w-3 h-3 animate-spin" />}
                    Processando: {aiQueueStats.running}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">Na fila: {aiQueueStats.pending}</Badge>
                  <Badge variant="outline" className="text-[10px] border-success/40 text-success">
                    Concluídas: {aiQueueStats.completed}
                  </Badge>
                  {aiQueueStats.errors > 0 && (
                    <Badge variant="destructive" className="text-[10px]">Falhas: {aiQueueStats.errors}</Badge>
                  )}
                  {aiQueueStats.noFiles > 0 && (
                    <Badge variant="outline" className="text-[10px]">Sem anexo: {aiQueueStats.noFiles}</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setAiQueuePaused((p) => !p)}
                    title="Pausar ou retomar o processamento automático da fila"
                  >
                    {aiQueuePaused ? "Retomar fila" : "Pausar fila"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    disabled={aiQueueStats.errors === 0 || reanalyzingIds.size > 0}
                    onClick={handleReprocessQueueErrors}
                  >
                    <RefreshCw className={`w-3 h-3 ${reanalyzingIds.size > 0 ? "animate-spin" : ""}`} />
                    Reprocessar falhas
                  </Button>
                </div>
              </div>
              <Progress value={aiQueueStats.progress} className="h-1.5 mt-3" />
              <p className="text-[11px] text-muted-foreground mt-2">
                {aiQueuePaused
                  ? "Fila pausada — você pode lançar manualmente escolhendo Pedido de Compra ou LCM."
                  : "Você não precisa esperar a IA: use “Lançar manual” em qualquer linha para escolher o caminho do lançamento."}
              </p>
            </div>
          </div>
        )}
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
                    <TableHead className="w-20">
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
                  {(() => {
                    const renderTxRow = (t: PagCorpTransaction, opts: { inGroup?: boolean } = {}) => {
                      const isSelected = selectedIds.has(t.id);
                      const inGroup = !!opts.inGroup;
                      const aiEligible = isPagCorpAiEligible(t);
                      const isExpanded = expandedTransactions.has(String(t.id));
                      return (
                      <Fragment key={String(t.id)}>
                      <TableRow
                        onClick={(event) => {
                          const target = event.target as HTMLElement;
                          if (target.closest("button, a, input, [role='menuitem'], [role='checkbox']")) return;
                          toggleTransaction(t.id);
                        }}
                        className={
                          inGroup
                            ? "border-border border-l-2 border-l-success/60 bg-success/5 cursor-pointer"
                            : "border-border cursor-pointer"
                        }
                        data-state={isSelected ? "selected" : undefined}
                      >
                        <TableCell className="w-20">
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => toggleTransaction(t.id)}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? "Recolher detalhes da transação" : "Expandir detalhes da transação"}
                              title={isExpanded ? "Recolher detalhes" : "Ver detalhes"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                            {!t.integrated && !t.isReversed && (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(t.id)}
                                aria-label="Selecionar"
                              />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={`text-sm text-foreground whitespace-nowrap ${inGroup ? "pl-6" : ""}`}>
                          {formatDate(t.date)}
                        </TableCell>
                        <TableCell className="text-sm text-foreground max-w-[250px]">
                          <div className="flex items-center gap-2">
                            <span className="truncate">{t.description}</span>
                            {t.isNondeductible && (
                              <Badge variant="outline" className="text-[10px] uppercase tracking-wide gap-1 shrink-0">
                                <ShieldOff className="w-3 h-3" />
                                Indedutível
                              </Badge>
                            )}
                          </div>
                          {(t.merchantName || t.merchantTaxId) && (
                            <div className="text-xs text-muted-foreground truncate">
                              {t.merchantName || "Estabelecimento"}
                              {t.merchantTaxId ? ` • ${formatTaxId(t.merchantTaxId)}` : ""}
                            </div>
                          )}
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
                          {(() => {
                            const receiptCount =
                              (Array.isArray(t.receipts) ? t.receipts.length : 0) +
                              (Array.isArray(t.attachments) ? t.attachments.length : 0);
                            const statusBadge = t.isReversed ? (
                              <Badge variant="secondary" className="bg-muted text-muted-foreground border-border gap-1">
                                <XCircle className="w-3 h-3" /> {t.isCredit ? "Crédito" : "Estornado"}
                              </Badge>

                            ) : t.hasAccountability ? (
                              t.accountabilityApproved ? (
                                <Badge variant="secondary" className="bg-success/15 text-success border-success/30 gap-1">
                                  <CheckCircle2 className="w-3 h-3" /> Aprovado
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-warning/15 text-warning border-warning/30 gap-1">
                                  <Clock className="w-3 h-3" /> Em análise
                                </Badge>
                              )
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground gap-1">
                                <XCircle className="w-3 h-3" /> Pendente
                              </Badge>
                            );
                            return (
                              <div className="flex items-center justify-center gap-2">
                                {statusBadge}
                                {aiEligible && (
                                  t.documentAnalysisStatus === "completed" ? (
                                    <Badge
                                      variant="outline"
                                      className={t.hasFiscalDocument
                                        ? "text-[10px] border-success/40 text-success"
                                        : "text-[10px] border-warning/40 text-warning"}
                                    >
                                      {t.hasFiscalDocument ? "Documento fiscal" : "Sem documento fiscal"}
                                    </Badge>
                                  ) : t.documentAnalysisStatus === "error" ? (
                                    <Badge variant="destructive" className="text-[10px]">Falha na leitura IA</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px] gap-1">
                                      <Loader2 className="w-3 h-3 animate-spin" /> Analisando documentos
                                    </Badge>
                                  )
                                )}
                                {receiptCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => openAttachments(t)}
                                    title={`Abrir ${receiptCount} anexo(s) em nova aba`}
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  >
                                    <Paperclip className="w-3.5 h-3.5" />
                                    {receiptCount}
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-center">
                          {t.integrated ? (
                            t.postingType === "journal_entry" ? (
                              <Badge variant="secondary" className="gap-1 bg-success/15 text-success border-success/30">
                                <CheckCircle2 className="w-3 h-3" /> LCM #{t.sapDocNum ?? t.sapDocEntry ?? "integrado"}
                              </Badge>
                            ) : <div className="flex flex-col items-center gap-1">
                              {(() => {
                                const st = t.settlementStatus;
                                const isRunning = settling === t.id;
                                // Fatos do SAP prevalecem sobre o status interno:
                                // NF/baixa lançadas manualmente também contam.
                                const settled = st === "settled" || t.paymentFoundInSap === true;
                                const settlementLabel = settled
                                  ? `Baixa ${t.settlementPaymentDocNum ? `#${t.settlementPaymentDocNum}` : "OK"}`
                                  : st === "awaiting_invoice"
                                    ? "Aguardando NF"
                                    : st === "awaiting_settlement"
                                      ? "Tentar baixa"
                                      : st === "error"
                                        ? "Reprocessar baixa"
                                        : "Baixa automática";

                                // Progressão: Integrado → NF lançada → Baixado
                                const nfDone = settled || st === "awaiting_settlement" || t.nfFoundInSap === true;
                                const currentStep = settled ? 3 : nfDone ? 2 : 1;

                                const stepClass = (idx: number) => {
                                  if (idx < currentStep) return "text-success font-medium";
                                  if (idx === currentStep)
                                    return st === "error" && !settled
                                      ? "text-destructive font-semibold"
                                      : settled
                                        ? "text-success font-semibold"
                                        : "text-primary font-semibold";
                                  return "text-muted-foreground/60";
                                };
                                const sepClass = (idx: number) =>
                                  idx < currentStep ? "text-success/70" : "text-muted-foreground/40";
                                return (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-[11px] gap-1"
                                        disabled={isRunning}
                                        title={
                                          inGroup
                                            ? "Item consolidado"
                                            : `Status: ${settled ? "Baixado" : nfDone ? "NF lançada" : "Integrado"}`
                                        }
                                      >
                                        {isRunning ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : settled ? (
                                          <CheckCircle2 className="w-3 h-3 text-success" />
                                        ) : (
                                          <CheckCircle2 className="w-3 h-3 text-success" />
                                        )}
                                        {inGroup ? (
                                          <span>Item consolidado</span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 leading-none">
                                            <span className={stepClass(1)}>Integrado</span>
                                            <span className={sepClass(1)}>›</span>
                                            <span className={stepClass(2)}>NF</span>
                                            <span className={sepClass(2)}>›</span>
                                            <span className={stepClass(3)}>Baixa</span>
                                          </span>
                                        )}
                                        {(t.integrationLinks?.length ?? 0) > 1 && (
                                          <span
                                            className="ml-1 rounded-sm bg-primary/15 text-primary px-1 font-medium"
                                            title={`Esta transação gerou ${t.integrationLinks!.length} pedidos de compra (fornecedores diferentes)`}
                                          >
                                            {t.integrationLinks!.length} PCs
                                          </span>
                                        )}
                                        <MoreHorizontal className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-64">
                                      <DropdownMenuLabel className="text-xs">
                                        Transação PagCorp
                                      </DropdownMenuLabel>
                                      <DropdownMenuSeparator />

                                      {(() => {
                                        // Uma transação pode ter N pedidos (notas de
                                        // fornecedores/CNPJs diferentes no mesmo comprovante).
                                        const links = t.integrationLinks?.length
                                          ? t.integrationLinks
                                          : t.sapDocNum != null
                                            ? [{ logId: t.integrationLogId || "", docNum: t.sapDocNum, docEntry: t.sapDocEntry ?? null, settlementStatus: null, settlementPaymentDocNum: null, settlementError: null }]
                                            : [];
                                        if (links.length === 0) return null;
                                        return (
                                          <div className="px-2 py-1.5 text-[11px] flex items-start justify-between gap-2">
                                            <span className="text-muted-foreground">
                                              {links.length > 1 ? `Pedidos de Compra (${links.length})` : "Pedido de Compra"}
                                            </span>
                                            <span className="font-mono font-medium text-foreground text-right">
                                              {links.map((l) => (
                                                <span key={l.logId || l.docNum} className="block">
                                                  PC #{l.docNum ?? "—"}
                                                </span>
                                              ))}
                                            </span>
                                          </div>
                                        );
                                      })()}
                                      <div className="px-2 py-1.5 text-[11px] flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Baixa</span>
                                        <span
                                          className={
                                            settled
                                              ? "font-medium text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"
                                              : "font-medium text-muted-foreground inline-flex items-center gap-1"
                                          }
                                          title={t.settlementError || undefined}
                                        >
                                          {settled && <CheckCircle2 className="w-3 h-3" />}
                                          {settlementLabel}
                                        </span>
                                      </div>

                                      {t.sapDocEntry != null && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onClick={() => setValidateDialog({ open: true, tx: t })}>
                                            <CheckCircle className="w-4 h-4 mr-2 text-primary" />
                                            Validar SAP
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => setRelationsDialog({ open: true, tx: t })}
                                          >
                                            <Network className="w-4 h-4 mr-2 text-primary" />
                                            Mapa de relações
                                          </DropdownMenuItem>
                                          {!settled && (
                                            <DropdownMenuItem
                                              disabled={isRunning}
                                              onClick={() => handleAutoSettle(t)}
                                              title={t.settlementError || undefined}
                                            >
                                              <Sparkles className="w-4 h-4 mr-2" />
                                              {settlementLabel}
                                            </DropdownMenuItem>
                                          )}
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                );
                              })()}
                            </div>
                          ) : t.isReversed ? (
                            <Badge variant="outline" className="text-muted-foreground text-xs gap-1">
                              <XCircle className="w-3 h-3" /> Sem integração
                            </Badge>
                          ) : integrating === t.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" />
                          ) : t.documentAnalysisStatus !== "completed" ? (
                            <div className="flex items-center justify-end gap-1">
                              {aiEligible && t.documentAnalysisStatus === "error" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1 text-xs"
                                  disabled={reanalyzingIds.has(t.id)}
                                  title={t.documentAnalysisError || "Reprocessar a leitura dos anexos com a IA"}
                                  onClick={() => handleReanalyze(t)}
                                >
                                  {reanalyzingIds.has(t.id) ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Reprocessando</>
                                  ) : (
                                    <><RefreshCw className="w-3 h-3" /> Reprocessar IA</>
                                  )}
                                </Button>
                              ) : aiEligible && t.documentAnalysisStatus === "processing" ? (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Leitura IA
                                </span>
                              ) : null}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1 text-xs"
                                    title="Não esperar a IA — escolha o caminho do lançamento"
                                  >
                                    <Upload className="w-3 h-3" /> Lançar manual
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() =>
                                      openIntegrateDialog(t, t.hasAccountability ? "accountability" : "generic", {
                                        fallback: true,
                                        forcePostingType: "purchase_order",
                                      })
                                    }
                                  >
                                    Pedido de Compra
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      openIntegrateDialog(t, "generic", {
                                        fallback: true,
                                        forcePostingType: "journal_entry",
                                      })
                                    }
                                  >
                                    Lançamento contábil (LCM)
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ) : (

                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={reanalyzingIds.has(t.id)}
                                title={t.documentAnalysisError || "Reprocessar a leitura dos anexos com a IA"}
                                onClick={() => handleReanalyze(t)}
                              >
                                <RefreshCw className={`w-3 h-3 ${reanalyzingIds.has(t.id) ? "animate-spin" : ""}`} />
                              </Button>
                              {t.hasAccountability ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1 text-xs"
                                  onClick={() => openIntegrateDialog(t, "accountability")}
                                >
                                  <Sparkles className="w-3 h-3" />
                                  Integrar ao ERP
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1 text-xs"
                                  onClick={() => openIntegrateDialog(t, "generic")}
                                >
                                  <Upload className="w-3 h-3" />
                                  Integrar ao ERP
                                </Button>
                              )}
                            </div>
                          )}

                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className={inGroup ? "border-border bg-success/[0.03]" : "border-border bg-muted/20"}>
                          <TableCell colSpan={7} className="px-6 py-4">
                            <PagCorpTransactionDetails
                              transaction={t}
                              onOpenAttachments={openAttachments}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                      );
                    };

                    return rowItems.flatMap((item) => {
                      if (item.type === "single") return [renderTxRow(item.tx)];

                      const txs = item.txs;
                      const first = txs[0];
                      const isJournalEntryGroup = first.postingType === "journal_entry";
                      const docNum = first.sapDocNum;
                      const docEntry = first.sapDocEntry;
                      const totals: Record<string, number> = {};
                      for (const t of txs) {
                        const cur = t.currency || "BRL";
                        totals[cur] = (totals[cur] || 0) + (t.amount || 0);
                      }
                      const totalsStr = Object.entries(totals)
                        .map(([cur, val]) => formatCurrency(val, cur))
                        .join(" • ");
                      const expanded = expandedGroups.has(item.key);
                      const settledCount = txs.filter((t) => t.settlementStatus === "settled").length;

                      const header = (
                        <TableRow
                          key={`group-${item.key}`}
                          className="border-border bg-success/10 hover:bg-success/15 cursor-pointer"
                          onClick={() => toggleGroup(item.key)}
                        >
                          <TableCell className="w-20">
                            {expanded ? (
                              <ChevronDown className="w-4 h-4 text-success" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-success" />
                            )}
                          </TableCell>
                          <TableCell colSpan={6} className="py-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <Layers className="w-4 h-4 text-success shrink-0" />
                              <span className="font-semibold text-foreground">
                                {isJournalEntryGroup ? "LCM em lote" : "PC consolidado"}
                                {docNum != null ? ` #${docNum}` : docEntry != null ? ` (DocEntry ${docEntry})` : ""}
                              </span>
                              <Badge variant="secondary" className="bg-success/20 text-success border-success/30">
                                {txs.length} transações
                              </Badge>
                              <span className="text-muted-foreground">•</span>
                              <span className="font-medium text-foreground tabular-nums">{totalsStr}</span>
                              {!isJournalEntryGroup && settledCount > 0 && (
                                <>
                                  <span className="text-muted-foreground">•</span>
                                  <span className="text-xs text-success inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    {settledCount === txs.length
                                      ? "Baixa emitida"
                                      : `${settledCount}/${txs.length} baixados`}
                                  </span>
                                </>
                              )}
                              <div className="ml-auto flex items-center gap-2">
                                {!isJournalEntryGroup && settledCount < txs.length && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1 text-xs"
                                    disabled={reprocessingGroup === item.key}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleReprocessGroup(item.key, txs);
                                    }}
                                  >
                                    {reprocessingGroup === item.key ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <RefreshCw className="w-3 h-3" />
                                    )}
                                    {settledCount > 0 ? "Reprocessar baixa" : "Processar baixa"}
                                  </Button>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {expanded ? "Ocultar itens" : "Ver itens"}
                                </span>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );

                      if (!expanded) return [header];
                      return [header, ...txs.map((t) => renderTxRow(t, { inGroup: true }))];
                    });
                  })()}
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
          setIntegrateDialog({ open: false, tx: null, transactions: [], type: "generic", postingType: "purchase_order" });
          if (batchActive && !wasProgrammatic) cancelBatch();
        }}
        transaction={integrateDialog.tx}
        transactions={integrateDialog.transactions}
        integrationType={integrateDialog.type}
        companyDb={session?.companyDB}
        initialPostingType={integrateDialog.postingType}
        onPostingTypeChange={(postingType) => {
          const tx = integrateDialog.tx;
          if (postingType !== "purchase_order" || !tx) return;
          const batchTransactions = integrateDialog.transactions;
          programmaticCloseRef.current = true;
          setIntegrateDialog({ open: false, tx: null, transactions: [], type: "generic", postingType: "purchase_order" });
          if (batchTransactions.length > 1) {
            setTimeout(() => setConsolidateDialog({ open: true, transactions: batchTransactions }), 200);
          } else if (tx.hasAccountability) {
            setTimeout(() => setAccountabilityModal({ open: true, tx }), 200);
          }
        }}
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
        onPagcorpPostingTypeChange={(postingType) => {
          if (postingType !== "journal_entry" || !accountabilityModal.tx) return;
          const tx = accountabilityModal.tx;
          programmaticCloseRef.current = true;
          setAccountabilityModal({ open: false, tx: null });
          setTimeout(() => setIntegrateDialog({
            open: true,
            tx,
            transactions: [tx],
            type: "accountability",
            postingType: "journal_entry",
          }), 200);
        }}
        prefill={
          accountabilityModal.tx
            ? {
                description: accountabilityModal.tx.description,
                amount: accountabilityModal.tx.amount,
                currency: accountabilityModal.tx.currency,
                accountAlias: accountabilityModal.tx.accountAlias,
                accountName: accountabilityModal.tx.accountName,
                receipts: accountabilityModal.tx.receipts,
                triggerAI: true,
                cardId: accountabilityModal.tx.cardId,
                cardLastDigits: accountabilityModal.tx.cardLastDigits,
                cardName: accountabilityModal.tx.cardName,
              }
            : undefined
        }
      />

      <PagCorpConsolidateDialog
        open={consolidateDialog.open}
        onClose={() => setConsolidateDialog({ open: false, transactions: [] })}
        transactions={consolidateDialog.transactions}
        onSwitchToJournalEntry={() => {
          const selectedTransactions = consolidateDialog.transactions;
          const currencies = new Set(selectedTransactions.map((item) => String(item.currency || "BRL").toUpperCase()));
          if (currencies.size > 1) {
            toast.error("O lote contábil possui moedas diferentes", {
              description: "Selecione despesas da mesma moeda para gerar um único LCM.",
            });
            return;
          }
          setConsolidateDialog({ open: false, transactions: [] });
          setTimeout(() => setIntegrateDialog({
            open: true,
            tx: selectedTransactions[0] || null,
            transactions: selectedTransactions,
            type: "generic",
            postingType: "journal_entry",
          }), 200);
        }}
        onConfirm={handleConfirmConsolidate}
      />

      <ConfirmDialog
        open={dateConflictDialog.open}
        onOpenChange={(open) => {
          if (!open) setDateConflictDialog((prev) => ({ ...prev, open: false }));
        }}
        title="Datas divergentes na seleção"
        description={`Existem transações em datas diferentes. A integração em lote seguirá apenas com as ${dateConflictDialog.kept} transação(ões) da data mais antiga (${(() => {
          try { return new Date(dateConflictDialog.oldest).toLocaleDateString("pt-BR"); } catch { return dateConflictDialog.oldest; }
        })()}). Outras ${dateConflictDialog.dropped} serão ignoradas neste lote.`}
        confirmLabel="Continuar com data mais antiga"
        cancelLabel="Cancelar"
        onConfirm={() => {
          const list = dateConflictDialog.filtered;
          setDateConflictDialog({ open: false, oldest: "", kept: 0, dropped: 0, filtered: [] });
          proceedBatchUnified(list);
        }}
      />

      <PagCorpPresentationDialog
        open={presentationDialogOpen}
        onClose={() => setPresentationDialogOpen(false)}
        companyLabel={companyLabel || session?.companyDB || ""}
        onGenerate={handleGeneratePresentation}
      />

      <SapValidationDialog
        open={validateDialog.open}
        onClose={() => setValidateDialog({ open: false, tx: null })}
        pagcorpLogId={validateDialog.tx?.integrationLogId ?? null}
        docEntry={(validateDialog.tx?.sapDocEntry as number | null) ?? null}
        docNum={(validateDialog.tx?.sapDocNum as number | null) ?? null}
        expectedAmount={validateDialog.tx ? Number(validateDialog.tx.amount) : undefined}
        expectedCurrency={validateDialog.tx?.currency}
      />

      <RelationsMap
        open={relationsDialog.open}
        onClose={() => setRelationsDialog({ open: false, tx: null })}
        expense={buildRelationsExpense(relationsDialog.tx, session?.companyDB)}
        title="Mapa de Relações — PagCorp"
      />
    </div>
  );
}
