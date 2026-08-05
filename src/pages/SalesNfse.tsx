import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Upload,
  Eye,
  FileCode,
  Mail,

} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch, authFetch } from "@/lib/auth-fetch";
import { sapQueryAll } from "@/lib/sap-client";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { PageHeader } from "@/components/PageHeader";
import { NfseReconcilePanel } from "@/components/NfseReconcilePanel";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { expenseRead } from "@/lib/expense-read";
import { logAuditAction } from "@/hooks/useAuditLog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PDF_BUCKET = "nfse-pdfs";

/* ── helpers ─────────────────────────────────────────────── */

function formatCurrency(value: number, currency = "BRL") {
  const valid = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: valid }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("pt-BR");
}

/** Traduz o estado técnico da sincronização para uma explicação em português. */
const SYNC_STATE_LABEL: Record<string, { label: string; hint: string }> = {
  pending: { label: "Aguardando envio", hint: "O pedido está na fila e ainda não foi enviado ao ERP." },
  queued: { label: "Na fila de retentativa", hint: "Houve uma falha temporária; o sistema tentará novamente automaticamente." },
  processing: { label: "Em processamento", hint: "O envio ao ERP está em andamento neste momento." },
  error: { label: "Erro de integração", hint: "O ERP recusou o documento. Veja a mensagem de erro abaixo." },
  failed: { label: "Falha definitiva", hint: "As tentativas automáticas se esgotaram. Corrija o motivo e reintegre manualmente." },
  synced: { label: "Integrado", hint: "O pedido foi criado no ERP com sucesso." },
};

type BlockCause = {
  /** categoria da causa: dado faltante, mapeamento, sessão, regra do ERP, etc. */
  category: string;
  /** explicação objetiva do bloqueio */
  detail: string;
  /** o que fazer para destravar */
  fix: string;
  severity: "error" | "warning" | "info";
};

/** Padrões conhecidos de erro do SAP/Service Layer → causa e correção. */
const ERROR_PATTERNS: { re: RegExp; cause: Omit<BlockCause, "detail"> }[] = [
  {
    re: /sess(ã|a)o|session|401|unauthorized|not logged/i,
    cause: {
      category: "Sessão do ERP",
      fix: "Faça login novamente no ERP e clique em Reintegrar. A sessão do SAP expira em 30 minutos.",
      severity: "warning",
    },
  },
  {
    re: /business partner|cardcode|parceiro de neg|BP code/i,
    cause: {
      category: "Cadastro do cliente",
      fix: "O código do cliente (CardCode) não existe ou está inativo no ERP. Corrija o cadastro do cliente e reintegre.",
      severity: "error",
    },
  },
  {
    re: /item(code)? |item n(ã|a)o|no matching records.*OITM/i,
    cause: {
      category: "Mapeamento de item",
      fix: "Um item do pedido não existe no ERP. Ajuste o mapeamento de itens ou cadastre o item e reintegre.",
      severity: "error",
    },
  },
  {
    re: /filial|BPL|branch/i,
    cause: {
      category: "Filial (BPL)",
      fix: "A filial informada não é válida para este cliente/série. Ajuste a filial do documento e reintegre.",
      severity: "error",
    },
  },
  {
    re: /project|projeto|OPRJ/i,
    cause: {
      category: "Projeto",
      fix: "O código de projeto não existe ou está bloqueado no ERP. Corrija o projeto do pedido e reintegre.",
      severity: "error",
    },
  },
  {
    re: /cost center|centro de custo|dimension|OOCR/i,
    cause: {
      category: "Centro de custo",
      fix: "O centro de custo não existe ou está inativo na dimensão configurada. Ajuste o CC e reintegre.",
      severity: "error",
    },
  },
  {
    re: /tax|imposto|utiliza(ç|c)(ã|a)o|usage|NCM|CFOP/i,
    cause: {
      category: "Parametrização fiscal",
      fix: "Falta parametrização fiscal (utilização, NCM ou CFOP). Ajuste no cadastro fiscal e reintegre.",
      severity: "error",
    },
  },
  {
    re: /period|per(í|i)odo|posting date|data de lan(ç|c)amento/i,
    cause: {
      category: "Período contábil",
      fix: "O período contábil da data do documento está fechado no ERP. Ajuste a data ou reabra o período.",
      severity: "error",
    },
  },
  {
    re: /timeout|ETIMEDOUT|ECONNRESET|fetch failed|network|503|502|circuit/i,
    cause: {
      category: "Indisponibilidade do ERP",
      fix: "Falha temporária de comunicação com o ERP. Basta reintegrar quando a base voltar a responder.",
      severity: "warning",
    },
  },
];

/** Playbook por categoria: causa provável no dia a dia + passos objetivos de correção. */
const ERROR_PLAYBOOK: Record<
  string,
  { probable: string; owner: string; actions: string[] }
> = {
  "Sessão do ERP": {
    probable: "A sessão do Service Layer expirou (validade de 30 min) ou foi encerrada em outro dispositivo.",
    owner: "Você mesmo (usuário do ERP Flow)",
    actions: [
      "Saia e faça login novamente no ERP dentro do ERP Flow.",
      "Repita a operação com “Reintegrar” logo após o login.",
      "Se repetir em poucos minutos, verifique se a mesma conta está logada em outra máquina.",
    ],
  },
  "Cadastro do cliente": {
    probable: "O CardCode do cliente não existe, está inativo ou está bloqueado para vendas no SAP.",
    owner: "Time de cadastro / Facilities",
    actions: [
      "Confirme o código do cliente no SAP (Parceiro de Negócios → Cliente).",
      "Reative o parceiro ou abra solicitação de cadastro se ele não existir.",
      "Após o cadastro, reintegre o pedido.",
    ],
  },
  "Mapeamento de item": {
    probable: "Um item do pedido não tem correspondente no cadastro de itens do SAP (OITM) ou o mapeamento está desatualizado.",
    owner: "Time de cadastro / Facilities",
    actions: [
      "Identifique o item citado na mensagem do ERP.",
      "Cadastre o item no SAP ou corrija o mapeamento de itens da empresa.",
      "Reintegre o pedido depois do ajuste.",
    ],
  },
  "Filial (BPL)": {
    probable: "A filial (BPLId) do documento não está habilitada para o cliente, para a série ou para o usuário.",
    owner: "Financeiro / Fiscal",
    actions: [
      "Confira a filial do pedido — por padrão as vendas usam a filial 1.",
      "Valide se o cliente e a série de numeração aceitam essa filial no SAP.",
      "Ajuste a filial no pedido e reintegre.",
    ],
  },
  Projeto: {
    probable: "O código de projeto informado não existe no SAP ou está bloqueado/encerrado.",
    owner: "Controladoria",
    actions: [
      "Verifique o projeto no SAP (OPRJ) e se ele está ativo.",
      "Troque o projeto do pedido para um código válido, se necessário.",
      "Reintegre após a correção.",
    ],
  },
  "Centro de custo": {
    probable: "O centro de custo não existe na dimensão configurada ou está inativo.",
    owner: "Controladoria",
    actions: [
      "Confirme o CC na dimensão usada por esta empresa.",
      "Reative o CC ou selecione outro válido no pedido.",
      "Reintegre o pedido.",
    ],
  },
  "Parametrização fiscal": {
    probable: "Falta parametrização fiscal do item/cliente (utilização, NCM, CFOP ou grupo de imposto).",
    owner: "Fiscal",
    actions: [
      "Confirme se a utilização (Usage) está preenchida no pedido.",
      "Peça ao fiscal a revisão de NCM/CFOP e determinação de imposto do item.",
      "Reintegre depois da parametrização.",
    ],
  },
  "Período contábil": {
    probable: "A data do documento cai em um período contábil já fechado no SAP.",
    owner: "Contabilidade",
    actions: [
      "Ajuste a data do documento para um período aberto, se for permitido.",
      "Ou solicite à contabilidade a reabertura do período.",
      "Reintegre em seguida.",
    ],
  },
  "Indisponibilidade do ERP": {
    probable: "Falha temporária de rede/serviço: o SAP não respondeu ou o circuit breaker da empresa está aberto.",
    owner: "TI / Integração",
    actions: [
      "Aguarde alguns minutos — o sistema também tenta novamente sozinho.",
      "Confirme se outras rotinas da mesma empresa estão respondendo.",
      "Use “Reintegrar” quando a base voltar a responder.",
    ],
  },
  "Falta de dados no documento": {
    probable: "O documento foi criado sem campos obrigatórios exigidos pela integração.",
    owner: "Solicitante do pedido",
    actions: [
      "Edite o pedido e preencha os campos apontados acima.",
      "Salve e reintegre.",
    ],
  },
  "Processamento em andamento": {
    probable: "Uma execução anterior travou e manteve o bloqueio de processamento ativo.",
    owner: "Você mesmo (usuário do ERP Flow)",
    actions: [
      "Aguarde alguns minutos.",
      "Se o bloqueio persistir, use “Reintegrar” para forçar uma nova execução.",
    ],
  },
  "Na fila de retentativa": {
    probable: "A última tentativa falhou e o pedido entrou no backoff automático.",
    owner: "Automático",
    actions: [
      "Aguarde o horário da próxima tentativa exibido abaixo.",
      "Ou force agora com “Reintegrar”.",
    ],
  },
  "Nunca enviado ao ERP": {
    probable: "O pedido nunca chegou a ser enviado — geralmente falta o disparo manual ou o documento ainda não foi aprovado.",
    owner: "Solicitante do pedido",
    actions: [
      "Confirme se o pedido está aprovado.",
      "Clique em “Reintegrar” para enviá-lo ao ERP.",
    ],
  },
  "Sem retorno do ERP": {
    probable: "A chamada foi feita, mas não retornou DocEntry nem mensagem — possível queda no meio do processo.",
    owner: "TI / Integração",
    actions: [
      "Verifique no SAP se o pedido já foi criado (evita duplicidade).",
      "Se não existir no SAP, reintegre.",
      "Se persistir, acione a TI com o horário da última tentativa.",
    ],
  },
  "Erro de integração": {
    probable: "O ERP recusou o documento por uma regra específica não catalogada.",
    owner: "TI / Integração",
    actions: [
      "Leia a mensagem original do ERP abaixo — ela indica o campo ou a regra recusada.",
      "Corrija o dado apontado no pedido ou no cadastro.",
      "Reintegre e, se persistir, encaminhe a mensagem à TI.",
    ],
  },
};

/** Extrai códigos de erro do SAP (ex.: -5002, 400) da mensagem bruta. */
function extractErpCodes(message: string): string[] {
  const codes = new Set<string>();
  for (const m of message.matchAll(/(-?\d{3,5})/g)) {
    const n = Number(m[1]);
    if (n <= -1000 || (n >= 400 && n <= 599)) codes.add(m[1]);
  }
  return [...codes];
}

/** Determina a causa exata do bloqueio da integração de um pedido de venda. */
function diagnoseBlock(order: SalesOrderRow): BlockCause {
  if (order.sap_doc_entry) {
    return {
      category: "Integrado",
      detail: `Pedido criado no ERP (DocEntry ${order.sap_doc_entry}).`,
      fix: "Nenhuma ação necessária.",
      severity: "info",
    };
  }

  // 1) Erro devolvido pelo ERP tem prioridade — é a causa concreta.
  const err = (order.sap_integration_error || "").trim();
  if (err) {
    const match = ERROR_PATTERNS.find((p) => p.re.test(err));
    return match
      ? { ...match.cause, detail: err }
      : {
          category: "Erro de integração",
          detail: err,
          fix: "Corrija o motivo apontado pelo ERP e clique em Reintegrar.",
          severity: "error",
        };
  }

  // 2) Sem erro registrado: verifica dados obrigatórios ausentes no documento.
  const missing: string[] = [];
  if (!order.supplier_code) missing.push("código do cliente (CardCode)");
  if (!order.doc_date) missing.push("data do documento");
  if (!order.total_amount) missing.push("valor total");
  if (!order.sales_usage) missing.push("utilização (fiscal)");
  if (!order.cost_center) missing.push("centro de custo");
  if (missing.length) {
    return {
      category: "Falta de dados no documento",
      detail: `Campos obrigatórios ausentes: ${missing.join(", ")}.`,
      fix: "Edite o pedido preenchendo os campos acima e clique em Reintegrar.",
      severity: "error",
    };
  }

  // 3) Sem erro e sem dado faltante: é questão de fila/estado.
  if (order.sap_integration_locked_at) {
    return {
      category: "Processamento em andamento",
      detail: `A integração está bloqueada em processamento desde ${formatDateTime(order.sap_integration_locked_at)}.`,
      fix: "Aguarde o término. Se passar de alguns minutos, reintegre para liberar o bloqueio.",
      severity: "warning",
    };
  }
  if (order.sap_sync_next_retry_at) {
    return {
      category: "Na fila de retentativa",
      detail: `Próxima tentativa automática em ${formatDateTime(order.sap_sync_next_retry_at)} (${order.sap_sync_attempts ?? 0} tentativa(s) até agora).`,
      fix: "Aguarde a retentativa automática ou force agora com Reintegrar.",
      severity: "warning",
    };
  }
  if (!order.sap_integration_last_attempt_at) {
    return {
      category: "Nunca enviado ao ERP",
      detail: "Não há registro de tentativa de integração para este pedido.",
      fix: "Clique em Reintegrar para enviar o pedido ao ERP agora.",
      severity: "warning",
    };
  }
  return {
    category: "Sem retorno do ERP",
    detail: `Última tentativa em ${formatDateTime(order.sap_integration_last_attempt_at)} não gerou DocEntry nem mensagem de erro.`,
    fix: "Reintegre e, se persistir, verifique os logs de integração da empresa.",
    severity: "error",
  };
}



const APPROVED_STATUSES = [
  "aprovado",
  "pc_lancado",
  "nf_entrada",
  "pagamento",
  "finalizado",
] as const;

interface SalesOrderRow {
  id: string;
  supplier_code: string | null;
  supplier_name: string;
  total_amount: number;
  currency: string;
  status: string;
  doc_date: string | null;
  requester_name: string | null;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  project: string | null;
  nfse_split_mode: string | null;
  sales_usage?: string | null;
  cost_center?: string | null;
  branch_id?: number | string | null;
  /** erp_flow = pedido criado nesta aplicação · erp = pedido criado direto no SAP */
  source: "erp_flow" | "erp";
  /** true quando o pedido já está fechado/faturado no ERP */
  erp_closed?: boolean;
  /** diagnóstico da integração com o ERP (somente pedidos do ERP Flow) */
  sap_sync_state?: string | null;
  sap_integration_error?: string | null;
  sap_integration_last_attempt_at?: string | null;
  sap_integration_locked_at?: string | null;
  sap_sync_attempts?: number | null;
  sap_sync_next_retry_at?: string | null;
}

interface SapOrder {
  DocEntry: number;
  DocNum: number;
  CardCode: string;
  CardName: string;
  DocDate: string;
  DocTotal: number;
  DocCurrency: string;
  DocumentStatus: string;
  Cancelled?: string;
  Project?: string | null;
}


interface NfseRow {
  id: string;
  expense_id: string | null;
  sap_order_doc_entry: number | null;
  sap_invoice_doc_entry: number | null;
  sap_invoice_doc_num: number | null;
  nfse_number: string | null;
  rps_number: string | null;
  series: string | null;
  status: string;
  authorized_at: string | null;
  total_amount: number;
  currency: string;
  last_error: string | null;
  created_at: string;
}

/* ── página ──────────────────────────────────────────────── */

export default function SalesNfse() {
  const { session, logout } = useSap();
  const { getLabel } = useCompanies();
  const companyDb = session?.companyDB || "";

  const [orders, setOrders] = useState<SalesOrderRow[]>([]);
  const [invoices, setInvoices] = useState<NfseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [erpWarning, setErpWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [originFilter, setOriginFilter] = useState<"all" | "erp_flow" | "erp">("all");
  const [confirmOrder, setConfirmOrder] = useState<SalesOrderRow | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pdfFiles, setPdfFiles] = useState<Set<string>>(new Set());
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [xmlPaths, setXmlPaths] = useState<Record<string, string>>({});
  const [xmlLoadingFor, setXmlLoadingFor] = useState<string | null>(null);
  const [retryingFor, setRetryingFor] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<SalesOrderRow | null>(null);
  const [retryTarget, setRetryTarget] = useState<SalesOrderRow | null>(null);
  const uploadTargetRef = useRef<{ order: SalesOrderRow; inv: NfseRow | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


  // envio de e-mail
  const [mailOrder, setMailOrder] = useState<SalesOrderRow | null>(null);
  const [mailInvoice, setMailInvoice] = useState<NfseRow | null>(null);
  const [mailTo, setMailTo] = useState("");
  const [mailCc, setMailCc] = useState("");
  const [mailSubject, setMailSubject] = useState("");
  const [mailMessage, setMailMessage] = useState("");
  const [mailSenderOk, setMailSenderOk] = useState(true);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailSending, setMailSending] = useState(false);

  const pdfPathFor = useCallback(
    (order: SalesOrderRow, inv: NfseRow | null) =>
      `${companyDb}/${inv?.sap_invoice_doc_entry ?? `pedido-${order.sap_doc_entry ?? order.id}`}.pdf`,
    [companyDb],
  );

  const loadPdfIndex = useCallback(async () => {
    if (!companyDb) return;
    const { data } = await supabase.storage.from(PDF_BUCKET).list(companyDb, { limit: 1000 });
    setPdfFiles(new Set((data || []).map((f) => `${companyDb}/${f.name}`)));
  }, [companyDb]);

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    setError(null);
    setErpWarning(null);
    try {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);
      const cutoffIso = cutoff.toISOString().slice(0, 10);

      const [{ data: exp, error: e1 }, { data: inv, error: e2 }, erpRes] = await Promise.all([
        expenseRead("expenses").viewAll()
          .select("id, supplier_code, supplier_name, total_amount, currency, status, doc_date, requester_name, sap_doc_entry, sap_doc_num, project, nfse_split_mode, sales_usage, cost_center, branch_id, sap_sync_state, sap_integration_error, sap_integration_last_attempt_at, sap_integration_locked_at, sap_sync_attempts, sap_sync_next_retry_at")
          .eq("company_db", companyDb)
          .eq("doc_type", "sales")
          .in("status", APPROVED_STATUSES)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("sales_order_invoices")
          .select("*")
          .eq("company_db", companyDb)
          .order("created_at", { ascending: false })
          .limit(500),
        session && session.erpType === "sap"
          ? sapQueryAll(
              session,
              "Orders",
              {
                $select:
                  "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocCurrency,DocumentStatus,Cancelled,Project",
                $filter: `DocDate ge '${cutoffIso}' and Cancelled ne 'tYES'`,
                $orderby: "DocDate desc",
              },
              true,
            ).catch((err: unknown) => {
              console.warn("SAP Orders fetch failed:", (err as Error).message);
              setErpWarning(
                "Não foi possível ler os pedidos de venda direto do ERP. Exibindo apenas os pedidos do ERP Flow.",
              );
              return { data: { value: [] as unknown[] } };
            })
          : Promise.resolve({ data: { value: [] as unknown[] } }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const flowRows = ((exp || []) as Omit<SalesOrderRow, "source">[]).map((o) => ({
        ...o,
        source: "erp_flow" as const,
      }));
      const flowDocEntries = new Set(
        flowRows.map((o) => Number(o.sap_doc_entry)).filter((n) => Number.isFinite(n)),
      );

      const erpRows: SalesOrderRow[] = (((erpRes as { data?: { value?: unknown[] } })?.data?.value ||
        []) as SapOrder[])
        .filter((o) => o && Number.isFinite(Number(o.DocEntry)))
        .filter((o) => !flowDocEntries.has(Number(o.DocEntry)))
        .map((o) => ({
          id: `erp:${o.DocEntry}`,
          supplier_code: o.CardCode || null,
          supplier_name: o.CardName || o.CardCode || "—",
          total_amount: Number(o.DocTotal || 0),
          currency: o.DocCurrency || "BRL",
          status: o.DocumentStatus === "bost_Close" ? "fechado" : "aberto",
          doc_date: o.DocDate || null,
          requester_name: null,
          sap_doc_entry: Number(o.DocEntry),
          sap_doc_num: Number(o.DocNum),
          project: o.Project || null,
          nfse_split_mode: null,
          source: "erp" as const,
          erp_closed: o.DocumentStatus === "bost_Close",
        }));

      setOrders([...flowRows, ...erpRows]);
      setInvoices((inv || []) as NfseRow[]);
      await loadPdfIndex();
    } catch (e) {
      setError((e as Error).message || "Falha ao carregar pedidos de venda");
    } finally {
      setLoading(false);
    }
  }, [companyDb, loadPdfIndex, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickPdf = useCallback((order: SalesOrderRow, inv: NfseRow | null) => {
    uploadTargetRef.current = { order, inv };
    fileInputRef.current?.click();
  }, []);

  const onPdfSelected = useCallback(
    async (file: File | undefined) => {
      const target = uploadTargetRef.current;
      if (!file || !target) return;
      if (file.type !== "application/pdf") {
        toast.error("Envie um arquivo PDF.");
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        toast.error("PDF acima do limite de 15MB.");
        return;
      }
      const path = pdfPathFor(target.order, target.inv);
      setUploadingFor(target.order.id);
      try {
        const { error } = await supabase.storage
          .from(PDF_BUCKET)
          .upload(path, file, { upsert: true, contentType: "application/pdf" });
        if (error) throw error;
        toast.success("PDF da NFS-e anexado.");
        await loadPdfIndex();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploadingFor(null);
        uploadTargetRef.current = null;
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [pdfPathFor, loadPdfIndex],
  );

  const viewPdf = useCallback(
    async (order: SalesOrderRow, inv: NfseRow | null) => {
      const path = pdfPathFor(order, inv);
      const { data, error } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(path, 300);
      if (error || !data?.signedUrl) {
        toast.error("Não foi possível abrir o PDF.");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
    [pdfPathFor],
  );

  // Reenvia o pedido de venda ao ERP quando a integração falhou/expirou.
  const retryIntegration = useCallback(
    async (order: SalesOrderRow) => {
      if (order.source !== "erp_flow" || order.sap_doc_entry) return;
      setRetryingFor(order.id);
      const auditBase = {
        entity_type: "sales_order",
        entity_id: order.id,
        actor_email: session?.userName || undefined,
        company_db: companyDb || undefined,
      };
      try {
        const res = await sapFunctionFetch("expense-to-sap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expense_id: order.id }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || (data && data.success === false)) {
          throw new Error(data?.error || `Falha na integração (HTTP ${res.status})`);
        }
        await logAuditAction({
          ...auditBase,
          action: "sales_order_retry_integration",
          details: {
            result: "success",
            supplier_name: order.supplier_name,
            sap_doc_num: order.sap_doc_num,
            attempts_before: order.sap_sync_attempts ?? null,
          },
        });
        toast.success("Integração solicitada — pedido enviado ao ERP");
        await load();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Falha ao solicitar integração";
        await logAuditAction({
          ...auditBase,
          action: "sales_order_retry_integration",
          details: {
            result: "error",
            error: message,
            supplier_name: order.supplier_name,
            sap_doc_num: order.sap_doc_num,
            attempts_before: order.sap_sync_attempts ?? null,
          },
        });
        toast.error(message);
      } finally {
        setRetryingFor(null);
      }
    },
    [load, session?.userName, companyDb],
  );


  const XML_REASONS: Record<string, string> = {
    hana_indisponivel: "Esta empresa não tem HanaAPI habilitada.",
    entidade_fiscal_nao_encontrada: "Entidade fiscal (TaxOne) não encontrada para esta base.",
    documento_fiscal_nao_encontrado: "Nota ainda não registrada no addon fiscal.",
    view_xml_nao_publicada: "View de XML autorizado ainda não criada nesta base.",
    xml_nao_encontrado: "XML autorizado ainda não disponível para esta nota.",
    xml_vazio: "XML autorizado veio vazio no addon fiscal.",
  };

  const fetchXml = useCallback(
    async (order: SalesOrderRow, inv: NfseRow | null, openAfter = true) => {
      if (!inv?.sap_invoice_doc_entry) return null;
      setXmlLoadingFor(order.id);
      try {
        const res = await authFetch("nfse-xml-fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_db: companyDb, doc_entry: inv.sap_invoice_doc_entry }),
        });
        const b = await res.json().catch(() => ({}));
        if (!res.ok || b?.error) throw new Error(b?.error || `Falha ao buscar XML (${res.status})`);
        if (b?.unavailable) {
          toast.info(XML_REASONS[b.reason] || "XML autorizado indisponível.");
          return null;
        }
        setXmlPaths((prev) => ({ ...prev, [order.id]: b.path }));
        if (openAfter && b.signed_url) window.open(b.signed_url, "_blank", "noopener,noreferrer");
        return b.path as string;
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      } finally {
        setXmlLoadingFor(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyDb],
  );



  const openMail = useCallback(
    async (order: SalesOrderRow, inv: NfseRow | null) => {
      setMailOrder(order);
      setMailInvoice(inv);
      setMailTo("");
      setMailCc("");
      setMailSubject(`NFS-e ${inv?.nfse_number ? `nº ${inv.nfse_number} ` : ""}- ${getLabel(companyDb)}`);
      setMailMessage(
        `Segue em anexo a nota fiscal de serviço${inv?.nfse_number ? ` nº ${inv.nfse_number}` : ""}.`,
      );
      setMailSenderOk(true);
      setMailLoading(true);
      try {
        const res = await authFetch("nfse-send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resolve",
            company_db: companyDb,
            customer_code: order.supplier_code || "",
            project_code: order.project || "",
            split_mode: order.nfse_split_mode === "per_brand" ? "per_brand" : "unified",
          }),
        });
        const b = await res.json().catch(() => ({}));
        if (res.ok && !b?.error) {
          setMailTo((b.to || []).join(", "));
          setMailCc((b.cc || []).join(", "));
          setMailSenderOk(!!b.sender?.configured);
        }
      } finally {
        setMailLoading(false);
      }
    },
    [companyDb, getLabel],
  );

  const sendMail = useCallback(async () => {
    if (!mailOrder) return;
    const path = pdfPathFor(mailOrder, mailInvoice);
    setMailSending(true);
    try {
      // XML autorizado: usa o já baixado ou tenta buscar no addon fiscal na hora.
      const xmlPath =
        xmlPaths[mailOrder.id] || (await fetchXml(mailOrder, mailInvoice, false)) || "";
      const res = await authFetch("nfse-send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          company_db: companyDb,
          expense_id: mailOrder.id,
          invoice_doc_entry: mailInvoice?.sap_invoice_doc_entry ?? null,
          nfse_number: mailInvoice?.nfse_number ?? null,
          customer_name: mailOrder.supplier_name,
          to: mailTo,
          cc: mailCc,
          subject: mailSubject,
          message: mailMessage,
          attachment_path: pdfFiles.has(path) ? path : "",
          attachment_xml_path: xmlPath,
        }),
      });

      const b = await res.json().catch(() => ({}));
      if (!res.ok || b?.error) throw new Error(b?.error || `Falha no envio (${res.status})`);
      toast.success(`E-mail enviado para ${(b.to || []).join(", ")}`);
      setMailOrder(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMailSending(false);
    }
  }, [mailOrder, mailInvoice, companyDb, mailTo, mailCc, mailSubject, mailMessage, pdfFiles, pdfPathFor, xmlPaths, fetchXml]);

  const invoiceByExpense = useMemo(() => {
    const map = new Map<string, NfseRow>();
    for (const row of invoices) {
      // pedidos do ERP Flow são indexados pelo expense_id; pedidos nativos do
      // ERP pelo DocEntry do pedido (chave `erp:<DocEntry>`).
      const key = row.expense_id
        ? row.expense_id
        : row.sap_order_doc_entry != null
          ? `erp:${row.sap_order_doc_entry}`
          : null;
      if (!key) continue;
      const current = map.get(key);
      // prioriza a nota válida mais recente sobre tentativas com falha
      if (!current || (current.status === "failed" && row.status !== "failed")) {
        map.set(key, row);
      }
    }
    return map;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let base = orders;
    if (originFilter !== "all") base = base.filter((o) => o.source === originFilter);
    if (!q) return base;
    return base.filter((o) => {
      const inv = invoiceByExpense.get(o.id);
      return (
        o.supplier_name.toLowerCase().includes(q) ||
        (o.supplier_code || "").toLowerCase().includes(q) ||
        String(o.sap_doc_num || "").includes(q) ||
        (inv?.nfse_number || "").toLowerCase().includes(q)
      );
    });
  }, [orders, search, invoiceByExpense, originFilter]);

  const pendentes = filtered.filter((o) => !invoiceByExpense.get(o.id)?.sap_invoice_doc_entry);

  const emit = useCallback(async () => {
    if (!confirmOrder) return;
    setEmitting(true);
    try {
      const payload =
        confirmOrder.source === "erp"
          ? {
              action: "emit",
              company_db: companyDb,
              sap_order_doc_entry: confirmOrder.sap_doc_entry,
              customer_name: confirmOrder.supplier_name,
              total_amount: confirmOrder.total_amount,
              currency: confirmOrder.currency,
            }
          : { action: "emit", expense_id: confirmOrder.id };
      const res = await sapFunctionFetch("sales-nfse-emit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) throw new Error(body?.error || `Falha ao emitir (${res.status})`);
      toast.success(`NFS-e criada no ERP — documento ${body.doc_num}`);
      setConfirmOrder(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEmitting(false);
    }
  }, [confirmOrder, load, companyDb]);

  const syncStatus = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await sapFunctionFetch("sales-nfse-emit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-status", company_db: companyDb }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) throw new Error(body?.error || `Falha na consulta (${res.status})`);
      toast.success(`Status fiscal atualizado (${body.updated ?? 0} nota[s]).`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [companyDb, load]);

  if (!session) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Sessão do ERP necessária</h1>
          <p className="text-sm text-muted-foreground">
            Faça login no ERP para emitir notas fiscais de serviço.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        icon={<FileText className="w-5 h-5 text-primary" />}
        title="Vendas"
        titleAccent="NFS-e"
        subtitle="Emissão manual da NFS-e para pedidos de venda do ERP Flow e criados direto no ERP"
        companyLabel={getLabel(companyDb)}
        userName={session?.userName}
        onLogout={logout}
        actions={
          <>
            <NfseReconcilePanel companyDb={companyDb} />
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void syncStatus()} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
              Atualizar status fiscal
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Atualizar
            </Button>
          </>
        }

      />

      <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, pedido ou nº da NFS-e"
              className="pl-8 h-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5">
            {([
              { key: "all", label: "Todos" },
              { key: "erp_flow", label: "ERP Flow" },
              { key: "erp", label: "ERP" },
            ] as const).map((opt) => (
              <Button
                key={opt.key}
                size="sm"
                variant={originFilter === opt.key ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setOriginFilter(opt.key)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} pedido(s) · {pendentes.length} aguardando emissão
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {erpWarning && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-600">
            {erpWarning}
          </div>
        )}


        {loading && orders.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum pedido de venda encontrado para esta empresa.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Pedido</th>
                  <th className="text-left px-3 py-2 font-medium">Origem</th>
                  <th className="text-left px-3 py-2 font-medium">Cliente</th>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-right px-3 py-2 font-medium">Valor</th>
                  <th className="text-left px-3 py-2 font-medium">NFS-e</th>
                  <th className="text-left px-3 py-2 font-medium">PDF</th>
                  <th className="text-right px-3 py-2 font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const inv = invoiceByExpense.get(o.id);
                  const emitted = !!inv?.sap_invoice_doc_entry;
                  return (
                    <tr key={o.id} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">
                        {o.sap_doc_num ? `#${o.sap_doc_num}` : "—"}
                        {!o.sap_doc_entry && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span
                              className="text-[11px] text-muted-foreground"
                              title={o.source === "erp_flow" ? diagnoseBlock(o).detail : undefined}
                            >
                              {o.source === "erp_flow"
                                ? diagnoseBlock(o).category
                                : "não integrado"}
                            </span>

                            {o.source === "erp_flow" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 gap-1 px-1.5 text-[11px]"
                                  title="Ver detalhes da integração com o ERP"
                                  onClick={() => setDetailOrder(o)}
                                >
                                  <AlertTriangle className="w-3 h-3" />
                                  Detalhes
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 gap-1 px-1.5 text-[11px]"
                                  disabled={retryingFor === o.id}
                                  title="Solicitar novamente a integração deste pedido no ERP"
                                  onClick={() => setRetryTarget(o)}
                                >
                                  {retryingFor === o.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3 h-3" />
                                  )}
                                  Reintegrar
                                </Button>
                              </>
                            )}
                          </div>

                        )}
                      </td>

                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[11px]">
                          {o.source === "erp_flow" ? "ERP Flow" : "ERP"}
                        </Badge>
                        {o.erp_closed && (
                          <span className="ml-2 text-[11px] text-muted-foreground">fechado</span>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <div className="font-medium">{o.supplier_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{o.supplier_code || "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{formatDate(o.doc_date)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatCurrency(Number(o.total_amount), o.currency)}
                      </td>
                      <td className="px-3 py-2">
                        {inv?.status === "authorized" ? (
                          <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                            <CheckCircle2 className="w-3 h-3" />
                            NFS-e {inv.nfse_number}
                            {inv.rps_number ? ` · RPS ${inv.rps_number}` : ""}
                          </Badge>
                        ) : emitted ? (
                          <Badge variant="outline" className="gap-1">
                            <Loader2 className="w-3 h-3" />
                            Emitida (doc {inv?.sap_invoice_doc_num}) · aguardando autorização
                          </Badge>
                        ) : inv?.status === "failed" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="w-3 h-3" />
                            {inv.last_error?.slice(0, 80) || "Falha na emissão"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Aguardando emissão</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const path = pdfPathFor(o, inv ?? null);
                          const hasPdf = pdfFiles.has(path);
                          return (
                            <div className="flex items-center gap-1">
                              {hasPdf && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 px-2 text-xs"
                                  onClick={() => void viewPdf(o, inv ?? null)}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Ver
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={uploadingFor === o.id}
                                onClick={() => pickPdf(o, inv ?? null)}
                              >
                                {uploadingFor === o.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Upload className="w-3.5 h-3.5" />
                                )}
                                {hasPdf ? "Substituir" : "Anexar"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={!inv?.sap_invoice_doc_entry || xmlLoadingFor === o.id}
                                title="Baixar XML autorizado direto do addon fiscal"
                                onClick={() => void fetchXml(o, inv ?? null)}
                              >
                                {xmlLoadingFor === o.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <FileCode className="w-3.5 h-3.5" />
                                )}
                                XML
                              </Button>
                            </div>

                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1"
                            disabled={!emitted}
                            onClick={() => void openMail(o, inv ?? null)}
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Enviar
                          </Button>
                          <Button
                            size="sm"
                            variant={emitted ? "ghost" : "default"}
                            disabled={emitted || !o.sap_doc_entry}
                            title={
                              emitted
                                ? "NFS-e já emitida para este pedido"
                                : !o.sap_doc_entry
                                  ? "Pedido ainda não integrado ao ERP — a NFS-e só pode ser emitida após a integração"
                                  : o.erp_closed
                                    ? "Pedido fechado no ERP — a emissão pode ser recusada se não houver linhas em aberto"
                                    : undefined
                            }
                            onClick={() => setConfirmOrder(o)}
                          >
                            {emitted ? "Emitida" : "Emitir NFS-e"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!confirmOrder} onOpenChange={(v) => !v && setConfirmOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar emissão de NFS-e</DialogTitle>
            <DialogDescription>
              A nota será criada no ERP a partir do pedido de venda e enviada ao addon fiscal.
            </DialogDescription>
          </DialogHeader>
          {confirmOrder && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Pedido</span>
                <span className="font-mono">#{confirmOrder.sap_doc_num}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Cliente</span>
                <span className="text-right">{confirmOrder.supplier_name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Valor</span>
                <span className="font-mono">
                  {formatCurrency(Number(confirmOrder.total_amount), confirmOrder.currency)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Solicitante</span>
                <span>{confirmOrder.requester_name || "—"}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOrder(null)} disabled={emitting}>
              Cancelar
            </Button>
            <Button onClick={() => void emit()} disabled={emitting} className="gap-2">
              {emitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Emitir NFS-e
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => void onPdfSelected(e.target.files?.[0])}
      />

      <Dialog open={!!mailOrder} onOpenChange={(v) => !v && setMailOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar NFS-e por e-mail</DialogTitle>
            <DialogDescription>
              {mailInvoice?.nfse_number
                ? `Nota nº ${mailInvoice.nfse_number} · ${mailOrder?.supplier_name || ""}`
                : mailOrder?.supplier_name}
            </DialogDescription>
          </DialogHeader>

          {mailLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-3">
              {!mailSenderOk && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  Remetente de e-mail não configurado para esta empresa (Backoffice → E-mail NFS-e).
                </div>
              )}
              {mailOrder && !pdfFiles.has(pdfPathFor(mailOrder, mailInvoice)) && (
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                  Nenhum PDF anexado a esta nota — o e-mail será enviado sem anexo.
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Para</Label>
                <Input value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="cliente@dominio.com" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cópia</Label>
                <Input value={mailCc} onChange={(e) => setMailCc(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Assunto</Label>
                <Input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Mensagem</Label>
                <Textarea rows={4} value={mailMessage} onChange={(e) => setMailMessage(e.target.value)} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMailOrder(null)} disabled={mailSending}>
              Cancelar
            </Button>
            <Button onClick={() => void sendMail()} disabled={mailSending || !mailTo.trim()} className="gap-2">
              {mailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diagnóstico da integração com o ERP */}
      <Dialog open={!!detailOrder} onOpenChange={(open) => !open && setDetailOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Status da integração no ERP</DialogTitle>
            <DialogDescription>
              {detailOrder?.supplier_name} · {formatCurrency(detailOrder?.total_amount || 0, detailOrder?.currency)}
            </DialogDescription>
          </DialogHeader>

          {detailOrder && (() => {
            const cause = diagnoseBlock(detailOrder);
            const playbook = ERROR_PLAYBOOK[cause.category];
            const codes = extractErpCodes(detailOrder.sap_integration_error || "");
            const tone =
              cause.severity === "error"
                ? "border-destructive/40 bg-destructive/5"
                : cause.severity === "warning"
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-border/60";
            return (
            <div className="space-y-3 text-sm">
              <div className={`rounded-md border p-3 ${tone}`}>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Causa do bloqueio
                </div>
                <div className="mt-0.5 font-medium">{cause.category}</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs">{cause.detail}</p>
                <p className="mt-2 text-xs">
                  <span className="font-medium">Como corrigir: </span>
                  {cause.fix}
                </p>
              </div>

              {playbook && !detailOrder.sap_doc_entry && (
                <div className="rounded-md border border-border/60 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Causa provável e ação recomendada
                  </div>
                  <p className="mt-1 text-xs">{playbook.probable}</p>
                  <p className="mt-2 text-xs">
                    <span className="font-medium">Responsável indicado: </span>
                    {playbook.owner}
                  </p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">
                    {playbook.actions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ol>
                  {codes.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span>Códigos retornados pelo ERP:</span>
                      {codes.map((c) => (
                        <Badge key={c} variant="outline" className="font-mono text-[10px]">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}



              <div className="rounded-md border border-border/60 p-3">
                <div className="font-medium">
                  {SYNC_STATE_LABEL[detailOrder.sap_sync_state || ""]?.label ||
                    (detailOrder.sap_doc_entry ? "Integrado" : "Ainda não enviado ao ERP")}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {SYNC_STATE_LABEL[detailOrder.sap_sync_state || ""]?.hint ||
                    "Nenhuma tentativa de integração registrada até o momento. Use “Reintegrar” para enviar o pedido ao ERP."}
                </p>
              </div>


              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <dt className="text-muted-foreground">DocEntry no ERP</dt>
                <dd className="font-mono">{detailOrder.sap_doc_entry ?? "não gerado"}</dd>
                <dt className="text-muted-foreground">Estado técnico</dt>
                <dd className="font-mono">{detailOrder.sap_sync_state || "—"}</dd>
                <dt className="text-muted-foreground">Tentativas</dt>
                <dd>{detailOrder.sap_sync_attempts ?? 0}</dd>
                <dt className="text-muted-foreground">Última tentativa</dt>
                <dd>{formatDateTime(detailOrder.sap_integration_last_attempt_at)}</dd>
                <dt className="text-muted-foreground">Próxima retentativa</dt>
                <dd>{formatDateTime(detailOrder.sap_sync_next_retry_at)}</dd>
                <dt className="text-muted-foreground">Bloqueio em processamento</dt>
                <dd>{formatDateTime(detailOrder.sap_integration_locked_at)}</dd>
              </dl>

              {detailOrder.sap_integration_error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <div className="text-xs font-medium text-destructive">Mensagem retornada pelo ERP</div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs">
                    {detailOrder.sap_integration_error}
                  </p>
                </div>
              )}
            </div>
            );
          })()}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDetailOrder(null)}>
              Fechar
            </Button>
            {detailOrder && !detailOrder.sap_doc_entry && detailOrder.source === "erp_flow" && (
              <Button
                className="gap-2"
                disabled={retryingFor === detailOrder.id}
                onClick={() => {
                  const target = detailOrder;
                  setDetailOrder(null);
                  setRetryTarget(target);
                }}
              >
                {retryingFor === detailOrder.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Reintegrar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação antes de reintegrar (evita cliques acidentais) */}
      <AlertDialog open={!!retryTarget} onOpenChange={(open) => !open && setRetryTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reintegrar pedido no ERP?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  O pedido será reenviado ao ERP agora. Confirme os dados antes de prosseguir — a ação
                  fica registrada na auditoria.
                </p>
                {retryTarget && (
                  <ul className="rounded-md border p-2 text-xs">
                    <li>
                      <span className="text-muted-foreground">Cliente: </span>
                      {retryTarget.supplier_name}
                    </li>
                    <li>
                      <span className="text-muted-foreground">Valor: </span>
                      {formatCurrency(retryTarget.total_amount, retryTarget.currency)}
                    </li>
                    <li>
                      <span className="text-muted-foreground">Data: </span>
                      {formatDate(retryTarget.doc_date)}
                    </li>
                    <li>
                      <span className="text-muted-foreground">Tentativas anteriores: </span>
                      {retryTarget.sap_sync_attempts ?? 0}
                    </li>
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = retryTarget;
                setRetryTarget(null);
                if (target) void retryIntegration(target);
              }}
            >
              Confirmar reintegração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
}
