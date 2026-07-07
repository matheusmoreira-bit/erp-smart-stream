import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  X,
  Upload,
  FileSpreadsheet,
  Sparkles,
  Brain,
  Ban,
  Pause,
  Play,
  FileDown,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { exportQueueSummaryPdf, exportLowConfidenceReviewPdf, exportLowConfidenceReviewCsv, exportPurchaseFlowReportPdf } from "@/lib/report-pdf";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type SapSearchOption } from "@/components/SapSearchCombobox";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { sapQuery } from "@/lib/sap-client";
import { useSapCachedList } from "@/hooks/useSapCachedList";
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
import { toast } from "sonner";
import { type ExpenseItem, type CreateExpenseInput, type RateioType, RATEIO_TYPE_LABELS } from "@/hooks/useExpenses";
import { SupplierFormModal, type SupplierFormPrefill } from "@/components/SupplierFormModal";
import { requestSupplierRegistration } from "@/lib/supplier-request-email";
import { UserPlus } from "lucide-react";
import { usePagCorpCardMapping, type CardMappingStatus } from "@/hooks/usePagCorpCardMapping";
import { PagCorpCardMappingBanner } from "@/components/PagCorpCardMappingBanner";
import { saveDraft, deleteDraft } from "@/hooks/useDocumentDrafts";
import { supabase } from "@/integrations/supabase/client";
import {
  hashFileContent,
  findExistingClaims,
  claimDocumentHashes,
  hasInFlightGuardTripped,
} from "@/lib/expense-dedupe";
import {
  saveQueueState,
  loadQueueState,
  clearQueueState,
  toPersistedFile,
  fromPersistedFile,
  type PersistedDocGroup,
  type QueueScope,
} from "@/lib/expense-queue-persist";
import {
  loadAiResponseCache,
  saveAiResponseCacheEntries,
  clearAiResponseCache,
} from "@/lib/ai-response-cache-persist";
import { notifyFiscalMissingAttachment } from "@/lib/notify-fiscal-missing-attachment";

// Logger tagueado — usado nas verificações de dedup e nos guards de fluxo
// (cancelar/retentar). Sempre em `console.info`/`warn` para facilitar filtro
// pelo DevTools ao investigar duplicações reportadas por usuários.
const DEDUP_LOG = "[expense-dedupe]";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
}

export interface PagCorpPrefill {
  description?: string;
  amount?: number;
  currency?: string;
  accountAlias?: string;
  accountName?: string;
  receipts?: any[];
  triggerAI?: boolean;
  cardId?: string | number;
  cardLastDigits?: string;
  cardName?: string;
}

export type ExpenseMode = "purchase" | "sales";

export interface ExpenseDraftHydration {
  id: string;
  payload: any;
}

export function CreateExpenseModal({
  open,
  onClose,
  onCreate,
  sapSession,
  prefill,
  title,
  origin = "manual",
  skipRules = false,
  mode = "purchase",
  initialDraft,
  onDraftSaved,
  onDraftConsumed,
  lowAiConfidenceThreshold = 0.75,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateExpenseInput) => Promise<unknown>;
  sapSession: any;
  prefill?: PagCorpPrefill;
  title?: string;
  origin?: "manual" | "pagcorp";
  skipRules?: boolean;
  mode?: ExpenseMode;
  initialDraft?: ExpenseDraftHydration | null;
  onDraftSaved?: (id: string | null) => void;
  onDraftConsumed?: () => void;
  /** Limite (0–1) abaixo do qual a confiança média da IA por grupo é
   *  destacada visualmente como "provavelmente precisa de revisão". */
  lowAiConfidenceThreshold?: number;
}) {
  const isSales = mode === "sales";
  const bpLabel = isSales ? "Cliente" : "Fornecedor";
  const [dialogContainer, setDialogContainer] = useState<HTMLDivElement | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isGeneratingFlowReport, setIsGeneratingFlowReport] = useState(false);
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [currency, setCurrency] = useState("");
  const [currencyWarning, setCurrencyWarning] = useState<string | null>(null);
  const [currencyOptions, setCurrencyOptions] = useState<string[] | null>(null);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);
  const [docDate, setDocDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState<(Omit<ExpenseItem, "id"> & { sapItem?: SapSearchOption | null; sapCostCenter?: SapSearchOption | null; sapProject?: SapSearchOption | null; searchHint?: string })[]>([
    { description: "", quantity: 1, unit_price: 0, line_total: 0, cost_center: "", project: "" },
  ]);
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  const [suggestedSupplierName, setSuggestedSupplierName] = useState<string | undefined>(undefined);
  const [aiSupplierData, setAiSupplierData] = useState<SupplierFormPrefill | null>(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [pendingPrefill, setPendingPrefill] = useState<PagCorpPrefill | null>(null);
  const [headerCostCenter, setHeaderCostCenter] = useState<SapSearchOption | null>(null);
  const [headerProject, setHeaderProject] = useState<SapSearchOption | null>(null);
  const [rateioType, setRateioType] = useState<RateioType>("padrao");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);

  // Cached SAP lists
  const supplierMapRow = useCallback((row: any) => ({
    code: row.CardCode,
    name: row.CardName,
    extra: row.FederalTaxID || undefined,
    currency: row.Currency || "",
    details: { fantasyName: row.AliasName || undefined, taxId: row.FederalTaxID || undefined },
  } as SapSearchOption & { currency: string }), []);
  const { options: supplierOptions, isLoading: suppliersLoading, reload: reloadSuppliers } = useSapCachedList({
    cacheKey: isSales ? "customers_active_v2" : "suppliers_active_v2",
    endpoint: "BusinessPartners",
    params: isSales
      ? { $select: "CardCode,CardName,AliasName,FederalTaxID,Currency", $filter: "CardType eq 'cCustomer' and Frozen eq 'tNO'" }
      : { $select: "CardCode,CardName,AliasName,FederalTaxID,Currency", $filter: "CardType eq 'cSupplier' and Frozen eq 'tNO'" },
    mapRow: supplierMapRow,
  });

  const itemMapRow = useCallback((row: any) => ({ code: row.ItemCode, name: row.ItemName }), []);
  const { options: itemOptions, isLoading: itemsLoading } = useSapCachedList({
    cacheKey: isSales ? "items_sales_active_v3" : "items_purchase_active_v3",
    endpoint: "Items",
    params: {
      // Apenas itens ativos no SAP (Valid='tYES' e Frozen='tNO')
      $filter: "Valid eq 'tYES' and Frozen eq 'tNO'",
      $select: "ItemCode,ItemName",
    },
    mapRow: itemMapRow,
  });

  const costCenterMapRow = useCallback((row: any) => ({ code: row.CenterCode, name: row.CenterName }), []);
  const { options: rawCostCenterOptions, isLoading: costCentersLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: costCenterMapRow,
  });
  const costCenterOptions = useMemo(
    () => rawCostCenterOptions.filter((o) => !o.name?.toLowerCase().startsWith("centro geral")),
    [rawCostCenterOptions]
  );

  const projectMapRow = useCallback((row: any) => ({ code: row.Code, name: row.Name }), []);
  const { options: projectOptions, isLoading: projectsLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: projectMapRow,
  });

  // File upload + AI
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(!isSales);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Fluxo multi-documento ────────────────────────────────────────────
  // Quando o usuário anexa >1 nota/recibo, aplicamos as regras:
  //   1) MESMO fornecedor  → mescla todas as linhas numa despesa só.
  //   2) FORNECEDORES DIFERENTES → o usuário escolhe qual criar primeiro; o
  //      restante fica em `deferredGroups` e, ao terminar de submeter a atual,
  //      o modal se rehidrata automaticamente com o próximo grupo.
  //   3) Documentos NÃO-fiscais (classificados por IA como "outro") apenas
  //      viram anexo — não preenchem a despesa.
  interface DocGroup { supplierKey: string; supplierLabel: string; docs: Array<{ file: File; extracted: any }>; }
  const [deferredGroups, setDeferredGroups] = useState<DocGroup[]>([]);
  const [supplierPicker, setSupplierPicker] = useState<{ groups: DocGroup[]; nonFiscal: File[] } | null>(null);
  // Confirmação e controle de cancelamento do processamento IA / fila de
  // fornecedores adiados. `aiAbortRef` permite abortar o fetch em andamento.
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  // Fila completa dos fornecedores despachados (regra 2 — anexos com
  // fornecedores diferentes). Guardamos snapshot no momento da escolha para
  // exibir o resumo do resultado de cada grupo ao final do encadeamento,
  // incluindo alertas da IA e o nível de confiança extraído.
  type QueueStatus = "pending" | "queued" | "success" | "failed" | "cancelled";
  interface QueueEntry {
    supplierKey: string;
    supplierLabel: string;
    fileCount: number;
    fileNames: string[];
    lineCount: number;
    estimatedTotal: number;
    currency: string;
    currencies: string[];
    aiConfidence: number | null;
    aiWarnings: string[];
    status: QueueStatus;
    errorMessage?: string;
    // Timestamps (ms epoch) do fluxo — usados no relatório de fluxo de
    // compras (super-user) para medir tempo por etapa e gargalos.
    classifiedAt?: number;   // IA concluiu classificação → entrada criada
    promotedAt?: number;     // status virou "pending" (grupo abre no form)
    submittedAt?: number;    // usuário clicou "Salvar"
    completedAt?: number;    // sucesso / falha / cancelamento final
  }
  const [queueHistory, setQueueHistory] = useState<QueueEntry[]>([]);
  const [showQueueSummary, setShowQueueSummary] = useState(false);
  // Confirmação antes de reenviar apenas os erros do resumo da fila.
  const [confirmRetryFailed, setConfirmRetryFailed] = useState(false);
  // Pausa "leve" da fila: após concluir o grupo atual, NÃO auto-avança
  // para o próximo deferredGroup. Diferente de "Cancelar", preserva o
  // status "queued" e os DocGroups em cache — retomar reaproveita tudo.
  const [isPaused, setIsPaused] = useState(false);
  const pausedRef = useRef(false);
  // Rastreia uma sessão ativa de "Reenviar apenas erros" — chaves dos grupos
  // que estamos reprocessando — para renderizar barra/contador dedicado.
  // null = nenhuma sessão de retentativa em andamento.
  const [retryingKeys, setRetryingKeys] = useState<Set<string> | null>(null);
  // Detalhes de um grupo (deferredGroup / concluído / com erro / cancelado)
  // abertos em modal para inspeção antes de fechar. Guarda o snapshot da
  // entry (sempre disponível) + o DocGroup original (quando o cache ainda tem).
  const [detailsView, setDetailsView] = useState<{
    entry: QueueEntry;
    group: DocGroup | null;
  } | null>(null);
  // Filtros locais do modal "Ver detalhes" — resetados sempre que abrimos
  // um novo grupo. Permitem localizar rapidamente uma linha, um alerta ou
  // um arquivo específico dentro do resumo por fornecedor.
  const [detailsSearch, setDetailsSearch] = useState("");
  const [detailsTypeFilter, setDetailsTypeFilter] = useState<"all" | "line" | "warning">("all");
  const [detailsConfidenceFilter, setDetailsConfidenceFilter] = useState<"all" | "low" | "normal">("all");
  // Marca que o usuário acabou de cancelar o processamento/fila. Habilita o
  // botão "Tentar novamente" enquanto os anexos permanecerem no modal.
  const [justCancelled, setJustCancelled] = useState(false);
  // Rastreia o DocGroup em edição no formulário (o "pendente") para que, se
  // a submissão falhar, saibamos qual grupo re-enfileirar em "Reenviar apenas
  // erros". Cache separado guarda os DocGroup completos dos que falharam.
  const currentGroupRef = useRef<DocGroup | null>(null);
  const failedGroupsRef = useRef<Map<string, DocGroup>>(new Map());
  // Cache dos grupos que estavam pendentes/enfileirados no momento do
  // cancelamento. Habilita "Retomar fila" para continuar do próximo
  // deferredGroup sem tocar nos grupos já concluídos com sucesso.
  const cancelledGroupsRef = useRef<DocGroup[]>([]);
  // Cache de respostas da IA por hash de conteúdo do arquivo (SHA-256).
  // Reaproveitado em "Tentar novamente" para pular chamadas ao endpoint.
  // Vive durante a instância do modal; é limpo no unmount/close.
  const aiResponseCacheRef = useRef<Map<string, any>>(new Map());
  // Escopo para o storage persistente do cache (separa expenses/sales).
  const aiCacheScope = isSales ? "sales" : "expenses";
  // Guards reentrantes fortes para evitar QUALQUER chamada duplicada de IA
  // ou de criação de despesa quando o usuário cancela+retenta rápido, ou o
  // React 18 (StrictMode) invoca o handler duas vezes. Estado (`isProcessing`,
  // `isCreating`) já protege a UI, mas refs pegam a corrida entre o clique
  // e o setState batch. Sempre resetados no `finally`.
  const aiInFlightRef = useRef<boolean>(false);
  const submitInFlightRef = useRef<boolean>(false);
  // Registro dos hashes já reivindicados pelo usuário nesta sessão do modal
  // — usado para não recontar duplicatas em retries do mesmo submit.
  const claimedHashesRef = useRef<Set<string>>(new Set());

  // Prefixo de versão da chave do cache. Sempre que os campos que compõem
  // a chave mudarem, bump aqui — entradas antigas viram misses automáticos
  // e são reprocessadas, evitando reuso incorreto de layouts obsoletos.
  const HASH_KEY_VERSION = "v2";
  const hashFile = async (file: File): Promise<string> => {
    // Normaliza campos que podem variar por ambiente (nome sanitizado,
    // MIME em minúsculas). Inclui `type` e `lastModified` para reduzir
    // reuso incorreto quando o conteúdo é semanticamente diferente mesmo
    // com hash coincidente (colisão altamente improvável, mas cinturão
    // adicional é barato).
    const name = (file.name || "").trim();
    const mime = (file.type || "application/octet-stream").toLowerCase();
    const lastMod = Number.isFinite(file.lastModified) ? file.lastModified : 0;
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      // Chave: v2|hash|size|type|name|lastModified
      // - hash: identifica o conteúdo (SHA-256)
      // - size/type: descartam colisões cross-formato (mesmo hash truncado)
      // - name: separa arquivos idênticos com nomes diferentes (provenance)
      // - lastModified: invalida quando o usuário reeditou/re-salvou o arquivo
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `${HASH_KEY_VERSION}|${hex}|${file.size}|${mime}|${name}|${lastMod}`;
    } catch {
      // Fallback quando SubtleCrypto não estiver disponível (contexto não
      // seguro): usa apenas metadados. Prefixo `nohash` garante disjunção
      // do caminho com hash — nunca casam entre si.
      return `${HASH_KEY_VERSION}|nohash|${file.size}|${mime}|${name}|${lastMod}`;
    }
  };
  // Limite de confiança IA ajustável em tempo real (a partir do prop).
  // Grupos com confiança média abaixo disso ganham destaque visual âmbar.
  // Persistido em localStorage para manter a preferência entre sessões do
  // modal (fallback para o prop `lowAiConfidenceThreshold` se não houver
  // valor salvo ou o valor for inválido).
  const AI_CONF_STORAGE_KEY = "createExpenseModal:aiConfidenceThreshold";
  const [aiConfidenceThreshold, setAiConfidenceThreshold] = useState<number>(() => {
    if (typeof window === "undefined") return lowAiConfidenceThreshold;
    try {
      const raw = window.localStorage.getItem(AI_CONF_STORAGE_KEY);
      if (raw === null) return lowAiConfidenceThreshold;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    } catch { /* ignore */ }
    return lowAiConfidenceThreshold;
  });
  useEffect(() => {
    try { window.localStorage.setItem(AI_CONF_STORAGE_KEY, String(aiConfidenceThreshold)); }
    catch { /* ignore quota / privacy mode */ }
  }, [aiConfidenceThreshold]);
  const isLowConfidence = (c: number | null | undefined) =>
    typeof c === "number" && Number.isFinite(c) && c < aiConfidenceThreshold;

  // Card mapping defaults (fallback do cartão) — vindos da tela de Mapeamento
  const { describe: describeCardMapping, isLoaded: cardMappingLoaded } = usePagCorpCardMapping(
    origin === "pagcorp" ? sapSession?.companyDB : undefined,
  );
  const [cardDefaultsApplied, setCardDefaultsApplied] = useState(false);
  const [mappingInfo, setMappingInfo] = useState<{
    status: CardMappingStatus;
    source: "card" | "fallback" | null;
    missingFields: string[];
    cardKey: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setCardDefaultsApplied(false);
      setMappingInfo(null);
      return;
    }
    if (cardDefaultsApplied) return;
    if (origin !== "pagcorp" || !prefill) return;
    // Aguarda o effect de prefill rodar primeiro (que reseta `items`),
    // senão nossas defaults são sobrescritas imediatamente.
    if (!initialized) return;
    // Aguarda carregar os mapeamentos do backend. Antes disso `rows=[]` faria
    // o modal concluir incorretamente que não existe mapeamento.
    if (!cardMappingLoaded) return;

    const info = describeCardMapping({
      cardLastDigits: prefill.cardLastDigits,
      cardId: prefill.cardId,
      cardName: prefill.cardName,
      accountAlias: prefill.accountAlias,
      accountName: prefill.accountName,
    });

    setMappingInfo({
      status: info.status,
      source: info.resolved.source,
      missingFields: info.missingFields,
      cardKey: info.cardKey,
    });

    if (info.status === "none") {
      // Nada para aplicar — apenas marca como tratado para não rodar de novo
      setCardDefaultsApplied(true);
      return;
    }

    const { costCenter, project, itemCode } = info.resolved;

    // Resolve options from SAP cache; if not found (cache vazio ou ainda
    // carregando), sintetiza uma opção mínima para que o valor apareça
    // selecionado mesmo assim — o usuário pode trocar depois.
    const ccOpt = costCenter
      ? costCenterOptions.find((o) => o.code === costCenter)
        || { code: costCenter, name: costCenter, extra: "" }
      : null;
    const prOpt = project
      ? projectOptions.find((o) => o.code === project)
        || { code: project, name: project, extra: "" }
      : null;
    const itOpt = itemCode
      ? itemOptions.find((o) => o.code === itemCode)
        || { code: itemCode, name: itemCode, extra: "" }
      : null;

    if (ccOpt) setHeaderCostCenter(ccOpt);
    if (prOpt) setHeaderProject(prOpt);
    setItems((prev) => prev.map((it) => ({
      ...it,
      ...(ccOpt ? { sapCostCenter: ccOpt, cost_center: ccOpt.code } : {}),
      ...(prOpt ? { sapProject: prOpt, project: prOpt.code } : {}),
      ...(itOpt && !it.sapItem ? { sapItem: itOpt, item_code: itOpt.code, description: it.description || itOpt.name } : {}),
    })));
    setCardDefaultsApplied(true);
  }, [
    open, origin, prefill, initialized, cardDefaultsApplied, describeCardMapping,
    cardMappingLoaded, costCenterOptions, projectOptions, itemOptions,
  ]);



  // Apply prefill when modal opens
  useEffect(() => {
    if (open && prefill && !initialized) {
      setInitialized(true);
      if (prefill.description) {
        setRemarks(prefill.description);
        setItems([{
          description: prefill.description,
          quantity: 1,
          unit_price: prefill.amount || 0,
          line_total: prefill.amount || 0,
          cost_center: "",
          project: "",
        }]);
      }
      if (prefill.accountAlias) {
        setSuggestedSupplierName(prefill.accountAlias);
        setAiSupplierData({ card_name: prefill.accountAlias });
      }
      const today = new Date().toISOString().slice(0, 10);
      setDocDate(today);
      setDueDate(today);

      if (prefill.triggerAI && prefill.receipts && prefill.receipts.length > 0) {
        setAiEnabled(true);
        setPendingPrefill(prefill);
      }
    }
  }, [open, prefill, initialized]);

  // Reset when modal closes (sempre, mesmo sem prefill). Se ainda houver
  // grupos com erro em cache (failedGroupsRef), preservamos o contexto de
  // retentativa — queueHistory, arquivos dos grupos com erro e o cache de
  // respostas da IA — para que o usuário possa reabrir o modal e clicar em
  // "Reenviar erros" sem perder os anexos nem refazer chamadas de IA.
  useEffect(() => {
    if (!open) {
      const hasFailedContext = failedGroupsRef.current.size > 0;
      setInitialized(false);
      setSupplier(null);
      setCurrency("");
      setCurrencyWarning(null);
      setCurrencyOptions(null);
      setDocDate("");
      setDueDate("");
      setRemarks("");
      setAiWarning(null);
      setSuggestedSupplierName(undefined);
      setAiSupplierData(null);
      setShowSupplierForm(false);
      setItems([{ description: "", quantity: 1, unit_price: 0, line_total: 0, cost_center: "", project: "" }]);
      setAiConfidence(null);
      setPendingPrefill(null);
      setHeaderCostCenter(null);
      setHeaderProject(null);
      setDraftId(null);
      setDraftHydrated(false);
      setDeferredGroups([]);
      setSupplierPicker(null);
      setJustCancelled(false);
      // A pausa também não deve sobreviver ao fechar do modal sem contexto.
      pausedRef.current = false;
      setIsPaused(false);
      aiInFlightRef.current = false;
      submitInFlightRef.current = false;
      if (hasFailedContext) {
        // Mantém: queueHistory, files (apenas dos grupos com erro),
        // failedGroupsRef, aiResponseCacheRef, claimedHashesRef, showQueueSummary=false.
        setShowQueueSummary(false);
        const failedFileNames = new Set<string>();
        for (const g of failedGroupsRef.current.values()) {
          for (const d of g.docs) failedFileNames.add(d.file.name);
        }
        setFiles((prev) => prev.filter((f) => failedFileNames.has(f.name)));
      } else {
        setFiles([]);
        setQueueHistory([]);
        setShowQueueSummary(false);
        aiResponseCacheRef.current = new Map();
        claimedHashesRef.current = new Set();
      }
    }
  }, [open]);

  // Ao reabrir o modal, avisa que ainda existe contexto de retentativa
  // preservado (grupos com erro + anexos + cache da IA), incentivando o uso
  // do botão "Reenviar erros" no banner sem refazer chamadas de IA.
  useEffect(() => {
    if (open && failedGroupsRef.current.size > 0 && queueHistory.some((e) => e.status === "failed")) {
      const n = failedGroupsRef.current.size;
      toast.info(
        `${n} grupo(s) com erro preservado(s) da sessão anterior. Use "Reenviar erros" para retentar sem chamar a IA de novo.`,
        { duration: 7000 },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Sempre que o modal abrir, força um refetch da lista de fornecedores/
  // clientes vindos do SAP. Isso garante que BPs criados agora (na tela de
  // Fornecedores ou por outro usuário) apareçam imediatamente como opção,
  // sem esperar o TTL do cache. A invalidação por eventos (invalidateSapCache)
  // cobre o cenário "criei o fornecedor com o modal já aberto"; esta chamada
  // cobre o cenário "criei o fornecedor e depois abri o modal".
  useEffect(() => {
    if (!open) return;
    reloadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Hidrata o cache em memória a partir do localStorage sempre que o modal
  // abre. Faz merge (persistido + entradas já vivas na sessão) para não
  // perder nada. Persistir sobrevive a fechar/reabrir o modal e a recarregar
  // a página — reaproveita extrações da IA por hash de conteúdo do arquivo.
  useEffect(() => {
    if (!open) return;
    try {
      const persisted = loadAiResponseCache(aiCacheScope);
      if (persisted.size === 0) return;
      const merged = aiResponseCacheRef.current;
      let added = 0;
      for (const [k, v] of persisted) {
        if (!merged.has(k)) {
          merged.set(k, v);
          added++;
        }
      }
      if (added > 0) {
        console.info(`[ai-cache] Hidratados ${added} item(s) do cache persistente (${aiCacheScope}).`);
      }
    } catch (e) {
      console.warn("[ai-cache] Falha ao hidratar cache persistente:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Encerra a sessão de retentativa quando todos os grupos reprocessados
  // saíram de "pending"/"queued" (mantém a barra visível por 4s para o usuário
  // ver o status final antes de desaparecer).
  useEffect(() => {
    if (!retryingKeys || retryingKeys.size === 0) return;
    const entries = queueHistory.filter((e) => retryingKeys.has(e.supplierKey));
    if (entries.length === 0) return;
    const stillRunning = entries.some((e) => e.status === "pending" || e.status === "queued");
    if (stillRunning) return;
    const t = setTimeout(() => setRetryingKeys(null), 4000);
    return () => clearTimeout(t);
  }, [queueHistory, retryingKeys]);

  // Hydrate from an existing draft when the user chose "Retomar"
  useEffect(() => {
    if (!open || !initialDraft || draftHydrated) return;
    const p = initialDraft.payload || {};
    setDraftId(initialDraft.id);
    setDraftHydrated(true);
    if (p.supplier) setSupplier(p.supplier);
    if (p.currency) setCurrency(p.currency);
    if (p.docDate) setDocDate(p.docDate);
    if (p.dueDate) setDueDate(p.dueDate);
    if (p.remarks) setRemarks(p.remarks);
    if (p.headerCostCenter) setHeaderCostCenter(p.headerCostCenter);
    if (p.headerProject) setHeaderProject(p.headerProject);
    if (Array.isArray(p.items) && p.items.length > 0) setItems(p.items);
    if (Array.isArray(p.fileNames) && p.fileNames.length > 0) {
      toast.info(`Reanexe ${p.fileNames.length} arquivo(s): ${p.fileNames.join(", ")}`, { duration: 8000 });
    }
    setInitialized(true);
    onDraftConsumed?.();
  }, [open, initialDraft, draftHydrated, onDraftConsumed]);

  // Autosave (debounced) while the modal is open and user has meaningful content
  useEffect(() => {
    if (!open) return;
    if (isCreating) return;
    const hasContent =
      !!supplier ||
      !!remarks.trim() ||
      items.some((it) => (it.description || "").trim() || Number(it.unit_price) > 0);
    if (!hasContent) return;
    const companyDb = sapSession?.companyDB;
    if (!companyDb) return;

    const draftTotal = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
    const previewParts = [
      supplier?.name || suggestedSupplierName || "(sem fornecedor)",
      items.length > 0 ? `${items.length} ite${items.length > 1 ? "ns" : "m"}` : null,
      draftTotal > 0 ? formatCurrency(draftTotal, currency || "BRL") : null,
    ].filter(Boolean);
    const preview = previewParts.join(" · ");

    const payload = {
      supplier,
      currency,
      docDate,
      dueDate,
      remarks,
      items,
      headerCostCenter,
      headerProject,
      fileNames: files.map((f) => f.name),
    };

    const t = setTimeout(async () => {
      const id = await saveDraft({
        docType: mode,
        companyDb,
        payload,
        preview,
        draftId,
      });
      if (id && id !== draftId) {
        setDraftId(id);
        onDraftSaved?.(id);
      } else if (id) {
        onDraftSaved?.(id);
      }
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isCreating, supplier, currency, docDate, dueDate, remarks, items, headerCostCenter, headerProject, files]);


  const extractUrlsFromObject = (obj: any): string[] => {
    const urls: string[] = [];
    if (!obj || typeof obj !== "object") return urls;
    const urlPattern = /^https?:\/\/.+/i;
    const imageExtPattern = /\.(jpg|jpeg|png|webp|gif|pdf|bmp|tiff)(\?|$)/i;

    const walk = (val: any) => {
      if (typeof val === "string" && urlPattern.test(val) && imageExtPattern.test(val)) {
        urls.push(val);
      } else if (Array.isArray(val)) {
        val.forEach(walk);
      } else if (val && typeof val === "object") {
        Object.values(val).forEach(walk);
      }
    };
    walk(obj);
    return urls;
  };

  const processReceiptsWithAI = async (receipts: any[]) => {
    setIsProcessing(true);
    setAiConfidence(null);
    try {
      // Collect all image/document URLs from receipts recursively
      const imageUrls: string[] = [];
      for (const receipt of receipts) {
        const found = extractUrlsFromObject(receipt);
        imageUrls.push(...found);
      }

      // Deduplicate
      const uniqueUrls = [...new Set(imageUrls)];

      if (uniqueUrls.length === 0) {
        // No image URLs found – log receipts structure for debugging
        console.warn("PagCorp receipts structure (no image URLs found):", JSON.stringify(receipts.slice(0, 2), null, 2));
        toast.info("Nenhuma imagem encontrada nos comprovantes. Anexe o documento manualmente e clique em processar com IA.");
        setIsProcessing(false);
        return;
      }

      // Download images and create files for AI processing
      const downloadedFiles: File[] = [];
      for (const url of uniqueUrls) {
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const blob = await resp.blob();
            const fileName = url.split("/").pop()?.split("?")[0] || "receipt.jpg";
            downloadedFiles.push(new File([blob], fileName, { type: blob.type || "image/jpeg" }));
          }
        } catch {
          console.warn("Failed to download receipt image:", url);
        }
      }

      if (downloadedFiles.length > 0) {
        setFiles(downloadedFiles);
        await processWithAI(downloadedFiles);
      } else {
        toast.info("Não foi possível baixar as imagens dos comprovantes. Anexe manualmente.");
      }
    } catch (e) {
      console.error("Receipt AI processing error:", e);
      toast.error("Erro ao processar comprovantes com IA");
    } finally {
      setIsProcessing(false);
    }
  };
  // Trigger AI for prefilled receipts after function is defined
  useEffect(() => {
    if (pendingPrefill && pendingPrefill.receipts && pendingPrefill.receipts.length > 0) {
      processReceiptsWithAI(pendingPrefill.receipts);
      setPendingPrefill(null);
    }
  }, [pendingPrefill]);


  const handleFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setFiles((prev) => [...prev, ...arr]);
    if (aiEnabled && arr.length > 0) {
      processWithAI([...files, ...arr]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Aplica UM grupo de documentos fiscais (todos do MESMO fornecedor).
  // Usa o primeiro doc como fonte do cabeçalho e concatena os itens de todos.
  const applyFiscalGroup = (docs: any[]) => {
    if (!docs.length) return;
    const doc = docs[0];

    if (doc.supplier_name) setSuggestedSupplierName(doc.supplier_name);
    const addr = doc.supplier_address || {};
    const country = (addr.country || doc.supplier_country || "BR")
      .toString()
      .toUpperCase()
      .slice(0, 2);
    setAiSupplierData({
      card_name: doc.supplier_name || "",
      federal_tax_id: doc.supplier_cnpj || doc.supplier_tax_id || "",
      email: doc.supplier_email || "",
      phone1: doc.supplier_phone1 || "",
      phone2: doc.supplier_phone2 || "",
      currency: doc.currency || "",
      bill_to_country: country,
      bill_to_street: addr.street || "",
      bill_to_building: addr.building || "",
      bill_to_block: addr.block || "",
      bill_to_zip: addr.zip
        ? country === "BR"
          ? String(addr.zip).replace(/\D/g, "")
          : String(addr.zip).trim()
        : "",
      bill_to_city: addr.city || "",
      bill_to_state: addr.state
        ? country === "BR"
          ? String(addr.state).toUpperCase().slice(0, 2)
          : String(addr.state).trim()
        : "",
    });
    if (doc.document_date) setDocDate(doc.document_date);
    if (doc.due_date) setDueDate(doc.due_date);
    if (doc.remarks) setRemarks(doc.remarks);
    const costCenterValue = (doc.cost_center_confidence ?? 0) > 0.95 ? (doc.cost_center_hint || "") : "";
    const projectValue = (doc.project_confidence ?? 0) > 0.95 ? (doc.project_hint || "") : "";

    // Concatena as linhas de TODOS os documentos do grupo (mesmo fornecedor).
    const allItems = docs.flatMap((d) => Array.isArray(d.items) ? d.items : []);
    if (allItems.length > 0) {
      setItems(
        allItems.map((item: any) => {
          const qty = Number(item.quantity) || 1;
          let unit = Number(item.unit_price) || 0;
          const lineTotalRaw = Number(item.line_total) || 0;
          if (unit === 0 && lineTotalRaw !== 0 && qty !== 0) unit = lineTotalRaw / qty;
          const lineTotal = lineTotalRaw !== 0 ? lineTotalRaw : qty * unit;
          return {
            description: item.description || "",
            quantity: qty,
            unit_price: unit,
            line_total: lineTotal,
            cost_center: costCenterValue,
            project: projectValue,
            item_code: item.item_code_match || "",
            sapItem: null,
            searchHint: item.item_search_hint || "",
          };
        }),
      );
      if (origin === "pagcorp") setCardDefaultsApplied(false);
    } else if (doc.total_amount && Number(doc.total_amount) > 0) {
      const fallbackDesc =
        doc.remarks || (doc.supplier_name ? `Despesa - ${doc.supplier_name}` : "Despesa");
      setItems([{
        description: fallbackDesc,
        quantity: 1,
        unit_price: Number(doc.total_amount),
        line_total: Number(doc.total_amount),
        cost_center: costCenterValue,
        project: projectValue,
        item_code: "",
        sapItem: null,
        searchHint: "",
      }]);
      if (origin === "pagcorp") setCardDefaultsApplied(false);
    }
    if (doc.confidence) setAiConfidence(doc.confidence);

    const warnings: string[] = [];
    if (doc.client_warning) warnings.push(doc.client_warning);
    if (doc.totals_warning) warnings.push(doc.totals_warning);
    setAiWarning(warnings.length ? warnings.join("\n\n") : null);
    for (const w of warnings) toast.warning(w, { duration: 8000 });
  };

  // Chave estável para agrupar documentos pelo mesmo fornecedor
  // (prioriza tax id normalizado; usa nome normalizado como fallback).
  const supplierKeyOf = (doc: any): string => {
    const taxRaw = String(doc?.supplier_cnpj || doc?.supplier_tax_id || "").replace(/\D+/g, "");
    if (taxRaw.length >= 8) return `tax:${taxRaw.length === 14 ? taxRaw.slice(0, 8) : taxRaw}`;
    const name = String(doc?.supplier_name || "").trim().toLowerCase();
    return name ? `name:${name}` : "unknown";
  };

  const processWithAI = async (filesToProcess: File[]) => {
    // Guard anti-duplicação: `isProcessing` (estado) + `aiInFlightRef` (síncrono).
    // O ref pega o intervalo entre o clique e o setState — evita 2ª chamada
    // após "cancelar → tentar novamente" quando o usuário clica duas vezes
    // rápido, ou quando o React 18 dispara o handler duas vezes no StrictMode.
    if (isProcessing || hasInFlightGuardTripped(aiInFlightRef)) {
      console.info(DEDUP_LOG, "processWithAI ignorado: já há chamada em vôo", {
        isProcessing,
        refFlag: aiInFlightRef.current,
        fileCount: filesToProcess?.length ?? 0,
      });
      return;
    }
    if (!filesToProcess || filesToProcess.length === 0) return;
    aiInFlightRef.current = true;
    console.info(DEDUP_LOG, "processWithAI START", {
      fileCount: filesToProcess.length,
      names: filesToProcess.map((f) => f.name),
    });
    setIsProcessing(true);
    // Reseta estado herdado de tentativas anteriores para que um retry
    // não mostre picker/warning/confidence obsoletos ao usuário.
    setAiConfidence(null);
    setAiWarning(null);
    setSupplierPicker(null);
    // Limpa o histórico da fila anterior — o retry começa "do zero" e vai
    // reconstruir o queueHistory quando a IA voltar com novos grupos.
    setQueueHistory([]);
    setJustCancelled(false);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      // Hash de cada arquivo em paralelo para checar o cache.
      const hashes = await Promise.all(filesToProcess.map((f) => hashFile(f)));
      const cache = aiResponseCacheRef.current;
      const cachedResults: (any | null)[] = hashes.map((h) => cache.get(h) ?? null);
      const missIndexes: number[] = [];
      cachedResults.forEach((r, i) => { if (r === null) missIndexes.push(i); });

      let fetchedResults: any[] = [];
      if (missIndexes.length > 0) {
        const formData = new FormData();
        missIndexes.forEach((i) => formData.append("files", filesToProcess[i]));
        formData.append("company_db", sapSession?.companyDB || "");

        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-expense-doc`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: formData,
            signal: controller.signal,
          },
        );

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({} as any));
          const detail = err?.error || `HTTP ${resp.status}`;
          const names = missIndexes.map((i) => filesToProcess[i].name).join(", ");
          throw new Error(
            missIndexes.length > 1
              ? `Falha ao processar ${missIndexes.length} anexo(s) (${names}): ${detail}`
              : `Falha ao processar "${names}": ${detail}`,
          );
        }

        const { result } = await resp.json();
        fetchedResults = Array.isArray(result) ? result : [result];

        // Preenche o cache pelos hashes dos arquivos que foram enviados.
        const persistBatch: Array<{ hash: string; data: unknown }> = [];
        missIndexes.forEach((origIdx, sentIdx) => {
          const extracted = fetchedResults[sentIdx];
          if (extracted && typeof extracted === "object") {
            cache.set(hashes[origIdx], extracted);
            persistBatch.push({ hash: hashes[origIdx], data: extracted });
          }
        });
        // Persiste no localStorage para reaproveitar após fechar/reabrir
        // o modal ou recarregar a página (best-effort, falhas silenciosas).
        if (persistBatch.length > 0) {
          saveAiResponseCacheEntries(aiCacheScope, persistBatch);
        }
      }

      // Compõe a lista final na ordem original: cache primeiro, fetch depois.
      const docs: any[] = filesToProcess.map((_, i) => {
        if (cachedResults[i] !== null) return cachedResults[i];
        const pos = missIndexes.indexOf(i);
        return pos >= 0 ? fetchedResults[pos] : null;
      });

      // Informa o usuário quando foi reaproveitado cache (sem chamada de IA).
      const cachedHits = filesToProcess.length - missIndexes.length;
      if (cachedHits > 0) {
        toast.info(
          missIndexes.length === 0
            ? `Todos os ${cachedHits} anexo(s) reaproveitados do cache da IA — nenhuma chamada nova foi feita.`
            : `${cachedHits} anexo(s) reaproveitados do cache; ${missIndexes.length} enviado(s) à IA.`,
          { duration: 5000 },
        );
      }

      // Casa cada `doc` extraído com o `File` correspondente (mesma ordem).
      // Se o servidor devolveu menos entradas do que arquivos, avisamos por
      // nome quais não voltaram — os arquivos ficam no modal para retry.
      const paired = filesToProcess.map((file, i) => ({ file, extracted: docs[i] }));
      const missing = paired.filter((p) => !p.extracted || typeof p.extracted !== "object");
      if (missing.length > 0) {
        toast.error(
          `Falha ao interpretar ${missing.length} anexo(s): ${missing.map((p) => p.file.name).join(", ")}. Reenvie os arquivos e tente processar novamente.`,
          { duration: 9000 },
        );
      }
      const valid = paired.filter((p) => p.extracted && typeof p.extracted === "object");

      // ─── Regra 3: não-fiscais viram só anexo ───────────────────────────
      const fiscal = valid.filter((p) => p.extracted?.is_fiscal_document !== false);
      const nonFiscal = valid.filter((p) => p.extracted?.is_fiscal_document === false);

      if (nonFiscal.length > 0) {
        toast.info(
          `${nonFiscal.length} anexo(s) sem conteúdo fiscal — serão salvos como anexo apenas: ${nonFiscal.map((p) => p.file.name).join(", ")}`,
          { duration: 7000 },
        );
      }

      if (fiscal.length === 0) {
        setAiWarning("Nenhum documento fiscal reconhecido — os arquivos ficarão apenas como anexo.");
        return;
      }

      // ─── Agrupa fiscais por fornecedor ────────────────────────────────
      const groupMap = new Map<string, DocGroup>();
      for (const p of fiscal) {
        const key = supplierKeyOf(p.extracted);
        const label = String(p.extracted?.supplier_name || "Fornecedor não identificado");
        const g = groupMap.get(key);
        if (g) g.docs.push(p);
        else groupMap.set(key, { supplierKey: key, supplierLabel: label, docs: [p] });
      }
      const groups = Array.from(groupMap.values());

      // ─── Regra 1: mesmo fornecedor → mescla linhas ────────────────────
      if (groups.length === 1) {
        applyFiscalGroup(groups[0].docs.map((d) => d.extracted));
        const nDocs = groups[0].docs.length;
        toast.success(
          nDocs > 1
            ? `${nDocs} documentos do mesmo fornecedor processados — todas as linhas foram mescladas.`
            : "Documento processado pela IA! Valide o fornecedor e os itens nos campos abaixo.",
        );
        return;
      }

      // ─── Regra 2: fornecedores diferentes → perguntar ao usuário ──────
      setSupplierPicker({
        groups,
        nonFiscal: nonFiscal.map((p) => p.file),
      });
    } catch (e) {
      // Cancelamento explícito pelo usuário: silencioso, sem toast de erro.
      if ((e as any)?.name === "AbortError" || controller.signal.aborted) {
        setSupplierPicker(null);
        setAiConfidence(null);
        setAiWarning(null);
        return;
      }
      console.error("AI processing error:", e);
      // Garante estado limpo para um novo retry (sem picker/warning presos).
      setSupplierPicker(null);
      setAiConfidence(null);
      const msg = e instanceof Error ? e.message : "Erro ao processar com IA";
      toast.error(`${msg} — os arquivos foram mantidos no modal, clique em processar novamente.`, {
        duration: 9000,
      });
    } finally {
      if (aiAbortRef.current === controller) aiAbortRef.current = null;
      setIsProcessing(false);
      aiInFlightRef.current = false;
      console.info(DEDUP_LOG, "processWithAI END");
    }
  };

  // Snapshot de um DocGroup para exibição na fila: contagem de arquivos,
  // linhas, total estimado, moeda(s), confiança média e avisos coletados
  // dos documentos extraídos pela IA.
  const summarizeGroup = (g: DocGroup): Omit<QueueEntry, "status" | "errorMessage"> => {
    const fileNames = g.docs.map((d) => d.file.name);
    const lineCount = g.docs.reduce(
      (acc, d) => acc + (Array.isArray(d.extracted?.items) ? d.extracted.items.length : 0),
      0,
    );
    const estimatedTotal = g.docs.reduce((acc, d) => {
      const items = Array.isArray(d.extracted?.items) ? d.extracted.items : [];
      const sumItems = items.reduce((s: number, it: any) => {
        const lt = Number(it?.line_total);
        if (Number.isFinite(lt) && lt !== 0) return s + lt;
        const qty = Number(it?.quantity) || 0;
        const up = Number(it?.unit_price) || 0;
        return s + qty * up;
      }, 0);
      if (sumItems > 0) return acc + sumItems;
      return acc + (Number(d.extracted?.total_amount) || 0);
    }, 0);
    const currencies = Array.from(
      new Set(
        g.docs.map((d) => String(d.extracted?.currency || "").toUpperCase()).filter(Boolean),
      ),
    );
    const confidences = g.docs
      .map((d) => Number(d.extracted?.confidence))
      .filter((n) => Number.isFinite(n) && n > 0);
    const aiConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;
    const aiWarnings: string[] = [];
    for (const d of g.docs) {
      if (d.extracted?.client_warning) aiWarnings.push(String(d.extracted.client_warning));
      if (d.extracted?.totals_warning) aiWarnings.push(String(d.extracted.totals_warning));
    }
    return {
      supplierKey: g.supplierKey,
      supplierLabel: g.supplierLabel,
      fileCount: g.docs.length,
      fileNames,
      lineCount,
      estimatedTotal,
      currency: currencies[0] || "BRL",
      currencies,
      aiConfidence,
      aiWarnings,
    };
  };

  // Atualiza o status de uma entrada da fila pela chave do fornecedor.
  // Procura o DocGroup original (com arquivos + extração da IA) para uma
  // dada entry da fila. Verifica todos os caches onde ele pode estar vivo:
  // grupo atual em edição, deferidos, cancelados e com falha.
  const findDocGroupByKey = (supplierKey: string): DocGroup | null => {
    if (currentGroupRef.current?.supplierKey === supplierKey) return currentGroupRef.current;
    const inDeferred = deferredGroups.find((g) => g.supplierKey === supplierKey);
    if (inDeferred) return inDeferred;
    const inCancelled = cancelledGroupsRef.current.find((g) => g.supplierKey === supplierKey);
    if (inCancelled) return inCancelled;
    const inFailed = failedGroupsRef.current.get(supplierKey);
    if (inFailed) return inFailed;
    return null;
  };

  const openDetailsFor = (entry: QueueEntry) => {
    // Zera filtros para a nova visualização — evita "resultado vazio"
    // herdado da inspeção anterior quando o usuário abre outro grupo.
    setDetailsSearch("");
    setDetailsTypeFilter("all");
    setDetailsConfidenceFilter("all");
    setDetailsView({ entry, group: findDocGroupByKey(entry.supplierKey) });
  };

  const updateQueueEntry = (key: string, patch: Partial<QueueEntry>) => {
    setQueueHistory((prev) => prev.map((e) => (e.supplierKey === key ? { ...e, ...patch } : e)));
  };

  // Cancela o processamento IA em andamento e/ou limpa a fila de fornecedores
  // adiados (deferredGroups) + picker aberto, deixando o modal em estado
  // consistente para o usuário continuar preenchendo manualmente.
  const cancelProcessingAndQueue = () => {
    const hadQueue = deferredGroups.length > 0;
    const hadPicker = !!supplierPicker;
    const wasProcessing = isProcessing;
    try {
      aiAbortRef.current?.abort();
    } catch {
      /* ignore */
    }
    aiAbortRef.current = null;
    // Guarda cache do que estava pendente/enfileirado ANTES de limpar, para
    // permitir "Retomar fila" depois. Inclui o grupo atual em edição, se ele
    // ainda estivesse pendente (não tinha errorMessage).
    const currentPending = queueHistory.find((e) => e.status === "pending");
    const cached: DocGroup[] = [];
    if (
      currentPending &&
      !currentPending.errorMessage &&
      currentGroupRef.current &&
      currentGroupRef.current.supplierKey === currentPending.supplierKey
    ) {
      cached.push(currentGroupRef.current);
    }
    cached.push(...deferredGroups);
    cancelledGroupsRef.current = cached;
    setDeferredGroups([]);
    schedulePersist();
    setSupplierPicker(null);
    setAiWarning(null);
    setAiConfidence(null);
    setIsProcessing(false);
    setCancelConfirm(false);
    // Habilita o botão "Tentar novamente" se ainda houver anexos no modal.
    setJustCancelled(files.length > 0);
    // Marca no histórico tudo que estava pendente/enfileirado como cancelado
    // e abre o resumo final para o usuário conferir o que foi processado.
    setQueueHistory((prev) => {
      const now = Date.now();
      const next = prev.map((e) =>
        e.status === "pending" || e.status === "queued"
          ? { ...e, status: "cancelled" as QueueStatus, completedAt: e.completedAt ?? now }
          : e,
      );
      if (next.length > 0) setShowQueueSummary(true);
      return next;
    });
    const parts: string[] = [];
    if (wasProcessing) parts.push("classificação IA");
    if (hadPicker) parts.push("seleção de fornecedor");
    if (hadQueue) parts.push("fila de despesas encadeadas");
    toast.info(
      parts.length > 0
        ? `Cancelado: ${parts.join(", ")}. Os anexos permanecem no modal para você continuar manualmente.`
        : "Processamento cancelado.",
      { duration: 6000 },
    );
  };

  // Retoma a fila a partir do próximo grupo cancelado (mantém os concluídos
  // com sucesso intactos e não roda a IA de novo — reaproveita os DocGroup
  // em cache). Se algum grupo com falha estiver adiante, "Reenviar apenas
  // erros" continua sendo o caminho — este botão foca em resumir a fila.
  // Estrutura do plano de retomada calculado ANTES de disparar a fila. O
  // preview vira uma prévia visual (dialog) para o usuário conferir o que
  // vai acontecer com cada grupo (retomar / pular por já concluído / pular
  // por duplicata / permanecer inalterado).
  type ResumeAction =
    | { kind: "resume-first"; group: DocGroup }
    | { kind: "resume-queued"; group: DocGroup }
    | { kind: "skip-done"; group: DocGroup }
    | { kind: "skip-duplicate"; group: DocGroup; owner?: string }
    | { kind: "not-in-cancelled" };
  interface ResumePlan {
    reasons: Map<string, ResumeAction>;
    toResume: DocGroup[];
    skippedDone: DocGroup[];
    skippedDuplicate: Array<{ group: DocGroup; owner?: string }>;
    preCheckFailed: boolean;
  }
  const [resumePlan, setResumePlan] = useState<ResumePlan | null>(null);
  const [resumeChecking, setResumeChecking] = useState(false);

  // ─── Persistência do estado da fila (IndexedDB) ─────────────────────
  // Sobrevive a F5 / fechar aba / trocar de página. Escopo separado para
  // despesas vs. pedidos de venda para não misturarem entre si.
  const queueScope: QueueScope = isSales ? "sales" : "expenses";
  const queueHydratedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serializeGroups = useCallback((groups: DocGroup[]): PersistedDocGroup[] =>
    groups.map((g) => ({
      supplierKey: g.supplierKey,
      supplierLabel: g.supplierLabel,
      docs: g.docs.map((d) => ({ file: toPersistedFile(d.file), extracted: d.extracted })),
    })), []);

  const deserializeGroups = useCallback((groups: PersistedDocGroup[]): DocGroup[] =>
    groups.map((g) => ({
      supplierKey: g.supplierKey,
      supplierLabel: g.supplierLabel,
      docs: g.docs.map((d) => ({ file: fromPersistedFile(d.file), extracted: d.extracted })),
    })), []);

  // Grava snapshot (debounced 400ms) do estado inteiro da fila.
  const schedulePersist = useCallback(() => {
    if (!queueHydratedRef.current) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const failedGroups = Array.from(failedGroupsRef.current.values());
      const cancelledGroups = cancelledGroupsRef.current;
      const hasAny =
        queueHistory.length > 0 ||
        deferredGroups.length > 0 ||
        failedGroups.length > 0 ||
        cancelledGroups.length > 0;
      if (!hasAny) {
        void clearQueueState(queueScope);
        return;
      }
      void saveQueueState(queueScope, {
        queueHistory,
        deferredGroups: serializeGroups(deferredGroups),
        failedGroups: serializeGroups(failedGroups),
        cancelledGroups: serializeGroups(cancelledGroups),
        savedAt: Date.now(),
      });
    }, 400);
  }, [queueHistory, deferredGroups, queueScope, serializeGroups]);

  // Dispara a gravação sempre que queueHistory/deferredGroups mudam
  // (mutações em refs failed/cancelled chamam schedulePersist manualmente).
  useEffect(() => { schedulePersist(); }, [schedulePersist]);

  // Hidratação: ao abrir o modal, se houver estado persistido e a fila
  // atual estiver vazia, restaura tudo. Só roda uma vez por sessão do modal.
  useEffect(() => {
    if (!open) { queueHydratedRef.current = false; return; }
    if (queueHydratedRef.current) return;
    let cancelledFlag = false;
    (async () => {
      const saved = await loadQueueState<QueueEntry>(queueScope);
      if (cancelledFlag) return;
      queueHydratedRef.current = true;
      if (!saved) return;
      const hasInMemory =
        queueHistory.length > 0 ||
        deferredGroups.length > 0 ||
        failedGroupsRef.current.size > 0 ||
        cancelledGroupsRef.current.length > 0;
      if (hasInMemory) return;
      const deferred = deserializeGroups(saved.deferredGroups);
      const failed = deserializeGroups(saved.failedGroups);
      const cancelledG = deserializeGroups(saved.cancelledGroups);
      setQueueHistory(saved.queueHistory);
      setDeferredGroups(deferred);
      failedGroupsRef.current = new Map(failed.map((g) => [g.supplierKey, g]));
      cancelledGroupsRef.current = cancelledG;
      const seen = new Set<string>();
      const restoredFiles: File[] = [];
      for (const g of [...failed, ...deferred, ...cancelledG]) {
        for (const d of g.docs) {
          const k = `${d.file.name}::${d.file.size}::${d.file.lastModified}`;
          if (seen.has(k)) continue;
          seen.add(k);
          restoredFiles.push(d.file);
        }
      }
      if (restoredFiles.length > 0) setFiles((prev) => (prev.length > 0 ? prev : restoredFiles));
      if (saved.queueHistory.length > 0 || restoredFiles.length > 0) {
        toast.info(
          `Fila anterior restaurada (${saved.queueHistory.length} registro(s), ${restoredFiles.length} anexo(s)). Use "Reenviar erros" ou "Retomar fila" para continuar.`,
          { duration: 8000 },
        );
      }
    })();
    return () => { cancelledFlag = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queueScope]);

  // Prepara o plano de retomada: aplica as duas verificações (já concluído
  // e duplicidade de hash) SEM alterar o estado da fila. Abre o dialog com
  // as ações por grupo para o usuário confirmar antes de disparar.
  const openResumePreview = async () => {
    const groups = cancelledGroupsRef.current;
    if (!groups || groups.length === 0) {
      toast.error("Nenhum grupo cancelado disponível para retomar.");
      return;
    }
    setResumeChecking(true);
    const reasons = new Map<string, ResumeAction>();
    const successKeys = new Set(
      queueHistory.filter((e) => e.status === "success").map((e) => e.supplierKey),
    );
    const skippedDone: DocGroup[] = [];
    const notYetDone: DocGroup[] = [];
    for (const g of groups) {
      if (successKeys.has(g.supplierKey)) {
        skippedDone.push(g);
        reasons.set(g.supplierKey, { kind: "skip-done", group: g });
      } else {
        notYetDone.push(g);
      }
    }
    const toResume: DocGroup[] = [];
    const skippedDuplicate: Array<{ group: DocGroup; owner?: string }> = [];
    let preCheckFailed = false;
    try {
      const perGroupHashes = await Promise.all(
        notYetDone.map(async (g) => ({
          group: g,
          hashes: await Promise.all(g.docs.map((d) => hashFileContent(d.file))),
        })),
      );
      const allHashes = perGroupHashes.flatMap((x) => x.hashes);
      const existing = allHashes.length > 0
        ? await findExistingClaims(supabase, Array.from(new Set(allHashes)))
        : [];
      const claimedSet = new Map(existing.map((e) => [e.file_hash, e.submitted_by] as const));
      for (const { group, hashes } of perGroupHashes) {
        const hit = hashes.find((h) => claimedSet.has(h));
        if (hit) {
          const owner = claimedSet.get(hit);
          skippedDuplicate.push({ group, owner });
          reasons.set(group.supplierKey, { kind: "skip-duplicate", group, owner });
        } else {
          toResume.push(group);
        }
      }
    } catch (err) {
      console.warn("[resume] pré-check de duplicidade falhou:", err);
      preCheckFailed = true;
      toResume.push(...notYetDone);
    }
    toResume.forEach((g, idx) => {
      reasons.set(
        g.supplierKey,
        idx === 0 ? { kind: "resume-first", group: g } : { kind: "resume-queued", group: g },
      );
    });
    // Grupos do histórico que NÃO estavam na fila cancelada — permanecem
    // como estão (rótulo neutro para deixar claro que não serão tocados).
    for (const e of queueHistory) {
      if (!reasons.has(e.supplierKey)) {
        reasons.set(e.supplierKey, { kind: "not-in-cancelled" });
      }
    }
    setResumePlan({ reasons, toResume, skippedDone, skippedDuplicate, preCheckFailed });
    setResumeChecking(false);
  };

  // Aplica o plano confirmado: dispara efetivamente a retomada da fila.
  const applyResumePlan = (plan: ResumePlan) => {
    const remaining = plan.toResume;
    setResumePlan(null);
    if (remaining.length === 0) {
      cancelledGroupsRef.current = [];
      setJustCancelled(false);
      if (plan.skippedDuplicate.length > 0) {
        setQueueHistory((prev) => prev.map((e) => {
          if (plan.skippedDuplicate.some((c) => c.group.supplierKey === e.supplierKey)) {
            return { ...e, status: "success" as QueueStatus, errorMessage: undefined };
          }
          return e;
        }));
      }
      toast.info(
        `Nada para retomar: ${plan.skippedDone.length} já concluído(s), ${plan.skippedDuplicate.length} duplicata(s).`,
        { duration: 7000 },
      );
      return;
    }
    const [first, ...rest] = remaining;
    setQueueHistory((prev) => prev.map((e) => {
      if (e.supplierKey === first.supplierKey) {
        return { ...e, status: "pending", errorMessage: undefined };
      }
      if (rest.some((g) => g.supplierKey === e.supplierKey)) {
        return { ...e, status: "queued", errorMessage: undefined };
      }
      if (plan.skippedDuplicate.some((c) => c.group.supplierKey === e.supplierKey)) {
        return { ...e, status: "success" as QueueStatus, errorMessage: undefined };
      }
      return e;
    }));
    setDeferredGroups(rest);
    resetFormForNextDeferred(first);
    cancelledGroupsRef.current = [];
    setShowQueueSummary(false);
    setJustCancelled(false);
    const parts = [`Retomando fila a partir de ${first.supplierLabel}`];
    if (rest.length > 0) parts.push(`(+${rest.length} depois)`);
    if (plan.skippedDone.length > 0) parts.push(`· ${plan.skippedDone.length} já concluído(s)`);
    if (plan.skippedDuplicate.length > 0) parts.push(`· ${plan.skippedDuplicate.length} duplicata(s)`);
    if (plan.preCheckFailed) parts.push("· pré-check falhou, servidor barrará duplicatas");
    toast.info(parts.join(" "), { duration: 7000 });
  };

  // Alias mantido para compatibilidade com callers existentes — agora abre a
  // prévia em vez de disparar direto.
  const resumeCancelledQueue = () => { void openResumePreview(); };

  // Pausa "leve": só marca a flag; a interrupção acontece no próximo ponto
  // seguro (após o grupo em edição ser salvo). NÃO aborta IA em andamento
  // — para isso o usuário deve usar "Cancelar" (que preserva a fila
  // cancelada para retomada posterior via "Retomar fila").
  const pauseProcessing = () => {
    pausedRef.current = true;
    setIsPaused(true);
    const nextLabel = deferredGroups[0]?.supplierLabel;
    toast.info(
      nextLabel
        ? `Pausa solicitada. Após concluir o grupo atual, a fila para em "${nextLabel}".`
        : "Pausa solicitada. A fila para após o grupo atual.",
      { duration: 6000 },
    );
  };

  // Retoma da pausa: pega o próximo deferredGroup e abre o formulário nele,
  // exatamente como o auto-avanço faria — sem tocar em concluídos, erros
  // ou cancelados.
  const resumeFromPause = () => {
    pausedRef.current = false;
    setIsPaused(false);
    if (deferredGroups.length === 0) {
      toast.info("Nenhum grupo pendente na fila para retomar.");
      return;
    }
    const [next, ...rest] = deferredGroups;
    setDeferredGroups(rest);
    resetFormForNextDeferred(next);
    updateQueueEntry(next.supplierKey, { status: "pending", promotedAt: Date.now() });
    setShowQueueSummary(false);
    toast.info(
      `Retomado: ${next.supplierLabel}${rest.length > 0 ? ` (+${rest.length} depois)` : ""}.`,
      { duration: 6000 },
    );
  };

  // Chamado quando o usuário escolhe, no picker, qual grupo cria primeiro.
  const chooseFirstSupplierGroup = (chosenKey: string) => {
    if (!supplierPicker) return;
    const chosen = supplierPicker.groups.find((g) => g.supplierKey === chosenKey);
    const rest = supplierPicker.groups.filter((g) => g.supplierKey !== chosenKey);
    if (!chosen) return;

    // Anexos ativos = arquivos do grupo escolhido + não-fiscais soltos.
    // Os arquivos dos grupos adiados ficam guardados em `deferredGroups`
    // e voltam a aparecer no modal quando reabrirmos para eles.
    const chosenFiles = chosen.docs.map((d) => d.file);
    setFiles([...chosenFiles, ...supplierPicker.nonFiscal]);
    applyFiscalGroup(chosen.docs.map((d) => d.extracted));
    setDeferredGroups(rest);
    setSupplierPicker(null);
    currentGroupRef.current = chosen;
    // Nova execução da fila: limpa cache de erros e cancelamentos anteriores.
    failedGroupsRef.current = new Map();
    cancelledGroupsRef.current = [];
    // Inicializa o histórico da fila com todos os fornecedores despachados,
    // marcando o escolhido como "pendente" (em andamento) e os demais como
    // "enfileirados". Preserva a ordem de execução.
    const now = Date.now();
    setQueueHistory([
      { ...summarizeGroup(chosen), status: "pending", classifiedAt: now, promotedAt: now },
      ...rest.map((g) => ({ ...summarizeGroup(g), status: "queued" as QueueStatus, classifiedAt: now })),
    ]);
    toast.success(
      `Criando 1º: ${chosen.supplierLabel}. Ao terminar, abriremos ${rest.length} nova(s) despesa(s) para os demais fornecedores.`,
      { duration: 7000 },
    );
  };


  // Encadeia a próxima despesa quando existem grupos adiados de anexos com
  // fornecedores diferentes. Zera cabeçalho/itens/anexos/rascunho e aplica
  // o grupo pendente ao formulário — o modal segue aberto.
  const resetFormForNextDeferred = (next: DocGroup) => {
    setSupplier(null);
    setSuggestedSupplierName(undefined);
    setAiSupplierData(null);
    setCurrency("");
    setCurrencyWarning(null);
    setCurrencyOptions(null);
    setDocDate("");
    setDueDate("");
    setRemarks("");
    setHeaderCostCenter(null);
    setHeaderProject(null);
    setAiWarning(null);
    setAiConfidence(null);
    setItems([{ description: "", quantity: 1, unit_price: 0, line_total: 0, cost_center: "", project: "" }]);
    setFiles(next.docs.map((d) => d.file));
    setDraftId(null);
    applyFiscalGroup(next.docs.map((d) => d.extracted));
    currentGroupRef.current = next;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  const updateItem = (index: number, field: string, value: string | number) => {
    setItems((prev) => {
      const updated = [...prev];
      (updated[index] as any)[field] = value;
      if (field === "quantity" || field === "unit_price") {
        updated[index].line_total = Number(updated[index].quantity) * Number(updated[index].unit_price);
      }
      return updated;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, {
      description: "",
      quantity: 1,
      unit_price: 0,
      line_total: 0,
      cost_center: headerCostCenter?.code || "",
      project: headerProject?.code || "",
      sapCostCenter: headerCostCenter || null,
      sapProject: headerProject || null,
    }]);
  };

  const applyHeaderCostCenter = (val: SapSearchOption | null) => {
    setHeaderCostCenter(val);
    setItems((prev) => prev.map((it) => ({
      ...it,
      sapCostCenter: val,
      cost_center: val?.code || "",
    })));
  };

  const applyHeaderProject = (val: SapSearchOption | null) => {
    setHeaderProject(val);
    setItems((prev) => prev.map((it) => ({
      ...it,
      sapProject: val,
      project: val?.code || "",
    })));
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const total = items.reduce((sum, item) => sum + item.line_total, 0);

  const DEFAULT_MULTI_CURRENCIES = ["BRL", "EUR", "USD", "CAD", "CHF", "GBP"];

  const fetchSupplierCurrencies = useCallback(async (cardCode: string) => {
    setLoadingCurrencies(true);
    try {
      if (!sapSession) throw new Error("no session");
      const { data } = await sapQuery(
        sapSession,
        `BusinessPartners('${encodeURIComponent(cardCode)}')/BPCurrencies`,
        { $select: "Currency" },
      );
      const rows = (data as any)?.value || (data as any) || [];
      const list = Array.from(
        new Set(
          (Array.isArray(rows) ? rows : [])
            .map((r: any) => String(r.Currency || "").trim().toUpperCase())
            .filter((c: string) => /^[A-Z]{3}$/.test(c)),
        ),
      );
      setCurrencyOptions(list.length > 0 ? list : DEFAULT_MULTI_CURRENCIES);
    } catch {
      setCurrencyOptions(DEFAULT_MULTI_CURRENCIES);
    } finally {
      setLoadingCurrencies(false);
    }
  }, [sapSession]);

  const handleSupplierChange = (val: SapSearchOption | null) => {
    setSupplier(val);
    setCurrencyWarning(null);
    setCurrencyOptions(null);
    if (val) {
      const supplierCurrency = ((val as any).currency || "").trim();
      if (supplierCurrency && supplierCurrency !== "##") {
        setCurrency(supplierCurrency);
      } else if (supplierCurrency === "##") {
        // Multi-currency supplier: let user choose
        setCurrency("");
        if (val.code) void fetchSupplierCurrencies(val.code);
        else setCurrencyOptions(DEFAULT_MULTI_CURRENCIES);
      } else {
        setCurrency("");
        setCurrencyWarning(`O fornecedor "${val.name}" não possui moeda configurada no cadastro do SAP. O lançamento não poderá ser realizado até que essa inconsistência seja corrigida.`);
        toast.error("Fornecedor sem moeda cadastrada no SAP. Corrija o cadastro antes de prosseguir.", { duration: 6000 });
      }
    } else {
      setCurrency("");
    }
  };

  const handleSubmit = async () => {
    if (!supplier) {
      toast.error("Informe o fornecedor");
      return;
    }
    if (!currency) {
      toast.error("Moeda é obrigatória. Selecione um fornecedor com moeda cadastrada.");
      return;
    }
    if (!docDate) {
      toast.error("Informe a data do documento");
      return;
    }
    if (!dueDate) {
      toast.error("Informe a data de vencimento");
      return;
    }
    if (items.some((i) => !i.description.trim())) {
      toast.error("Todos os itens devem ter descrição");
      return;
    }
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const n = idx + 1;
      if (!it.item_code || !String(it.item_code).trim()) {
        toast.error(`Item ${n}: código do item é obrigatório`);
        return;
      }
      if (!Number(it.quantity) || Number(it.quantity) <= 0) {
        toast.error(`Item ${n}: quantidade deve ser maior que zero`);
        return;
      }
      if (!Number(it.unit_price) || Number(it.unit_price) <= 0) {
        toast.error(`Item ${n}: valor unitário deve ser maior que zero`);
        return;
      }
      if (!it.cost_center || !String(it.cost_center).trim()) {
        toast.error(`Item ${n}: centro de custo é obrigatório`);
        return;
      }
    }
    // Em pedidos de venda, o centro de custo é propriedade da linha no SAP —
    // não exigimos CC padrão no cabeçalho (as linhas já foram validadas acima).
    if (!isSales && !headerCostCenter?.code) {
      toast.error("Centro de custo (padrão) é obrigatório");
      return;
    }
    // Guard duro anti-double-submit: `isCreating` (estado) protege a UI, mas
    // um duplo clique rápido cabe na janela entre o clique e o setState —
    // o ref pega isso. Rejeita silenciosamente com log auditável.
    if (hasInFlightGuardTripped(submitInFlightRef) || isCreating) {
      console.info(DEDUP_LOG, "handleSubmit ignorado: já há criação em vôo", {
        isCreating,
        refFlag: submitInFlightRef.current,
      });
      return;
    }
    submitInFlightRef.current = true;
    setIsCreating(true);

    // ---- Dedup cross-user: hash dos anexos e checagem antes do onCreate ----
    // Objetivo: se outro usuário (ou este mesmo) já lançou uma despesa com
    // qualquer um destes arquivos, o backend bloqueia antes de gastar a
    // chamada de criação. `fail-closed`: se a consulta falhar, aborta.
    let fileHashes: string[] = [];
    if (files.length > 0) {
      try {
        fileHashes = await Promise.all(files.map((f) => hashFileContent(f)));
        const novel = fileHashes.filter((h) => !claimedHashesRef.current.has(h));
        if (novel.length > 0) {
          const existing = await findExistingClaims(supabase, novel);
          if (existing.length > 0) {
            const names = existing
              .map((e) => e.file_name || e.file_hash.slice(0, 8))
              .join(", ");
            console.warn(DEDUP_LOG, "duplicata cross-user detectada", { existing });
            toast.error(
              `Este documento já foi lançado por outro usuário: ${names}. ` +
                `Remova o anexo duplicado ou verifique com o responsável antes de continuar.`,
              { duration: 10000 },
            );
            submitInFlightRef.current = false;
            setIsCreating(false);
            return;
          }
        }
      } catch (e) {
        console.error(DEDUP_LOG, "verificação de duplicata falhou (abortando submit):", e);
        toast.error("Não foi possível verificar duplicidade dos anexos. Tente novamente.");
        submitInFlightRef.current = false;
        setIsCreating(false);
        return;
      }
    }

    console.info(DEDUP_LOG, "handleSubmit START", {
      supplier: supplier.name,
      fileCount: files.length,
      hashes: fileHashes.map((h) => h.slice(0, 12)),
    });

    // Marca o início do submit no histórico da fila (usado no relatório
    // de fluxo de compras — mede tempo do form até o clique em Salvar).
    {
      const pending = queueHistory.find((e) => e.status === "pending");
      if (pending) updateQueueEntry(pending.supplierKey, { submittedAt: Date.now() });
    }

    try {
      await onCreate({
        supplier_name: supplier.name,
        supplier_code: supplier.code || undefined,
        currency: currency || undefined,
        cost_center: headerCostCenter?.code || undefined,
        project: headerProject?.code || undefined,
        remarks: remarks || undefined,
        origin,
        skipRules,
        doc_type: mode,
        doc_date: docDate || undefined,
        due_date: dueDate || undefined,
        rateio_type: !isSales ? rateioType : undefined,
        items: items.map(({ sapItem, sapCostCenter, sapProject, searchHint, ...rest }) => rest),
        files: files.length > 0 ? files : undefined,
      });

      // Reivindica os hashes APÓS sucesso — se o insert falhar por corrida,
      // apenas logamos (a despesa foi criada; a colisão vira aviso no próximo
      // submit que tocar o mesmo arquivo).
      if (fileHashes.length > 0) {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (uid) {
          const res = await claimDocumentHashes(
            supabase,
            uid,
            fileHashes.map((h, i) => ({
              fileHash: h,
              fileName: files[i]?.name,
              fileSize: files[i]?.size,
              companyDb: sapSession?.companyDB ?? null,
              docType: mode,
              supplierLabel: supplier.name,
            })),
          );
          if (res.conflict) {
            console.warn(DEDUP_LOG, "claim colidiu após create (corrida com outro usuário)");
          } else {
            fileHashes.forEach((h) => claimedHashesRef.current.add(h));
          }
        }
      }
      toast.success(isSales ? "Pedido de venda criado com sucesso!" : "Despesa criada com sucesso!");

      // Documento integrado ao ERP SEM anexo → notifica fiscal@anagaming.com.br
      // com o resumo do lançamento para que o time solicite o anexo depois.
      // Best-effort: falha aqui NÃO deve reverter a criação já concluída.
      if (!files || files.length === 0) {
        try {
          const { data: userRes } = await supabase.auth.getUser();
          const requester = userRes?.user;
          const requesterName =
            (requester?.user_metadata?.full_name as string | undefined) ||
            (requester?.user_metadata?.name as string | undefined) ||
            null;
          await notifyFiscalMissingAttachment({
            docType: mode,
            supplierName: supplier.name,
            supplierCode: supplier.code || undefined,
            currency: currency || undefined,
            docDate: docDate || undefined,
            dueDate: dueDate || undefined,
            costCenter: headerCostCenter?.code || undefined,
            project: headerProject?.code || undefined,
            remarks: remarks || undefined,
            origin,
            companyDb: sapSession?.companyDB ?? null,
            requesterName,
            requesterEmail: requester?.email ?? null,
            items: items.map((it) => ({
              description: it.description,
              quantity: Number(it.quantity) || 0,
              unit_price: Number(it.unit_price) || 0,
              line_total: Number(it.line_total) || 0,
              cost_center: it.cost_center || undefined,
              project: it.project || undefined,
            })),
          });
          toast.info("Documento sem anexo — fiscal@anagaming.com.br foi notificado.", { duration: 6000 });
        } catch (notifyErr) {
          console.warn("[fiscal-notify] Falha ao notificar fiscal sobre lançamento sem anexo:", notifyErr);
          toast.warning(
            "Lançamento criado, mas não foi possível notificar o fiscal por e-mail. Encaminhe manualmente se necessário.",
            { duration: 8000 },
          );
        }
      }
      if (draftId) {
        void deleteDraft(draftId);
        setDraftId(null);
      }

      // Marca no histórico da fila o grupo atual como concluído com sucesso
      // e limpa a marca de falha (caso fosse um retry de erro).
      const currentEntry = queueHistory.find((e) => e.status === "pending");
      if (currentEntry) {
        updateQueueEntry(currentEntry.supplierKey, { status: "success", errorMessage: undefined, completedAt: Date.now() });
        failedGroupsRef.current.delete(currentEntry.supplierKey);
        schedulePersist();
      }

      // Se houver grupos de fornecedores adiados (regra 2 — anexos com
      // fornecedores diferentes), abrimos automaticamente o próximo em vez
      // de fechar o modal, mantendo o encadeamento pedido pelo usuário.
      if (deferredGroups.length > 0) {
        // Pausa — não auto-avança. Mostra o resumo para o usuário ver o
        // estado e retomar quando quiser. `deferredGroups` intacto: o
        // próximo permanece "queued", pronto para o botão "Retomar".
        if (pausedRef.current) {
          toast.info(
            `Processamento pausado. Próximo pendente: ${deferredGroups[0].supplierLabel}. Clique em "Retomar" quando quiser continuar.`,
            { duration: 8000 },
          );
          setShowQueueSummary(true);
          return;
        }
        const [next, ...rest] = deferredGroups;
        resetFormForNextDeferred(next);
        setDeferredGroups(rest);
        // Promove a próxima entrada do histórico para "pendente".
        updateQueueEntry(next.supplierKey, { status: "pending", promotedAt: Date.now() });
        toast.info(
          `Agora criando a despesa de ${next.supplierLabel}${rest.length > 0 ? ` (+${rest.length} restante(s))` : ""}.`,
          { duration: 6000 },
        );
        return;
      }

      // Encerrou a fila. Se houve encadeamento (>1 entrada) OU sobrou algum
      // erro no histórico, abre o resumo final antes de fechar.
      if (queueHistory.length > 1 || failedGroupsRef.current.size > 0) {
        setShowQueueSummary(true);
        return;
      }
      onClose();
    } catch (e: any) {
      console.error("Erro ao criar despesa:", e);
      const msg =
        (e && (e.message || e.error_description || e.details || e.hint)) ||
        (typeof e === "string" ? e : "") ||
        "Erro ao criar despesa";
      // Registra a falha do grupo atual (status=failed + guarda o DocGroup
      // no cache para o botão "Reenviar apenas erros" no resumo).
      const currentEntry = queueHistory.find((e) => e.status === "pending");
      if (currentEntry) {
        updateQueueEntry(currentEntry.supplierKey, { status: "failed", errorMessage: msg, completedAt: Date.now() });
        if (currentGroupRef.current && currentGroupRef.current.supplierKey === currentEntry.supplierKey) {
          failedGroupsRef.current.set(currentEntry.supplierKey, currentGroupRef.current);
          schedulePersist();
        }
      }
      toast.error(msg);
    } finally {
      setIsCreating(false);
      submitInFlightRef.current = false;
      console.info(DEDUP_LOG, "handleSubmit END");
    }
  };

  const [closeConfirm, setCloseConfirm] = useState(false);

  const hasUnsavedChanges = useMemo(() => {
    if (isCreating) return false;
    if (supplier) return true;
    if (suggestedSupplierName) return true;
    if (currency) return true;
    if (docDate) return true;
    if (dueDate) return true;
    if (remarks && remarks.trim().length > 0) return true;
    if (headerCostCenter) return true;
    if (headerProject) return true;
    if (files.length > 0) return true;
    if (
      items.some(
        (it) =>
          (it.description && it.description.trim().length > 0) ||
          (it.item_code && String(it.item_code).trim().length > 0) ||
          Number(it.quantity) > 0 ||
          Number(it.unit_price) > 0 ||
          Number(it.line_total) > 0 ||
          it.sapItem ||
          it.sapCostCenter ||
          it.sapProject,
      )
    ) {
      return true;
    }
    return false;
  }, [
    isCreating,
    supplier,
    suggestedSupplierName,
    currency,
    docDate,
    dueDate,
    remarks,
    headerCostCenter,
    headerProject,
    files,
    items,
  ]);

  const requestClose = useCallback(() => {
    if (isCreating) return;
    if (hasUnsavedChanges) {
      setCloseConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, isCreating, onClose]);

  const handleSaveDraftAndClose = useCallback(async () => {
    const companyDb = sapSession?.companyDB;
    setCloseConfirm(false);
    if (!companyDb) {
      onClose();
      return;
    }
    try {
      const draftTotal = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
      const previewParts = [
        supplier?.name || suggestedSupplierName || "(sem fornecedor)",
        items.length > 0 ? `${items.length} ite${items.length > 1 ? "ns" : "m"}` : null,
        draftTotal > 0 ? formatCurrency(draftTotal, currency || "BRL") : null,
      ].filter(Boolean);
      const preview = previewParts.join(" · ");
      const id = await saveDraft({
        docType: mode,
        companyDb,
        payload: {
          supplier,
          currency,
          docDate,
          dueDate,
          remarks,
          items,
          headerCostCenter,
          headerProject,
          fileNames: files.map((f) => f.name),
        },
        preview,
        draftId,
      });
      if (id) {
        onDraftSaved?.(id);
        toast.success("Esboço salvo. Você pode retomar mais tarde.");
      }
    } catch (e) {
      console.error("Falha ao salvar esboço:", e);
      toast.error("Não foi possível salvar o esboço.");
    } finally {
      onClose();
    }
  }, [
    sapSession?.companyDB,
    items,
    supplier,
    suggestedSupplierName,
    currency,
    docDate,
    dueDate,
    remarks,
    headerCostCenter,
    headerProject,
    files,
    draftId,
    mode,
    onClose,
    onDraftSaved,
  ]);

  const handleDiscardAndClose = useCallback(async () => {
    setCloseConfirm(false);
    if (draftId) {
      try {
        await deleteDraft(draftId);
      } catch (e) {
        console.warn("Falha ao descartar esboço:", e);
      }
    }
    onClose();
  }, [draftId, onClose]);

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); }}>
      <DialogContent
        ref={setDialogContainer}
        className="max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto sm:p-8"
      >
        <DialogHeader>
          <DialogTitle>{title || (isSales ? "Novo Pedido de Venda" : "Nova Despesa")}</DialogTitle>
        </DialogHeader>

        {/* Barra de progresso do fluxo: classificação IA, salvamento e fila
            de despesas encadeadas (deferredGroups da regra de fornecedores
            diferentes). Fica sempre visível para o usuário saber o estado. */}
        {(isProcessing || isCreating || deferredGroups.length > 0 || justCancelled) && (
          <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2 min-w-0">
                {isProcessing && (
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>
                      Classificando {files.length} anexo(s) com IA — identificando fornecedor, itens e tipo do documento…
                    </span>
                  </div>
                )}
                {isCreating && (
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>
                      Salvando {isSales ? "pedido de venda" : "despesa"}
                      {files.length > 0 ? ` e enviando ${files.length} anexo(s)` : ""}…
                    </span>
                  </div>
                )}
                {justCancelled && !isProcessing && !isCreating && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-0.5">↺</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground font-medium">
                        Processamento cancelado
                      </div>
                      <div className="mt-0.5">
                        {files.length} anexo(s) mantido(s) no modal. Clique em "Tentar novamente" para reclassificar com a IA sem reenviar os arquivos.
                      </div>
                    </div>
                  </div>
                )}
                {queueHistory.length > 0 && !isCreating && !isProcessing && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-0.5">📋</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground font-medium mb-1">
                        Fila de fornecedores ({queueHistory.filter((e) => e.status === "success").length}/{queueHistory.length} concluídas)
                      </div>
                      {retryingKeys && retryingKeys.size > 0 && (() => {
                        const retryEntries = queueHistory.filter((e) => retryingKeys.has(e.supplierKey));
                        const total = retryingKeys.size;
                        const okCount = retryEntries.filter((e) => e.status === "success").length;
                        const failCount = retryEntries.filter((e) => e.status === "failed").length;
                        const doneCount = okCount + failCount;
                        const active = retryEntries.find((e) => e.status === "pending");
                        const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
                        const finished = doneCount >= total;
                        return (
                          <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-medium text-primary flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3" />
                                {finished ? "Retentativa concluída" : "Reenviando erros"}
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {doneCount}/{total} reprocessados
                                {failCount > 0 && ` · ${failCount} falha(s)`}
                              </span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                            {!finished && active && (
                              <div className="text-[10px] text-muted-foreground truncate">
                                Atual: {active.supplierLabel}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <ul className="space-y-0.5">
                        {queueHistory.map((e, idx) => {
                          const icon =
                            e.status === "success" ? "✅" :
                            e.status === "pending" ? "▶️" :
                            e.status === "failed" ? "❌" :
                            e.status === "cancelled" ? "🚫" : "⏳";
                          return (
                            <li key={e.supplierKey} className="flex items-center gap-1.5 truncate">
                              <span className="shrink-0">{icon}</span>
                              <span className={e.status === "pending" ? "text-foreground font-medium" : ""}>
                                {idx + 1}. {e.supplierLabel}
                              </span>
                              {e.aiConfidence !== null && (
                                <span
                                  className={`text-[10px] shrink-0 ${
                                    isLowConfidence(e.aiConfidence)
                                      ? "text-amber-700 dark:text-amber-500 font-semibold"
                                      : "opacity-70"
                                  }`}
                                  title={
                                    isLowConfidence(e.aiConfidence)
                                      ? `Confiança abaixo do limite (${Math.round(aiConfidenceThreshold * 100)}%) — revise os dados extraídos.`
                                      : undefined
                                  }
                                >
                                  · IA {Math.round(e.aiConfidence * 100)}%
                                  {isLowConfidence(e.aiConfidence) && " ⚠ revisar"}
                                </span>
                              )}
                              {e.aiWarnings.length > 0 && (
                                <span className="text-[10px] text-amber-600 shrink-0">
                                  · ⚠ {e.aiWarnings.length}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => openDetailsFor(e)}
                                className="ml-auto text-[10px] text-primary hover:underline shrink-0"
                                title="Ver arquivos, linhas e alertas classificados pela IA"
                              >
                                Ver detalhes
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {/* Botão de cancelar: aparece quando há IA em andamento ou fila
                    de fornecedores adiados. Não interfere no salvamento em curso
                    (isCreating), pois cancelar uma gravação parcial seria pior. */}
                {(isProcessing || deferredGroups.length > 0) && !isCreating && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setCancelConfirm(true)}
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Cancelar
                  </Button>
                )}
                {/* Pausar — só pra fila encadeada (>=1 deferred). Não aborta
                    IA em andamento (para isso use Cancelar); apenas impede o
                    auto-avanço para o próximo grupo quando o atual terminar. */}
                {deferredGroups.length > 0 && !isPaused && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={pauseProcessing}
                    title="Interrompe a fila com segurança após concluir o grupo atual"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pausar
                  </Button>
                )}
                {isPaused && deferredGroups.length > 0 && !isCreating && !isProcessing && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-primary border-primary/40"
                    onClick={resumeFromPause}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Retomar ({deferredGroups.length})
                  </Button>
                )}
                {/* Retry — só aparece após cancelamento, quando há anexos e
                    não há nenhum fluxo em andamento (guard anti-duplicação
                    dobrado em `processWithAI` para chamadas paralelas). */}
                {justCancelled && !isProcessing && !isCreating && files.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => processWithAI(files)}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Tentar novamente
                  </Button>
                )}
                {/* Retomar fila — reaproveita os DocGroups em cache dos
                    grupos que estavam pendentes/enfileirados no cancelamento,
                    sem chamar a IA de novo. Mantém os grupos concluídos. */}
                {justCancelled && !isProcessing && !isCreating && cancelledGroupsRef.current.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={resumeCancelledQueue}
                    disabled={resumeChecking}
                  >
                    {resumeChecking ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando…</>
                    ) : (
                      <>▶ Retomar fila ({cancelledGroupsRef.current.length})</>
                    )}
                  </Button>
                )}
                {/* Reenviar apenas erros direto do banner — abre a mesma
                    confirmação usada no resumo, reaproveitando os DocGroups
                    em cache (sem nova chamada de IA). */}
                {!isProcessing && !isCreating && (() => {
                  const failedKeys = queueHistory
                    .filter((e) => e.status === "failed")
                    .map((e) => e.supplierKey)
                    .filter((k) => failedGroupsRef.current.has(k));
                  if (failedKeys.length === 0) return null;
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => setConfirmRetryFailed(true)}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Reenviar erros ({failedKeys.length})
                    </Button>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 mt-2">

          {origin === "pagcorp" && mappingInfo && (
            <PagCorpCardMappingBanner
              status={mappingInfo.status}
              source={mappingInfo.source}
              missingFields={mappingInfo.missingFields}
              cardKey={mappingInfo.cardKey}
            />
          )}
          {/* AI Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Processar com IA</span>
              <span className="text-xs text-muted-foreground">(preenche campos automaticamente)</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Limpa o cache de respostas da IA (memória + localStorage)
                  para forçar novas chamadas na próxima extração. Útil quando
                  a IA errou e você reeditou um documento com o mesmo conteúdo,
                  ou quer reavaliar com um modelo/prompt atualizado. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const n = aiResponseCacheRef.current.size;
                  aiResponseCacheRef.current = new Map();
                  clearAiResponseCache(aiCacheScope);
                  toast.success(
                    n > 0
                      ? `Cache da IA limpo (${n} item(ns) removido(s)). Próximas extrações serão reenviadas.`
                      : "Cache da IA já estava vazio.",
                  );
                }}
                title="Limpar cache de respostas da IA (memória + navegador)"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Limpar cache IA
              </Button>
              <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
            </div>
          </div>

          {/* File Upload */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Documentos (NF, Recibos, Boletos)</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls,.xml"
                className="hidden"
                multiple
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              {isProcessing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  <p className="text-sm text-primary font-medium">Processando com IA...</p>
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Arraste seus arquivos ou <span className="text-primary font-medium">clique para selecionar</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, Imagens, CSV, Excel, XML</p>
                </>
              )}
            </div>

            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20 cursor-pointer hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = URL.createObjectURL(file);
                      const win = window.open(url, "_blank");
                      if (!win) {
                        // popup blocked — fallback to download
                        const a = document.createElement("a");
                        a.href = url;
                        a.target = "_blank";
                        a.rel = "noopener";
                        a.click();
                      }
                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    }}
                    title="Clique para visualizar o anexo"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1 underline decoration-dotted">{file.name}</span>
                    <span className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {aiConfidence !== null && (
              <div className="mt-2 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">
                  IA preencheu os campos com {Math.round(aiConfidence * 100)}% de confiança
                </span>
                {!aiEnabled && files.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-primary" onClick={() => processWithAI(files)} disabled={isProcessing}>
                    Reprocessar
                  </Button>
                )}
              </div>
            )}

            {aiEnabled && files.length > 0 && aiConfidence === null && !isProcessing && (
              <Button variant="outline" size="sm" className="mt-2 gap-1.5 text-xs" onClick={() => processWithAI(files)}>
                <Sparkles className="w-3.5 h-3.5" /> Processar com IA
              </Button>
            )}
          </div>

          {/* AI Warning */}
          {aiWarning && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <span className="text-destructive text-sm">⚠️</span>
              <p className="text-sm text-destructive whitespace-pre-line">{aiWarning}</p>
              <button onClick={() => setAiWarning(null)} className="ml-auto text-destructive/70 hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ==================== CABEÇALHO ==================== */}
          <section className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 -mb-1">
              <div className="h-4 w-1 rounded-full bg-primary/70" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cabeçalho</h3>
            </div>

          {/* Supplier */}
          <div>
            <CachedSearchCombobox
              label={`${bpLabel} *`}
              options={supplierOptions}
              isLoading={suppliersLoading}
              value={supplier}
              onChange={handleSupplierChange}
              placeholder={`Digite nome, código ou CNPJ do ${bpLabel.toLowerCase()}...`}
              suggestedQuery={suggestedSupplierName}
              portalContainer={dialogContainer}
              required
            />
            {!supplier && !isSales && (suggestedSupplierName || aiSupplierData?.federal_tax_id) && (
              <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <span className="text-amber-600 dark:text-amber-400 text-sm">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground">
                    {bpLabel} não encontrado no SAP
                    {aiSupplierData?.card_name ? `: "${aiSupplierData.card_name}"` : ""}
                    {aiSupplierData?.federal_tax_id ? ` (CNPJ ${aiSupplierData.federal_tax_id})` : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const prefillAtts = (prefill?.receipts || []).flatMap((r: any) => {
                        const url = typeof r === "string" ? r : r?.url || r?.fileUrl || r?.href;
                        if (!url) return [];
                        const name = (typeof r === "object" && (r.name || r.filename)) || url.split("/").pop()?.split("?")[0] || "anexo";
                        return [{ name, url }];
                      });
                      await requestSupplierRegistration({
                        cardName: aiSupplierData?.card_name || suggestedSupplierName || undefined,
                        federalTaxId: aiSupplierData?.federal_tax_id,
                        email: aiSupplierData?.email,
                        phone1: aiSupplierData?.phone1,
                        phone2: aiSupplierData?.phone2,
                        currency: aiSupplierData?.currency,
                        address: {
                          street: aiSupplierData?.bill_to_street,
                          zip: aiSupplierData?.bill_to_zip,
                          city: aiSupplierData?.bill_to_city,
                          state: aiSupplierData?.bill_to_state,
                          country: aiSupplierData?.bill_to_country,
                          block: aiSupplierData?.bill_to_block,
                          building: aiSupplierData?.bill_to_building,
                        },
                        companyDb: sapSession?.companyDB,
                        context: `Compras — Criação de despesa (${bpLabel})`,
                        transaction: prefill ? {
                          description: prefill.description,
                          amount: prefill.amount,
                          currency: prefill.currency,
                          accountAlias: prefill.accountAlias,
                        } : undefined,
                        attachments: prefillAtts,
                        requesterName: sapSession?.userName,
                      });
                      toast.success("Solicitação enviada para compras@anagaming.com.br");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Falha ao enviar solicitação");
                    }
                  }}
                  className="gap-1.5 text-xs h-7 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Solicitar cadastro
                </Button>
              </div>
            )}
          </div>

          {/* Supplier creation modal — pre-filled with AI extracted data */}
          <SupplierFormModal
            open={showSupplierForm}
            onClose={() => setShowSupplierForm(false)}
            prefill={aiSupplierData}
            source="expense_ai"
            onSaved={(s) => {
              setShowSupplierForm(false);
              if (s.card_code) {
                handleSupplierChange({
                  code: s.card_code,
                  name: s.card_name,
                  extra: (s as any).federal_tax_id || undefined,
                  ...((s as any).currency ? { currency: (s as any).currency } : {}),
                } as any);
                toast.success("Fornecedor cadastrado e selecionado!");
              }
            }}
          />

          {/* Currency Warning */}
          {currencyWarning && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <span className="text-destructive text-sm">⚠️</span>
              <p className="text-sm text-destructive">{currencyWarning}</p>
              <button onClick={() => setCurrencyWarning(null)} className="ml-auto text-destructive/70 hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Currency + Dates — filial usa o padrão configurado no cadastro da empresa.
              Padrão visual: verde + check quando preenchido, âmbar + triângulo quando obrigatório vazio. */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                <span>Moeda *</span>
                {currency ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-label="Preenchido" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-label="Obrigatório" />
                )}
                {loadingCurrencies && <span className="ml-1 text-muted-foreground">(carregando…)</span>}
              </label>
              {currencyOptions ? (
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger
                    className={`text-sm h-9 ${
                      currency
                        ? "bg-green-500/5 border-green-500/50 font-medium"
                        : "bg-amber-500/5 border-amber-500/50"
                    }`}
                  >
                    <SelectValue placeholder="Selecione a moeda" />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={currency}
                  readOnly
                  placeholder="Definida pelo fornecedor"
                  className={`text-sm h-9 ${
                    currency
                      ? "bg-green-500/5 border-green-500/50 font-medium"
                      : "bg-amber-500/5 border-amber-500/50"
                  }`}
                />
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                <span>Data do Documento *</span>
                {docDate ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-label="Preenchido" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-label="Obrigatório" />
                )}
              </label>
              <Input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className={`text-sm h-9 ${
                  docDate
                    ? "bg-green-500/5 border-green-500/50"
                    : "bg-amber-500/5 border-amber-500/50"
                }`}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                <span>Data de Vencimento *</span>
                {dueDate ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-label="Preenchido" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-label="Obrigatório" />
                )}
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={`text-sm h-9 ${
                  dueDate
                    ? "bg-green-500/5 border-green-500/50"
                    : "bg-amber-500/5 border-amber-500/50"
                }`}
              />
            </div>
          </div>


          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Descrição da despesa..." rows={2} />
          </div>

          {/* Tipo de rateio — força regras de aprovação específicas (só compras) */}
          {!isSales && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo de rateio</label>
              <Select value={rateioType} onValueChange={(v) => setRateioType(v as RateioType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RATEIO_TYPE_LABELS) as RateioType[]).map((k) => (
                    <SelectItem key={k} value={k}>{RATEIO_TYPE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rateioType !== "padrao" && (
                <p className="text-[11px] text-muted-foreground">
                  Este tipo força a regra de aprovação correspondente e ignora a matriz normal.
                  {rateioType === "viagens" && " Viagens seguem o fluxo de Reembolso."}
                </p>
              )}
            </div>
          )}

          {/* Header-level defaults: cascade to all items, user can override per line */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Padrões para itens</p>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed border-border bg-muted/20 p-3">
              <CachedSearchCombobox
                label="Centro de Custo (padrão p/ itens) *"
                options={costCenterOptions}
                isLoading={costCentersLoading}
                value={headerCostCenter}
                onChange={applyHeaderCostCenter}
                placeholder="Obrigatório — aplica a todos os itens…"
                portalContainer={dialogContainer}
                required
              />
              <CachedSearchCombobox
                label="Projeto (padrão p/ itens)"
                options={projectOptions}
                isLoading={projectsLoading}
                value={headerProject}
                onChange={applyHeaderProject}
                placeholder="Aplica a todos os itens…"
                portalContainer={dialogContainer}
              />
              <p className="col-span-2 text-[11px] text-muted-foreground">
                Definir aqui preenche todas as linhas. Você pode ajustar item a item abaixo — a
                integração usa sempre o valor de cada linha.
              </p>
            </div>
          </div>
          </section>

          {/* ==================== CORPO / ITENS ==================== */}
          <section className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-primary/70" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens / Linhas</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={addItem} className="gap-1 text-xs h-7">
                <Plus className="w-3 h-3" /> Adicionar Item
              </Button>
            </div>
            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={i} className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Item {i + 1}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(i)} disabled={items.length <= 1} className="h-6 w-6 text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <CachedSearchCombobox
                    options={itemOptions}
                    isLoading={itemsLoading}
                    value={item.sapItem || null}
                    onChange={(val) => {
                      setItems((prev) => {
                        const updated = [...prev];
                        // Preserve description from AI / user input — only fill it
                        // from the SAP item name if the field is currently empty.
                        const currentDesc = (updated[i].description || "").trim();
                        const nextDesc = currentDesc ? currentDesc : (val?.name || "");
                        updated[i] = {
                          ...updated[i],
                          sapItem: val,
                          item_code: val?.code || "",
                          description: nextDesc,
                        };
                        return updated;
                      });
                    }}
                    placeholder={
                      origin === "pagcorp" && mappingInfo?.missingFields.includes("Item")
                        ? "Sem mapeamento — selecione manualmente"
                        : "Buscar item SAP por nome ou código..."
                    }
                    suggestedQuery={!item.sapItem ? (item.searchHint || item.description || undefined) : undefined}
                    portalContainer={dialogContainer}
                  />
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-6">
                      <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <span>Descrição *</span>
                        {(item.description || "").trim() ? (
                          <CheckCircle2 className="w-3 h-3 text-green-500" aria-label="Preenchido" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" aria-label="Obrigatório" />
                        )}
                      </label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(i, "description", e.target.value)}
                        placeholder="Descrição do item"
                        className={`text-sm h-8 ${
                          (item.description || "").trim()
                            ? "bg-green-500/5 border-green-500/50"
                            : "bg-amber-500/5 border-amber-500/50"
                        }`}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Qtd</label>
                      <Input type="number" value={item.quantity} onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)} className="text-sm h-8" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Preço Unit.</label>
                      <Input type="number" value={item.unit_price} onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)} className="text-sm h-8" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Total</label>
                      <Input value={formatCurrency(item.line_total)} readOnly className="text-sm h-8 bg-muted/30 font-mono" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <CachedSearchCombobox
                      label="Centro de Custo (Dimensão)"
                      options={costCenterOptions}
                      isLoading={costCentersLoading}
                      value={item.sapCostCenter || null}
                      onChange={(val) => {
                        setItems((prev) => {
                          const updated = [...prev];
                          updated[i] = { ...updated[i], sapCostCenter: val, cost_center: val?.code || "" };
                          return updated;
                        });
                      }}
                      placeholder={
                        origin === "pagcorp" && mappingInfo?.missingFields.includes("Centro de Custo")
                          ? "Sem mapeamento — selecione manualmente"
                          : "Buscar centro de custo..."
                      }
                      suggestedQuery={item.cost_center && !item.sapCostCenter ? item.cost_center : undefined}
                      portalContainer={dialogContainer}
                    />
                    <CachedSearchCombobox
                      label="Projeto (Dimensão)"
                      options={projectOptions}
                      isLoading={projectsLoading}
                      value={item.sapProject || null}
                      onChange={(val) => {
                        setItems((prev) => {
                          const updated = [...prev];
                          updated[i] = { ...updated[i], sapProject: val, project: val?.code || "" };
                          return updated;
                        });
                      }}
                      placeholder={
                        origin === "pagcorp" && mappingInfo?.missingFields.includes("Projeto")
                          ? "Sem mapeamento — selecione manualmente"
                          : "Buscar projeto..."
                      }
                      suggestedQuery={item.project && !item.sapProject ? item.project : undefined}
                      portalContainer={dialogContainer}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <p className="text-sm font-medium text-foreground">
                Total: <span className="text-lg font-bold font-mono">{formatCurrency(total, currency || "BRL")}</span>
              </p>
            </div>
          </section>

          <div className="border-t border-border pt-4 flex justify-end gap-3">
            <Button variant="outline" onClick={requestClose} disabled={isCreating}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isCreating || isProcessing} className="gap-1.5">
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {isCreating
                ? "Salvando…"
                : isProcessing
                  ? "Aguardando IA…"
                  : deferredGroups.length > 0
                    ? `${isSales ? "Criar Pedido" : "Criar Despesa"} (1 de ${deferredGroups.length + 1})`
                    : isSales
                      ? "Criar Pedido de Venda"
                      : "Criar Despesa"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
      <AlertDialogContent
        role="alertdialog"
        aria-modal="true"
        onKeyDown={(e) => {
          // Ctrl/Cmd+S salva como esboço; Ctrl/Cmd+Backspace/Delete descarta.
          // Enter simples confirma a opção segura (Continuar editando) via Radix.
          if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
            e.preventDefault();
            void handleSaveDraftAndClose();
          } else if (
            (e.ctrlKey || e.metaKey) &&
            (e.key === "Backspace" || e.key === "Delete")
          ) {
            e.preventDefault();
            void handleDiscardAndClose();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Sair sem finalizar?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                Você já preencheu campos deste {isSales ? "pedido de venda" : "pedido de compra"}.
                O que deseja fazer?
              </p>
              <p className="text-[10px] text-muted-foreground">
                Atalhos:{" "}
                <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Esc</kbd>{" "}
                continua editando ·{" "}
                <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Ctrl</kbd>+
                <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">S</kbd>{" "}
                salva esboço.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel className="sm:mr-auto" autoFocus>
            Continuar editando
          </AlertDialogCancel>
          <Button variant="outline" onClick={handleDiscardAndClose}>
            Sair sem salvar
          </Button>
          <AlertDialogAction
            onClick={handleSaveDraftAndClose}
            aria-keyshortcuts="Control+S Meta+S"
          >
            Salvar como esboço
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Picker de fornecedor — quando 2+ anexos fiscais têm fornecedores
        diferentes, o usuário escolhe qual despesa criar PRIMEIRO. Os demais
        grupos ficam adiados e abrem automaticamente após a submissão. */}
    <AlertDialog open={!!supplierPicker} onOpenChange={(v) => { if (!v) setSupplierPicker(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Anexos com fornecedores diferentes</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Detectamos <strong>{supplierPicker?.groups.length}</strong> fornecedores nos anexos enviados. Cada despesa
                deve conter documentos de um único fornecedor — escolha por qual começar. Assim que você submeter,
                abriremos automaticamente uma nova despesa para o próximo.
              </p>
              <div className="space-y-2">
                {supplierPicker?.groups.map((g) => {
                  // Resumo por fornecedor: contagem de arquivos, linhas e total estimado.
                  const lineCount = g.docs.reduce(
                    (acc, d) => acc + (Array.isArray(d.extracted?.items) ? d.extracted.items.length : 0),
                    0,
                  );
                  const estimatedTotal = g.docs.reduce((acc, d) => {
                    const items = Array.isArray(d.extracted?.items) ? d.extracted.items : [];
                    const sumItems = items.reduce((s: number, it: any) => {
                      const lt = Number(it?.line_total);
                      if (Number.isFinite(lt) && lt !== 0) return s + lt;
                      const qty = Number(it?.quantity) || 0;
                      const up = Number(it?.unit_price) || 0;
                      return s + qty * up;
                    }, 0);
                    if (sumItems > 0) return acc + sumItems;
                    const fallback = Number(d.extracted?.total_amount) || 0;
                    return acc + fallback;
                  }, 0);
                  const currencies = Array.from(
                    new Set(
                      g.docs
                        .map((d) => String(d.extracted?.currency || "").toUpperCase())
                        .filter(Boolean),
                    ),
                  );
                  const currency = currencies[0] || "BRL";
                  const totalStr = estimatedTotal > 0
                    ? new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency,
                        maximumFractionDigits: 2,
                      }).format(estimatedTotal)
                    : "—";
                  return (
                    <button
                      key={g.supplierKey}
                      type="button"
                      onClick={() => chooseFirstSupplierGroup(g.supplierKey)}
                      className="w-full rounded-md border border-border bg-muted/30 hover:bg-muted/60 transition p-3 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{g.supplierLabel}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {g.docs.length} arquivo(s) · {lineCount} linha(s)
                            {currencies.length > 1 && (
                              <span className="ml-1 text-amber-600">
                                (moedas diferentes: {currencies.join(", ")})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {g.docs.map((d) => d.file.name).join(", ")}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Total est.
                          </div>
                          <div className="font-semibold tabular-nums">{totalStr}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {supplierPicker && supplierPicker.nonFiscal.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Anexos não-fiscais ({supplierPicker.nonFiscal.map((f) => f.name).join(", ")}) irão junto com a
                  primeira despesa como anexo.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Confirmação de cancelamento do processamento IA e/ou fila de fornecedores */}
    <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar processamento?</AlertDialogTitle>
          <AlertDialogDescription>
            {isProcessing && "A classificação por IA em andamento será interrompida. "}
            {deferredGroups.length > 0 && (
              <>
                As <strong>{deferredGroups.length}</strong> despesa(s) na fila
                ({deferredGroups.map((g) => g.supplierLabel).join(", ")}) serão descartadas.{" "}
              </>
            )}
            Os anexos permanecem no modal para você continuar manualmente. Deseja continuar?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            onClick={cancelProcessingAndQueue}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Sim, cancelar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Resumo final da fila de fornecedores despachados. Aparece quando o
        encadeamento termina (por conclusão de todas as despesas ou por
        cancelamento). Mostra status, confiança da IA, alertas e totais. */}
    <AlertDialog
      open={showQueueSummary}
      onOpenChange={(v) => {
        // Só fecha o resumo; NÃO fecha o modal principal aqui (isso permite
        // "Reenviar apenas erros" fechar o resumo mantendo o modal aberto).
        // O fechamento definitivo do modal acontece só via botão "Fechar".
        if (!v) setShowQueueSummary(false);
      }}
    >
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Resumo da fila de fornecedores</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {(() => {
                const total = queueHistory.length;
                const ok = queueHistory.filter((e) => e.status === "success").length;
                const failed = queueHistory.filter((e) => e.status === "failed" || !!e.errorMessage).length;
                const cancelled = queueHistory.filter((e) => e.status === "cancelled").length;
                const pending = queueHistory.filter((e) => e.status === "pending" || e.status === "queued").length;
                const lowConf = queueHistory.filter((e) => isLowConfidence(e.aiConfidence)).length;
                return (
                  <div className="space-y-2">
                    <p className="text-muted-foreground">
                      {ok}/{total} concluídas
                      {failed > 0 && ` · ${failed} com erro`}
                      {cancelled > 0 && ` · ${cancelled} cancelada(s)`}
                      {pending > 0 && ` · ${pending} pendente(s)`}
                    </p>
                    {lowConf > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                        <span>⚠</span>
                        <span>
                          <strong>{lowConf}</strong> grupo(s) com confiança IA abaixo de {Math.round(aiConfidenceThreshold * 100)}% — revise os dados extraídos antes de aprovar.
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <label htmlFor="ai-threshold" className="shrink-0">Limite de confiança:</label>
                      <input
                        id="ai-threshold"
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(aiConfidenceThreshold * 100)}
                        onChange={(ev) => setAiConfidenceThreshold(Number(ev.target.value) / 100)}
                        className="flex-1 accent-primary"
                      />
                      <span className="tabular-nums font-medium text-foreground w-10 text-right">
                        {Math.round(aiConfidenceThreshold * 100)}%
                      </span>
                    </div>
                  </div>
                );
              })()}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {queueHistory.map((e, idx) => {
                  const badge =
                    e.status === "success" ? { icon: "✅", label: "Criada", color: "text-emerald-600" } :
                    e.status === "failed" ? { icon: "❌", label: "Falhou", color: "text-destructive" } :
                    e.status === "cancelled" ? { icon: "🚫", label: "Cancelada", color: "text-muted-foreground" } :
                    e.status === "pending" ? { icon: "▶️", label: "Em andamento", color: "text-primary" } :
                    { icon: "⏳", label: "Na fila", color: "text-muted-foreground" };
                  const totalStr = e.estimatedTotal > 0
                    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: e.currency }).format(e.estimatedTotal)
                    : "—";
                  const lowConf = isLowConfidence(e.aiConfidence);
                  return (
                    <div
                      key={e.supplierKey}
                      className={`rounded-md border p-3 space-y-1.5 ${
                        lowConf
                          ? "border-amber-500/50 bg-amber-500/10"
                          : "border-border bg-muted/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {idx + 1}. {e.supplierLabel}
                            {lowConf && (
                              <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/20 rounded px-1.5 py-0.5">
                                Revisar
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {e.fileCount} arquivo(s) · {e.lineCount} linha(s)
                            {e.currencies.length > 1 && (
                              <span className="ml-1 text-amber-600">
                                (moedas: {e.currencies.join(", ")})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-medium ${badge.color}`}>
                            {badge.icon} {badge.label}
                          </div>
                          <div className="text-xs tabular-nums text-muted-foreground mt-0.5">{totalStr}</div>
                        </div>
                      </div>
                      {e.aiConfidence !== null && (
                        <div className={`text-[11px] ${lowConf ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>
                          Confiança IA:{" "}
                          <span className="font-medium">{Math.round(e.aiConfidence * 100)}%</span>
                          {lowConf && ` (abaixo de ${Math.round(aiConfidenceThreshold * 100)}%)`}
                        </div>
                      )}
                      {e.aiWarnings.length > 0 && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-500 space-y-0.5">
                          {e.aiWarnings.map((w, i) => (
                            <div key={i} className="flex gap-1">
                              <span>⚠</span>
                              <span className="whitespace-pre-line">{w}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {e.errorMessage && (
                        <div className="text-[11px] text-destructive">
                          Erro: {e.errorMessage}
                        </div>
                      )}
                      {e.fileNames.length > 0 && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {e.fileNames.join(", ")}
                        </div>
                      )}
                      <div className="pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-primary"
                          onClick={() => openDetailsFor(e)}
                        >
                          Ver detalhes
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          {(() => {
            const failedKeys = queueHistory
              .filter((e) => e.status === "failed")
              .map((e) => e.supplierKey)
              .filter((k) => failedGroupsRef.current.has(k));
            if (failedKeys.length === 0) return null;
            return (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => setConfirmRetryFailed(true)}
              >
                <Sparkles className="w-4 h-4" />
                Reenviar apenas erros ({failedKeys.length})
              </Button>
            );
          })()}
          {cancelledGroupsRef.current.length > 0 && (
            <Button variant="outline" className="gap-1.5" onClick={resumeCancelledQueue}>
              ▶ Retomar fila ({cancelledGroupsRef.current.length})
            </Button>
          )}
          {isPaused && deferredGroups.length > 0 && (
            <Button variant="outline" className="gap-1.5 text-primary border-primary/40" onClick={resumeFromPause}>
              <Play className="w-4 h-4" />
              Retomar da pausa ({deferredGroups.length})
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={queueHistory.length === 0}
            onClick={() => {
              exportQueueSummaryPdf({
                entries: queueHistory.map((e) => ({
                  id: e.supplierKey,
                  supplierLabel: e.supplierLabel,
                  status: e.status,
                  fileCount: e.fileCount,
                  lineCount: e.lineCount,
                  estimatedTotal: e.estimatedTotal,
                  currency: e.currency,
                  currencies: e.currencies,
                  aiConfidence: e.aiConfidence,
                  aiWarnings: e.aiWarnings,
                  errorMessage: e.errorMessage,
                  fileNames: e.fileNames,
                })),
                confidenceThreshold: aiConfidenceThreshold,
                kindLabel: isSales ? "Pedidos de venda" : "Despesas",
                fileName: `resumo_fila_ia_${isSales ? "vendas" : "despesas"}`,
              }).catch((err) => {
                console.error("[queue-summary-pdf] falha", err);
                toast.error("Não foi possível gerar o PDF do resumo.");
              });
            }}
          >
            <FileDown className="w-4 h-4" />
            Exportar PDF
          </Button>
          {(() => {
            const mapEntries = () => queueHistory.map((e) => ({
              id: e.supplierKey,
              supplierLabel: e.supplierLabel,
              status: e.status,
              fileCount: e.fileCount,
              lineCount: e.lineCount,
              estimatedTotal: e.estimatedTotal,
              currency: e.currency,
              currencies: e.currencies,
              aiConfidence: e.aiConfidence,
              aiWarnings: e.aiWarnings,
              errorMessage: e.errorMessage,
              fileNames: e.fileNames,
            }));
            const lowCount = queueHistory.filter(
              (e) => e.aiConfidence === null || (e.aiConfidence !== null && e.aiConfidence < aiConfidenceThreshold),
            ).length;
            if (lowCount === 0) return null;
            const baseName = `revisao_baixa_confianca_${isSales ? "vendas" : "despesas"}`;
            const kindLabel = isSales ? "Pedidos de venda" : "Despesas";
            return (
              <>
                <Button
                  variant="outline"
                  className="gap-1.5 border-amber-500/50 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10"
                  onClick={() => {
                    exportLowConfidenceReviewPdf({
                      entries: mapEntries(),
                      confidenceThreshold: aiConfidenceThreshold,
                      kindLabel,
                      fileName: baseName,
                    }).catch((err) => {
                      console.error("[low-conf-review-pdf] falha", err);
                      toast.error("Não foi possível gerar o PDF de revisão.");
                    });
                  }}
                >
                  <FileDown className="w-4 h-4" />
                  Revisão PDF ({lowCount})
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 border-amber-500/50 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10"
                  onClick={() => {
                    try {
                      exportLowConfidenceReviewCsv({
                        entries: mapEntries(),
                        confidenceThreshold: aiConfidenceThreshold,
                        kindLabel,
                        fileName: baseName,
                      });
                    } catch (err) {
                      console.error("[low-conf-review-csv] falha", err);
                      toast.error("Não foi possível gerar o CSV de revisão.");
                    }
                  }}
                >
                  <FileDown className="w-4 h-4" />
                  Revisão CSV ({lowCount})
                </Button>
              </>
            );
          })()}
          {/* Relatório operacional do fluxo de compras — restrito a super-users.
              Consolida tempos por etapa, gargalos e classificações/alertas dos
              grupos adiados. Útil para diagnosticar demora e revisar backlog. */}
          {sapSession?.isSuperUser && queueHistory.length > 0 && (
            <Button
              variant="outline"
              disabled={isGeneratingFlowReport}
              className="gap-1.5 border-primary/50 text-primary hover:bg-primary/10"
              onClick={async () => {
                // Guardas de UX: sem entradas processadas não faz sentido gerar
                // o PDF (o super-user provavelmente esqueceu de rodar algo).
                if (queueHistory.length === 0) {
                  toast.info("Nenhum grupo processado ainda — não há dados para o relatório.");
                  return;
                }
                const groupsWithDocs = deferredGroups.filter((g) => (g.docs?.length ?? 0) > 0).length;
                const totalGroups = deferredGroups.length;
                setIsGeneratingFlowReport(true);
                const loadingId = toast.loading("Gerando PDF do fluxo…");
                try {
                  await exportPurchaseFlowReportPdf({
                    entries: queueHistory.map((e) => ({
                      supplierLabel: e.supplierLabel,
                      status: e.status,
                      fileCount: e.fileCount,
                      lineCount: e.lineCount,
                      estimatedTotal: e.estimatedTotal,
                      currency: e.currency,
                      currencies: e.currencies,
                      aiConfidence: e.aiConfidence,
                      aiWarnings: e.aiWarnings,
                      errorMessage: e.errorMessage,
                      fileNames: e.fileNames,
                      classifiedAt: e.classifiedAt,
                      promotedAt: e.promotedAt,
                      submittedAt: e.submittedAt,
                      completedAt: e.completedAt,
                    })),
                    deferredGroups: deferredGroups.map((g) => ({
                      supplierLabel: g.supplierLabel,
                      docs: g.docs.map((d) => {
                        const conf = Number(d.extracted?.confidence);
                        const warns = [d.extracted?.client_warning, d.extracted?.totals_warning]
                          .filter(Boolean)
                          .map((w) => String(w));
                        return {
                          fileName: d.file.name,
                          docType: (d.extracted?.doc_type as string | undefined) ?? null,
                          currency: (d.extracted?.currency as string | undefined) ?? null,
                          confidence: Number.isFinite(conf) && conf > 0 ? conf : null,
                          warnings: warns,
                        };
                      }),
                    })),
                    confidenceThreshold: aiConfidenceThreshold,
                    kindLabel: isSales ? "Pedidos de venda" : "Despesas",
                    fileName: `fluxo_${isSales ? "vendas" : "compras"}`,
                  });
                  toast.dismiss(loadingId);
                  if (totalGroups > 0 && groupsWithDocs === 0) {
                    toast.success("PDF gerado. Nenhum grupo adiado possui anexos — o relatório traz apenas os tempos por etapa.");
                  } else if (totalGroups > 0 && groupsWithDocs < totalGroups) {
                    toast.success(`PDF gerado. ${totalGroups - groupsWithDocs} grupo(s) adiado(s) sem anexos foram listados sem classificação.`);
                  } else {
                    toast.success("Relatório do fluxo baixado.");
                  }
                } catch (err) {
                  console.error("[purchase-flow-pdf] falha", err);
                  toast.dismiss(loadingId);
                  toast.error(
                    err instanceof Error
                      ? `Não foi possível gerar o PDF: ${err.message}`
                      : "Não foi possível gerar o PDF do fluxo."
                  );
                } finally {
                  setIsGeneratingFlowReport(false);
                }
              }}
            >
              {isGeneratingFlowReport ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              {isGeneratingFlowReport ? "Gerando PDF…" : "Fluxo de compras (super-user)"}
            </Button>
          )}
          <AlertDialogAction
            onClick={() => {
              setShowQueueSummary(false);
              setQueueHistory([]);
              failedGroupsRef.current = new Map();
              cancelledGroupsRef.current = [];
              // Limpa também o estado persistido — usuário finalizou.
              void clearQueueState(queueScope);
              onClose();
            }}
          >
            Fechar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Confirmação antes de reenviar apenas os grupos com erro (❌).
        Evita reprocessar sem querer ao clicar no botão do resumo. */}
    <AlertDialog open={confirmRetryFailed} onOpenChange={setConfirmRetryFailed}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reenviar apenas os erros?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {(() => {
                const failed = queueHistory.filter(
                  (e) => e.status === "failed" && failedGroupsRef.current.has(e.supplierKey),
                );
                return (
                  <>
                    <p>
                      Vamos retentar <strong>{failed.length}</strong> grupo(s) com erro,
                      reaproveitando a extração já feita pela IA — nenhuma nova chamada de IA
                      será feita e as despesas já criadas não serão duplicadas.
                    </p>
                    {failed.length > 0 && (
                      <ul className="space-y-2 text-xs max-h-64 overflow-y-auto pr-1">
                        {failed.map((e, idx) => {
                          const group = failedGroupsRef.current.get(e.supplierKey);
                          const fileNames = group
                            ? group.docs.map((d) => d.file.name)
                            : e.fileNames;
                          return (
                            <li
                              key={e.supplierKey}
                              className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5"
                            >
                              <div className="font-medium text-foreground">
                                {idx + 1}. {e.supplierLabel}{" "}
                                <span className="text-muted-foreground font-normal">
                                  ({fileNames.length} arquivo{fileNames.length === 1 ? "" : "s"})
                                </span>
                              </div>
                              {fileNames.length > 0 && (
                                <ul className="list-disc pl-5 mt-0.5 text-muted-foreground">
                                  {fileNames.map((n, i) => (
                                    <li key={i} className="truncate">{n}</li>
                                  ))}
                                </ul>
                              )}
                              {e.errorMessage && (
                                <div className="text-[11px] text-destructive mt-1">
                                  Último erro: {e.errorMessage}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                );
              })()}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const failedKeys = queueHistory
                .filter((e) => e.status === "failed")
                .map((e) => e.supplierKey)
                .filter((k) => failedGroupsRef.current.has(k));
              const groups = failedKeys
                .map((k) => failedGroupsRef.current.get(k))
                .filter((g): g is DocGroup => !!g);
              setConfirmRetryFailed(false);
              if (groups.length === 0) return;
              const [first, ...rest] = groups;
              setQueueHistory((prev) => prev.map((e) => {
                if (e.supplierKey === first.supplierKey) {
                  return { ...e, status: "pending", errorMessage: undefined };
                }
                if (rest.some((g) => g.supplierKey === e.supplierKey)) {
                  return { ...e, status: "queued", errorMessage: undefined };
                }
                return e;
              }));
              setDeferredGroups(rest);
              setRetryingKeys(new Set(groups.map((g) => g.supplierKey)));
              resetFormForNextDeferred(first);
              setShowQueueSummary(false);
              setJustCancelled(false);
              toast.info(
                `Retentando ${groups.length} despesa(s) com erro. Comece por ${first.supplierLabel}.`,
                { duration: 6000 },
              );
            }}
          >
            Reenviar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Prévia visual do "Retomar fila": lista cada grupo do histórico com o
        motivo/ação computada (retomar / pular por já concluído / pular por
        duplicata / inalterado) para o usuário conferir antes de disparar. */}
    <AlertDialog open={!!resumePlan} onOpenChange={(v) => { if (!v) setResumePlan(null); }}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Retomar fila — prévia</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {resumePlan && (() => {
                const plan = resumePlan;
                const badgeFor = (a: ResumeAction | undefined) => {
                  if (!a) return null;
                  switch (a.kind) {
                    case "resume-first":
                      return { icon: "▶", label: "Vai retomar agora (1º)", cls: "bg-primary/15 text-primary border-primary/40" };
                    case "resume-queued":
                      return { icon: "⏳", label: "Vai voltar para a fila", cls: "bg-primary/5 text-primary border-primary/30" };
                    case "skip-done":
                      return { icon: "✅", label: "Já concluído — não será tocado", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" };
                    case "skip-duplicate":
                      return { icon: "🔁", label: "Duplicata detectada — pulada", cls: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/40" };
                    case "not-in-cancelled":
                      return { icon: "—", label: "Inalterado (não estava na fila cancelada)", cls: "bg-muted text-muted-foreground border-border" };
                  }
                };
                return (
                  <>
                    <div className="text-xs text-muted-foreground">
                      <strong className="text-foreground">{plan.toResume.length}</strong> grupo(s) serão retomados,{" "}
                      <strong className="text-foreground">{plan.skippedDone.length}</strong> pulado(s) por já estarem concluídos,{" "}
                      <strong className="text-foreground">{plan.skippedDuplicate.length}</strong> pulado(s) por duplicidade de anexo.
                    </div>
                    {plan.preCheckFailed && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                        ⚠ A pré-verificação de duplicatas falhou. O servidor ainda vai bloquear conflitos via UNIQUE, mas a lista abaixo pode não refletir todas as duplicatas.
                      </div>
                    )}
                    <ul className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
                      {queueHistory.map((e, idx) => {
                        const action = plan.reasons.get(e.supplierKey);
                        const b = badgeFor(action);
                        const dup = action?.kind === "skip-duplicate" ? action : null;
                        return (
                          <li key={e.supplierKey} className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {idx + 1}. {e.supplierLabel}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {e.fileCount} arquivo(s) · status atual: {e.status}
                                </div>
                              </div>
                              {b && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${b.cls}`}>
                                  {b.icon} {b.label}
                                </span>
                              )}
                            </div>
                            {dup?.owner && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-500 mt-1">
                                Já lançado por: <code className="font-mono">{dup.owner.slice(0, 8)}…</code>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                );
              })()}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!resumePlan || resumePlan.toResume.length === 0}
            onClick={() => { if (resumePlan) applyResumePlan(resumePlan); }}
          >
            {resumePlan && resumePlan.toResume.length === 0 ? "Nada para retomar" : "Confirmar retomada"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Detalhes de um grupo: arquivos, linhas extraídas pela IA e alertas.
        Abre-se sobre o modal principal e sobre o resumo, permitindo inspeção
        antes do usuário fechar. Quando o DocGroup original ainda está em cache
        (grupo atual, deferido, cancelado ou com falha), mostra a extração
        completa; caso contrário, usa apenas o snapshot da QueueEntry. */}
    <Dialog open={!!detailsView} onOpenChange={(v) => { if (!v) setDetailsView(null); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Detalhes: {detailsView?.entry.supplierLabel}
          </DialogTitle>
        </DialogHeader>
        {detailsView && (() => {
          const { entry, group } = detailsView;
          const currencyFmt = (v: number) =>
            new Intl.NumberFormat("pt-BR", { style: "currency", currency: entry.currency || "BRL" }).format(v);

          // Normalização do termo de busca para comparação case-insensitive
          // e sem sensibilidade a espaços nas bordas.
          const q = detailsSearch.trim().toLowerCase();
          const matches = (s: unknown) =>
            !q || String(s ?? "").toLowerCase().includes(q);

          const showLines = detailsTypeFilter === "all" || detailsTypeFilter === "line";
          const showWarnings = detailsTypeFilter === "all" || detailsTypeFilter === "warning";

          // Pré-computa, por arquivo, as linhas/alertas visíveis e se o arquivo
          // como um todo passa nos filtros — usado para esconder cards vazios
          // e para renderizar contadores de "N resultado(s)".
          type FileView = {
            docIdx: number;
            d: any;
            visibleItems: Array<{ idx: number; it: any }>;
            visibleWarns: string[];
            conf: number;
            confPass: boolean;
            fileNameMatch: boolean;
          };
          const filteredFiles: FileView[] = group
            ? group.docs.map((d, docIdx) => {
                const conf = Number(d.extracted?.confidence);
                const confIsLow = isLowConfidence(Number.isFinite(conf) && conf > 0 ? conf : null);
                const confPass =
                  detailsConfidenceFilter === "all" ||
                  (detailsConfidenceFilter === "low" && confIsLow) ||
                  (detailsConfidenceFilter === "normal" && !confIsLow);
                const rawItems: any[] = Array.isArray(d.extracted?.items) ? d.extracted.items : [];
                const rawWarns = [d.extracted?.client_warning, d.extracted?.totals_warning]
                  .filter(Boolean)
                  .map((w) => String(w));
                const fileNameMatch = matches(d.file?.name);
                // Se o nome do arquivo casa com a busca, mostramos TUDO
                // do arquivo (sem filtrar por termo dentro dele) — comportamento
                // esperado de "encontrar um arquivo específico".
                const visibleItems = showLines
                  ? rawItems
                      .map((it, idx) => ({ idx, it }))
                      .filter(({ it }) => fileNameMatch || matches(it?.description))
                  : [];
                const visibleWarns = showWarnings
                  ? rawWarns.filter((w) => fileNameMatch || matches(w))
                  : [];
                return { docIdx, d, visibleItems, visibleWarns, conf, confPass, fileNameMatch };
              })
            : [];
          const shownFiles = filteredFiles.filter(
            (fv) =>
              fv.confPass &&
              (fv.fileNameMatch || fv.visibleItems.length > 0 || fv.visibleWarns.length > 0 || !q),
          );

          const totalItems = filteredFiles.reduce((a, fv) => a + fv.visibleItems.length, 0);
          const totalWarns = filteredFiles.reduce((a, fv) => a + fv.visibleWarns.length, 0);

          const filtersActive =
            !!q || detailsTypeFilter !== "all" || detailsConfidenceFilter !== "all";

          const filteredAggWarnings = showWarnings
            ? entry.aiWarnings.filter((w) => matches(w))
            : [];

          return (
            <div className="space-y-4 text-sm">
              {/* Metadados agregados */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Arquivos:</span> {entry.fileCount}</div>
                <div><span className="text-muted-foreground">Linhas:</span> {entry.lineCount}</div>
                <div>
                  <span className="text-muted-foreground">Total estimado:</span>{" "}
                  {entry.estimatedTotal > 0 ? currencyFmt(entry.estimatedTotal) : "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Confiança IA:</span>{" "}
                  {entry.aiConfidence !== null ? `${Math.round(entry.aiConfidence * 100)}%` : "—"}
                  {isLowConfidence(entry.aiConfidence) && (
                    <span className="ml-1 text-amber-700 dark:text-amber-400 font-semibold">⚠ revisar</span>
                  )}
                </div>
                {entry.currencies.length > 1 && (
                  <div className="col-span-2 text-amber-700 dark:text-amber-400">
                    ⚠ Moedas divergentes: {entry.currencies.join(", ")}
                  </div>
                )}
              </div>

              {/* Barra de busca + filtros. Sempre visível para o usuário
                  entender que os resultados abaixo estão filtrados. */}
              <div className="rounded-md border bg-muted/20 p-2 space-y-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={detailsSearch}
                    onChange={(e) => setDetailsSearch(e.target.value)}
                    placeholder="Buscar por arquivo, item ou alerta…"
                    className="h-8 text-xs"
                  />
                  <Select
                    value={detailsTypeFilter}
                    onValueChange={(v) => setDetailsTypeFilter(v as typeof detailsTypeFilter)}
                  >
                    <SelectTrigger className="h-8 text-xs w-full sm:w-[150px]">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os tipos</SelectItem>
                      <SelectItem value="line">Somente linhas</SelectItem>
                      <SelectItem value="warning">Somente alertas</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={detailsConfidenceFilter}
                    onValueChange={(v) => setDetailsConfidenceFilter(v as typeof detailsConfidenceFilter)}
                  >
                    <SelectTrigger className="h-8 text-xs w-full sm:w-[170px]">
                      <SelectValue placeholder="Confiança" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Qualquer confiança</SelectItem>
                      <SelectItem value="low">Baixa (⚠ revisar)</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <div>
                    {group ? (
                      <>
                        {shownFiles.length} arquivo(s) · {totalItems} linha(s) · {totalWarns} alerta(s)
                      </>
                    ) : (
                      <>Detalhes por arquivo indisponíveis</>
                    )}
                  </div>
                  {filtersActive && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => {
                        setDetailsSearch("");
                        setDetailsTypeFilter("all");
                        setDetailsConfidenceFilter("all");
                      }}
                    >
                      Limpar filtros
                    </Button>
                  )}
                </div>
              </div>

              {/* Alertas agregados da entry (respeitam filtros de tipo/busca) */}
              {entry.aiWarnings.length > 0 && filteredAggWarnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <div className="font-medium">Alertas da IA:</div>
                  {filteredAggWarnings.map((w, i) => (
                    <div key={i} className="flex gap-1.5">
                      <span>⚠</span>
                      <span className="whitespace-pre-line">{w}</span>
                    </div>
                  ))}
                </div>
              )}
              {entry.errorMessage && !q && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="font-medium mb-0.5">Erro:</div>
                  {entry.errorMessage}
                </div>
              )}

              {/* Detalhe por arquivo. Quando temos o DocGroup, exibimos a
                  extração completa (itens, totais, avisos por documento). */}
              {group ? (
                shownFiles.length > 0 ? (
                  <div className="space-y-3">
                    {shownFiles.map((fv) => {
                      const { d, docIdx, visibleItems, visibleWarns, conf } = fv;
                      const total = Number(d.extracted?.total_amount);
                      return (
                        <div key={docIdx} className="rounded-md border p-3 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium truncate">📎 {d.file.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {(d.file.size / 1024).toFixed(1)} KB
                                {d.extracted?.doc_type && ` · ${d.extracted.doc_type}`}
                                {d.extracted?.currency && ` · ${d.extracted.currency}`}
                              </div>
                            </div>
                            {Number.isFinite(conf) && conf > 0 && (
                              <div className={`text-[11px] shrink-0 ${isLowConfidence(conf) ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                                IA {Math.round(conf * 100)}%
                              </div>
                            )}
                          </div>
                          {visibleWarns.length > 0 && (
                            <div className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                              {visibleWarns.map((w, i) => (
                                <div key={i}>⚠ {String(w)}</div>
                              ))}
                            </div>
                          )}
                          {showLines && visibleItems.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="w-full text-[11px]">
                                <thead className="text-muted-foreground">
                                  <tr className="border-b">
                                    <th className="text-left py-1 pr-2">Descrição</th>
                                    <th className="text-right py-1 px-2">Qtd</th>
                                    <th className="text-right py-1 px-2">Unit.</th>
                                    <th className="text-right py-1 pl-2">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibleItems.map(({ it, idx }) => {
                                    const qty = Number(it?.quantity) || 0;
                                    const up = Number(it?.unit_price) || 0;
                                    const lt = Number(it?.line_total) || qty * up;
                                    return (
                                      <tr key={idx} className="border-b border-border/50">
                                        <td className="py-1 pr-2">{it?.description || "—"}</td>
                                        <td className="py-1 px-2 text-right tabular-nums">{qty}</td>
                                        <td className="py-1 px-2 text-right tabular-nums">{currencyFmt(up)}</td>
                                        <td className="py-1 pl-2 text-right tabular-nums">{currencyFmt(lt)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : showLines && !filtersActive ? (
                            <div className="text-[11px] text-muted-foreground italic">Nenhuma linha extraída.</div>
                          ) : null}
                          {Number.isFinite(total) && total > 0 && !filtersActive && (
                            <div className="text-[11px] text-right text-muted-foreground">
                              Total do documento: <span className="text-foreground font-medium">{currencyFmt(total)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Nenhum resultado para os filtros atuais.
                  </div>
                )
              ) : (
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">Detalhes por arquivo indisponíveis</div>
                  <div>
                    A extração original deste grupo não está mais em cache (o modal
                    já concluiu ou descartou os dados). Arquivos processados:
                  </div>
                  <ul className="list-disc list-inside">
                    {entry.fileNames
                      .filter((n) => matches(n))
                      .map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>

  </>
  );
}
