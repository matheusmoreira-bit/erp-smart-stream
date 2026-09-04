import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  Download,
  Eye,
  FileCheck2,
  FileUp,
  Landmark,
  Loader2,
  PencilLine,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { resolveSapSession } from "@/lib/sap-session-broker";
import { PageTitle } from "@/components/PageTitle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PaymentMethod = "boleto" | "pix" | "ted" | "unknown";
type RemittancePaymentMethod = "boleto" | "pix" | "ted" | "unknown";
type SupplierPaymentMethod = "ted" | "pix";

interface OpenTitle {
  key: string;
  sap_doc_entry: number;
  sap_doc_num: number;
  installment_id: number;
  supplier_code: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  document_date: string;
  due_date: string;
  open_amount: number;
  currency: string;
  description: string;
  cost_centers: string[];
  projects: string[];
  payment_method: PaymentMethod;
  payment_method_label: string;
  boleto_barcode?: string | null;
  boleto_digitable_line?: string | null;
  beneficiary_name?: string | null;
  beneficiary_tax_id?: string | null;
  bank_code?: string | null;
  branch?: string | null;
  branch_digit?: string | null;
  account_number?: string | null;
  account_digit?: string | null;
  account_type?: string | null;
  pix_key_type?: string | null;
  pix_key?: string | null;
  bank_account_summary?: string | null;
  payment_data_source?: string | null;
}

interface BankConfig {
  legal_name: string;
  tax_id: string;
  agreement_code: string;
  agency: string;
  agency_digit: string;
  account_number: string;
  account_digit: string;
  agency_account_digit: string;
  sap_transfer_account: string;
  active?: boolean;
}

interface SupplierPaymentForm {
  supplier_code: string;
  supplier_name: string;
  supplier_tax_id: string;
  method: SupplierPaymentMethod;
  beneficiary_name: string;
  beneficiary_tax_id: string;
  bank_code: string;
  branch: string;
  branch_digit: string;
  account_number: string;
  account_digit: string;
  account_type: string;
  pix_key_type: string;
  pix_key: string;
}

interface BatchItem {
  id: string;
  supplier_code?: string | null;
  supplier_name: string;
  supplier_tax_id?: string | null;
  sap_doc_entry?: number | null;
  sap_doc_num: number;
  installment_id?: number | null;
  due_date?: string | null;
  scheduled_date?: string | null;
  amount: number;
  currency?: string | null;
  barcode?: string | null;
  payment_method?: PaymentMethod | null;
  payment_metadata?: Record<string, unknown> | null;
  company_reference?: string | null;
  status: string;
  sap_payment_doc_num?: number | null;
  sap_error?: string | null;
}

interface Batch {
  id: string;
  filename: string;
  file_sequence: number;
  payment_date: string;
  title_count: number;
  total_amount: number;
  status: string;
  generated_at: string;
  content_sha256?: string | null;
  return_filename?: string | null;
  error_message?: string | null;
  accounts_payable_batch_items?: BatchItem[];
}

interface ReturnMatch {
  lineNumber: number;
  companyReference: string;
  supplierName: string;
  paymentDate: string | null;
  paymentAmount: number;
  occurrenceCodes: string[];
  status: "paid" | "scheduled" | "rejected" | "unknown";
  item: BatchItem | null;
}

interface ReturnPreview {
  fileSequence: number;
  recordCount: number;
  matches: ReturnMatch[];
}

const emptyConfig: BankConfig = {
  legal_name: "",
  tax_id: "",
  agreement_code: "",
  agency: "",
  agency_digit: "",
  account_number: "",
  account_digit: "",
  agency_account_digit: "",
  sap_transfer_account: "",
};

const emptySupplierPaymentForm: SupplierPaymentForm = {
  supplier_code: "",
  supplier_name: "",
  supplier_tax_id: "",
  method: "ted",
  beneficiary_name: "",
  beneficiary_tax_id: "",
  bank_code: "",
  branch: "",
  branch_digit: "",
  account_number: "",
  account_digit: "",
  account_type: "",
  pix_key_type: "",
  pix_key: "",
};

const SAP_REQUIRED_ACTIONS = new Set(["list_open", "generate", "process_return", "get_supplier_payment_profile", "save_supplier_payment_profile"]);

function normalizeCurrency(currency?: string | null) {
  const value = String(currency || "BRL").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : "BRL";
}

const money = (value: number | string | null | undefined, currency = "BRL") => {
  const amount = Number(value);
  return (Number.isFinite(amount) ? amount : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: normalizeCurrency(currency),
  });
};

const date = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString("pt-BR", { timeZone: "UTC" });
};

const dateTime = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("pt-BR");
};

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=windows-1252" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
};
const defaultDueFrom = () => daysAgo(10);
const defaultDueTo = today;

const batchStatus: Record<string, string> = {
  generated: "Remessa gerada",
  processing: "Processando retorno",
  processed: "Processado",
  partial: "Processado parcialmente",
  error: "Com erro",
  cancelled: "Cancelado",
};

const itemStatus: Record<string, string> = {
  remitted: "Enviado",
  scheduled: "Agendado",
  bank_rejected: "Rejeitado pelo banco",
  paid: "Pago, aguardando SAP",
  sap_processing: "Baixando no SAP",
  sap_settled: "Baixado no SAP",
  sap_error: "Falha na baixa SAP",
  already_settled: "Já baixado no SAP",
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
  unknown: "Sem dados",
};

function asRemittancePaymentMethod(method: PaymentMethod | string | null | undefined): RemittancePaymentMethod {
  return method === "boleto" || method === "pix" || method === "ted" ? method : "unknown";
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function boletoBarcodeFrom(value: string | null | undefined) {
  const clean = digits(value || "");
  if (clean.length === 44) return clean;
  if (clean.length === 47) {
    return `${clean.slice(0, 4)}${clean.slice(32, 33)}${clean.slice(33, 47)}${clean.slice(4, 9)}${clean.slice(10, 20)}${clean.slice(21, 31)}`;
  }
  if (clean.length === 48) {
    return `${clean.slice(0, 11)}${clean.slice(12, 23)}${clean.slice(24, 35)}${clean.slice(36, 47)}`;
  }
  return clean;
}

function dateInRange(value: string | null | undefined, start: string, end: string) {
  const day = String(value || "").slice(0, 10);
  if (!day) return false;
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

function amountInRange(value: number, min: string, max: string) {
  const from = min ? Number(String(min).replace(",", ".")) : null;
  const to = max ? Number(String(max).replace(",", ".")) : null;
  if (from != null && Number.isFinite(from) && value < from) return false;
  if (to != null && Number.isFinite(to) && value > to) return false;
  return true;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "processed" || status === "sap_settled" || status === "already_settled") return "default";
  if (status === "error" || status === "sap_error" || status === "bank_rejected") return "destructive";
  return "secondary";
}

export default function AccountsPayable() {
  const navigate = useNavigate();
  const { session } = useSap();
  const companyDb = session?.companyDB;
  const returnInputRef = useRef<HTMLInputElement>(null);

  const [titles, setTitles] = useState<OpenTitle[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [barcodes, setBarcodes] = useState<Record<string, string>>({});
  const [titlePaymentMethods, setTitlePaymentMethods] = useState<Record<string, RemittancePaymentMethod>>({});
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [dueFrom, setDueFrom] = useState(defaultDueFrom);
  const [dueTo, setDueTo] = useState(defaultDueTo);
  const [paymentFrom, setPaymentFrom] = useState("");
  const [paymentTo, setPaymentTo] = useState("");
  const [amountFrom, setAmountFrom] = useState("");
  const [amountTo, setAmountTo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"all" | RemittancePaymentMethod>("all");
  const [paymentDate, setPaymentDate] = useState(today());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<BankConfig>(emptyConfig);
  const [savingConfig, setSavingConfig] = useState(false);
  const [supplierPaymentOpen, setSupplierPaymentOpen] = useState(false);
  const [supplierPaymentTitle, setSupplierPaymentTitle] = useState<OpenTitle | null>(null);
  const [supplierPaymentForm, setSupplierPaymentForm] = useState<SupplierPaymentForm>(emptySupplierPaymentForm);
  const [supplierPaymentLoading, setSupplierPaymentLoading] = useState(false);
  const [supplierPaymentSaving, setSupplierPaymentSaving] = useState(false);
  const [returnContent, setReturnContent] = useState("");
  const [returnFilename, setReturnFilename] = useState("");
  const [returnPreview, setReturnPreview] = useState<ReturnPreview | null>(null);
  const [processingReturn, setProcessingReturn] = useState(false);

  const call = useCallback(async <T,>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
    if (!companyDb) throw new Error("Selecione uma empresa SAP.");
    const sapHeaders: Record<string, string> = {};
    if (session?.erpType === "sap" && SAP_REQUIRED_ACTIONS.has(action)) {
      const resolved = await resolveSapSession(companyDb, false) || await resolveSapSession(companyDb, true);
      if (!resolved?.sessionId) throw new Error("Sessão SAP não encontrada. Entre na empresa SAP para carregar os títulos em aberto.");
      sapHeaders["x-sap-session"] = resolved.sessionId;
      sapHeaders["x-sap-route"] = resolved.routeId || "";
      sapHeaders["x-sap-user"] = resolved.userName;
      sapHeaders["x-company-db"] = resolved.companyDB;
    }
    const response = await sapFunctionFetch("accounts-payable-cnab", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sapHeaders },
      body: JSON.stringify({ action, company_db: companyDb, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `Falha no serviço (${response.status}).`);
    return body as T;
  }, [companyDb, session?.erpType]);

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    try {
      const [openResult, batchResult, configResult] = await Promise.allSettled([
        call<{ titles: OpenTitle[] }>("list_open", {
          due_from: dueFrom || undefined,
          due_to: dueTo || undefined,
        }),
        call<{ batches: Batch[] }>("list_batches"),
        call<{ config: BankConfig | null }>("get_config"),
      ]);

      if (openResult.status === "fulfilled") {
        const nextTitles = openResult.value.titles || [];
        setTitles(nextTitles);
        setSelected((current) => new Set([...current].filter((key) => nextTitles.some((title) => title.key === key))));
      } else {
        setTitles([]);
        setSelected(new Set());
        toast.error(openResult.reason instanceof Error ? openResult.reason.message : String(openResult.reason));
      }

      if (batchResult.status === "fulfilled") {
        setBatches(batchResult.value.batches || []);
      } else {
        setBatches([]);
        toast.warning(batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason));
      }

      if (configResult.status === "fulfilled") {
        setConfig(configResult.value.config ? { ...emptyConfig, ...configResult.value.config } : emptyConfig);
      } else {
        setConfig(emptyConfig);
        toast.warning(configResult.reason instanceof Error ? configResult.reason.message : String(configResult.reason));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [call, companyDb, dueFrom, dueTo]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setBarcodes((current) => {
      let changed = false;
      const next = { ...current };
      for (const title of titles) {
        const detected = boletoBarcodeFrom(title.boleto_barcode || title.boleto_digitable_line || "");
        if (detected.length === 44 && !next[title.key]) {
          next[title.key] = detected;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [titles]);

  useEffect(() => {
    setTitlePaymentMethods((current) => {
      let changed = false;
      const next = { ...current };
      for (const title of titles) {
        if (!next[title.key]) {
          next[title.key] = asRemittancePaymentMethod(title.payment_method);
          changed = true;
        }
      }
      for (const key of Object.keys(next)) {
        if (!titles.some((title) => title.key === key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [titles]);

  const methodOf = useCallback((title: OpenTitle): RemittancePaymentMethod => (
    titlePaymentMethods[title.key] || asRemittancePaymentMethod(title.payment_method)
  ), [titlePaymentMethods]);

  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("pt-BR");
    const supplier = supplierFilter.trim().toLocaleLowerCase("pt-BR");
    return titles.filter((title) =>
      (!value || [title.sap_doc_num, title.supplier_name, title.supplier_code, title.description, ...title.cost_centers, ...title.projects]
        .some((field) => String(field || "").toLocaleLowerCase("pt-BR").includes(value))) &&
      (!supplier || [title.supplier_name, title.supplier_code, title.supplier_tax_id].some((field) => String(field || "").toLocaleLowerCase("pt-BR").includes(supplier))) &&
      (!dueFrom && !dueTo || dateInRange(title.due_date, dueFrom, dueTo)) &&
      (!paymentFrom && !paymentTo || dateInRange(paymentDate, paymentFrom, paymentTo)) &&
      amountInRange(title.open_amount, amountFrom, amountTo) &&
      (paymentMethod === "all" || methodOf(title) === paymentMethod),
    );
  }, [amountFrom, amountTo, dueFrom, dueTo, methodOf, paymentDate, paymentFrom, paymentMethod, paymentTo, query, supplierFilter, titles]);

  const selectedTitles = useMemo(() => titles.filter((title) => selected.has(title.key)), [selected, titles]);
  const selectedTotal = useMemo(() => selectedTitles.reduce((sum, title) => sum + title.open_amount, 0), [selectedTitles]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((title) => selected.has(title.key));
  const selectedMissingMethod = useMemo(() => selectedTitles.filter((title) => methodOf(title) === "unknown"), [methodOf, selectedTitles]);
  const selectedMissingBarcode = useMemo(
    () => selectedTitles.filter((title) => methodOf(title) === "boleto" && boletoBarcodeFrom(barcodes[title.key] || title.boleto_barcode || title.boleto_digitable_line || "").length !== 44),
    [barcodes, methodOf, selectedTitles],
  );
  const selectedMissingTedData = useMemo(
    () => selectedTitles.filter((title) => methodOf(title) === "ted" && !(digits(title.bank_code || "") && digits(title.branch || "") && digits(title.account_number || "") && digits(title.beneficiary_tax_id || title.supplier_tax_id || ""))),
    [methodOf, selectedTitles],
  );
  const selectedMissingPixData = useMemo(
    () => selectedTitles.filter((title) => methodOf(title) === "pix" && !(String(title.pix_key_type || "").trim() && String(title.pix_key || "").trim() && digits(title.beneficiary_tax_id || title.supplier_tax_id || ""))),
    [methodOf, selectedTitles],
  );
  const canGenerate = selectedTitles.length > 0 && selectedMissingMethod.length === 0 && selectedMissingBarcode.length === 0 && selectedMissingTedData.length === 0 && selectedMissingPixData.length === 0;

  const activeFilterCount = useMemo(() => {
    const dueFilterChanged = dueFrom !== defaultDueFrom() || dueTo !== defaultDueTo();
    return [
      query,
      supplierFilter,
      dueFilterChanged ? "due" : "",
      paymentFrom,
      paymentTo,
      amountFrom,
      amountTo,
      paymentMethod !== "all" ? paymentMethod : "",
    ].filter(Boolean).length;
  }, [amountFrom, amountTo, dueFrom, dueTo, paymentFrom, paymentMethod, paymentTo, query, supplierFilter]);

  function toggleTitle(key: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }

  function toggleFiltered(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      filtered.forEach((title) => checked ? next.add(title.key) : next.delete(title.key));
      return next;
    });
  }

  function hasSupplierPaymentData(title: OpenTitle) {
    return Boolean(title.pix_key || title.bank_account_summary);
  }

  async function openSupplierPayment(title: OpenTitle) {
    setSupplierPaymentTitle(title);
    setSupplierPaymentForm({
      ...emptySupplierPaymentForm,
      supplier_code: title.supplier_code,
      supplier_name: title.supplier_name,
      supplier_tax_id: digits(title.supplier_tax_id || ""),
      beneficiary_name: title.supplier_name,
      beneficiary_tax_id: digits(title.supplier_tax_id || ""),
      method: title.payment_method === "pix" ? "pix" : "ted",
      bank_code: title.bank_code || "",
      branch: title.branch || "",
      branch_digit: title.branch_digit || "",
      account_number: title.account_number || "",
      account_digit: title.account_digit || "",
      account_type: title.account_type || "",
      pix_key_type: title.pix_key_type || "",
      pix_key: title.pix_key || "",
    });
    setSupplierPaymentOpen(true);
    setSupplierPaymentLoading(true);
    try {
      const result = await call<{ profile: Partial<SupplierPaymentForm> }>("get_supplier_payment_profile", {
        supplier_code: title.supplier_code,
      });
      setSupplierPaymentForm((current) => ({
        ...current,
        ...result.profile,
        supplier_code: title.supplier_code,
        supplier_name: result.profile?.supplier_name || title.supplier_name,
        supplier_tax_id: digits(result.profile?.supplier_tax_id || title.supplier_tax_id || ""),
        beneficiary_name: result.profile?.beneficiary_name || title.supplier_name,
        beneficiary_tax_id: digits(result.profile?.beneficiary_tax_id || title.supplier_tax_id || ""),
        method: (result.profile?.method === "pix" ? "pix" : "ted") as SupplierPaymentMethod,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSupplierPaymentLoading(false);
    }
  }

  const supplierPaymentValid = useMemo(() => {
    if (!supplierPaymentForm.beneficiary_name.trim() || !digits(supplierPaymentForm.beneficiary_tax_id)) return false;
    if (supplierPaymentForm.method === "ted") {
      return Boolean(digits(supplierPaymentForm.bank_code) && digits(supplierPaymentForm.branch) && digits(supplierPaymentForm.account_number));
    }
    return Boolean(supplierPaymentForm.pix_key_type.trim() && supplierPaymentForm.pix_key.trim());
  }, [supplierPaymentForm]);

  function setSupplierPaymentField<K extends keyof SupplierPaymentForm>(key: K, value: SupplierPaymentForm[K]) {
    setSupplierPaymentForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSupplierPayment() {
    if (!supplierPaymentTitle || !supplierPaymentValid) return;
    setSupplierPaymentSaving(true);
    try {
      const result = await call<{ profile: Partial<SupplierPaymentForm>; sap_patch?: { patched?: boolean } }>("save_supplier_payment_profile", {
        supplier_code: supplierPaymentTitle.supplier_code,
        profile: supplierPaymentForm,
      });
      setSupplierPaymentOpen(false);
      toast.success(result.sap_patch?.patched ? "Dados do fornecedor salvos e sincronizados com o SAP." : "Dados do fornecedor salvos com auditoria.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSupplierPaymentSaving(false);
    }
  }

  async function generate() {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const result = await call<{ filename: string; content: string; title_count: number }>("generate", {
        payment_date: paymentDate,
        titles: selectedTitles.map((title) => ({
          sap_doc_entry: title.sap_doc_entry,
          installment_id: title.installment_id,
          amount: title.open_amount,
          barcode: boletoBarcodeFrom(barcodes[title.key] || title.boleto_barcode || title.boleto_digitable_line || ""),
          payment_method: methodOf(title),
          beneficiary_name: title.beneficiary_name || title.supplier_name,
          beneficiary_tax_id: title.beneficiary_tax_id || title.supplier_tax_id,
          bank_code: title.bank_code,
          branch: title.branch,
          branch_digit: title.branch_digit,
          account_number: title.account_number,
          account_digit: title.account_digit,
          account_type: title.account_type,
          pix_key_type: title.pix_key_type,
          pix_key: title.pix_key,
          supplier_tax_id: title.supplier_tax_id,
        })),
      });
      downloadTextFile(result.filename, result.content);
      setSelected(new Set());
      toast.success(`${result.title_count} título(s) incluído(s) na remessa.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }

  async function downloadBatch(batch: Batch) {
    setDownloadingBatchId(batch.id);
    try {
      const result = await call<{ filename: string; content: string; regenerated?: boolean }>("download_batch", {
        batch_id: batch.id,
      });
      downloadTextFile(result.filename || batch.filename, result.content);
      toast.success(result.regenerated ? "Arquivo reconstruído e baixado." : "Arquivo baixado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadingBatchId(null);
    }
  }

  async function saveConfig() {
    setSavingConfig(true);
    try {
      const result = await call<{ config: BankConfig }>("save_config", config as unknown as Record<string, unknown>);
      setConfig({ ...emptyConfig, ...result.config });
      setConfigOpen(false);
      toast.success("Configuração bancária salva.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingConfig(false);
    }
  }

  async function readReturn(file?: File) {
    if (!file) return;
    try {
      const content = await file.text();
      const preview = await call<ReturnPreview>("preview_return", { content });
      setReturnContent(content);
      setReturnFilename(file.name);
      setReturnPreview(preview);
    } catch (error) {
      setReturnPreview(null);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function processReturn() {
    if (!returnPreview || !returnContent) return;
    setProcessingReturn(true);
    try {
      const result = await call<{ status: string; results: unknown[] }>("process_return", {
        content: returnContent,
        filename: returnFilename,
      });
      toast.success(`Retorno processado: ${result.results.length} ocorrência(s).`);
      setReturnContent("");
      setReturnFilename("");
      setReturnPreview(null);
      if (returnInputRef.current) returnInputRef.current.value = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setProcessingReturn(false);
    }
  }

  const returnTotals = useMemo(() => {
    const matches = returnPreview?.matches || [];
    return {
      paid: matches.filter((item) => item.status === "paid").length,
      scheduled: matches.filter((item) => item.status === "scheduled").length,
      rejected: matches.filter((item) => item.status === "rejected").length,
      unmatched: matches.filter((item) => !item.item).length,
    };
  }, [returnPreview]);

  const selectedBatchItems = selectedBatch?.accounts_payable_batch_items || [];

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Contas a Pagar" />
      <header className="border-b border-border px-4 py-5 md:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-cyan-400">
              <Landmark className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-foreground md:text-2xl">Contas a Pagar</h1>
              <p className="text-sm text-muted-foreground">Remessas e retornos CNAB 240 Sicoob</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="icon" aria-label="Configuração bancária" onClick={() => setConfigOpen(true)}>
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Atualizar" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <Tabs defaultValue="open" className="space-y-5">
          <TabsList>
            <TabsTrigger value="open">Títulos em aberto</TabsTrigger>
            <TabsTrigger value="batches">Lotes CNAB</TabsTrigger>
            <TabsTrigger value="returns">Retornos</TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="space-y-5">
            <div className="flex flex-col gap-3 border-y border-border py-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" className="gap-2" onClick={() => setFiltersOpen(true)}>
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtros
                  {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount}</Badge>}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {filtered.length} de {titles.length} título(s)
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
                <div className="space-y-1.5">
                  <Label htmlFor="payment-date">Data do pagamento</Label>
                  <Input id="payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="w-[170px]" />
                </div>
                <div className="min-w-[180px] text-left sm:text-right">
                  <p className="text-xs text-muted-foreground">{selectedTitles.length} selecionado(s)</p>
                  <p className="font-semibold text-foreground">{money(selectedTotal)}</p>
                  {selectedMissingMethod.length > 0 && <p className="text-xs text-amber-500">Há título sem forma de pagamento definida.</p>}
                  {selectedMissingBarcode.length > 0 && <p className="text-xs text-amber-500">Há boleto sem código válido.</p>}
                  {selectedMissingTedData.length > 0 && <p className="text-xs text-amber-500">Há TED sem dados bancários completos.</p>}
                  {selectedMissingPixData.length > 0 && <p className="text-xs text-amber-500">Há PIX sem chave válida.</p>}
                </div>
                <Button className="gap-2" disabled={!canGenerate || generating} onClick={generate}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Gerar CNAB
                </Button>
              </div>
            </div>

            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <SlidersHorizontal className="h-5 w-5" />
                    Filtros
                  </DialogTitle>
                  <DialogDescription>Refine os títulos por vencimento, pagamento planejado, fornecedor, valor e tipo.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ap-search">Busca geral</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="ap-search" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Fornecedor, NF, CC ou projeto" />
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="supplier-filter">Fornecedor</Label>
                    <Input id="supplier-filter" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} placeholder="Nome, código ou CNPJ" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="due-from">Vencimento de</Label>
                    <Input id="due-from" type="date" value={dueFrom} onChange={(event) => setDueFrom(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="due-to">Vencimento até</Label>
                    <Input id="due-to" type="date" value={dueTo} onChange={(event) => setDueTo(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="payment-from">Pagamento de</Label>
                    <Input id="payment-from" type="date" value={paymentFrom} onChange={(event) => setPaymentFrom(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="payment-to">Pagamento até</Label>
                    <Input id="payment-to" type="date" value={paymentTo} onChange={(event) => setPaymentTo(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="amount-from">Valor de</Label>
                    <Input id="amount-from" inputMode="decimal" value={amountFrom} onChange={(event) => setAmountFrom(event.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="amount-to">Valor até</Label>
                    <Input id="amount-to" inputMode="decimal" value={amountTo} onChange={(event) => setAmountTo(event.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="payment-method">Tipo de pagamento</Label>
                    <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as "all" | RemittancePaymentMethod)}>
                      <SelectTrigger id="payment-method"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="boleto">Boleto</SelectItem>
                        <SelectItem value="ted">TED</SelectItem>
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="unknown">Sem dados</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setSupplierFilter("");
                      setDueFrom(defaultDueFrom());
                      setDueTo(defaultDueTo());
                      setPaymentFrom("");
                      setPaymentTo("");
                      setAmountFrom("");
                      setAmountTo("");
                      setPaymentMethod("all");
                    }}
                  >
                    Limpar filtros
                  </Button>
                  <Button onClick={() => setFiltersOpen(false)}>Aplicar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {!config.legal_name && (
              <Alert>
                <Settings2 className="h-4 w-4" />
                <AlertTitle>Configuração bancária pendente</AlertTitle>
                <AlertDescription>Cadastre convênio, conta Sicoob e conta contábil SAP para liberar a geração.</AlertDescription>
              </Alert>
            )}

            <div className="overflow-hidden rounded-md border border-border">
              <Table className="w-full table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={allFilteredSelected} onCheckedChange={(value) => toggleFiltered(value === true)} aria-label="Selecionar títulos visíveis" /></TableHead>
                    <TableHead className="w-20">NF SAP</TableHead>
                    <TableHead className="w-[26%]">Fornecedor</TableHead>
                    <TableHead className="w-28">Vencimento</TableHead>
                    <TableHead className="w-40">Tipo</TableHead>
                    <TableHead className="w-[18%]">Dimensões</TableHead>
                    <TableHead className="w-28 text-right">Saldo aberto</TableHead>
                    <TableHead className="w-[22%]">Dados de pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((title) => {
                    const currentMethod = methodOf(title);
                    return (
                      <TableRow key={title.key} data-state={selected.has(title.key) ? "selected" : undefined}>
                        <TableCell><Checkbox checked={selected.has(title.key)} onCheckedChange={(value) => toggleTitle(title.key, value === true)} aria-label={`Selecionar NF ${title.sap_doc_num}`} /></TableCell>
                        <TableCell className="break-words font-mono text-sm">#{title.sap_doc_num}{title.installment_id > 0 ? ` / ${title.installment_id}` : ""}</TableCell>
                        <TableCell>
                          <p className="truncate font-medium">{title.supplier_name}</p>
                          <p className="text-xs text-muted-foreground">{title.supplier_code}</p>
                        </TableCell>
                        <TableCell><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{date(title.due_date)}</span></TableCell>
                        <TableCell>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <Select
                                value={currentMethod}
                                onValueChange={(value) => setTitlePaymentMethods((current) => ({ ...current, [title.key]: value as RemittancePaymentMethod }))}
                              >
                                <SelectTrigger className="h-9 min-w-0 flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="boleto">Boleto</SelectItem>
                                  <SelectItem value="ted">TED</SelectItem>
                                  <SelectItem value="pix">PIX</SelectItem>
                                  <SelectItem value="unknown">Sem dados</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {title.payment_method === "boleto" && currentMethod !== "boleto" && (
                              <p className="text-xs text-muted-foreground">Sugestão: {title.payment_method_label || paymentMethodLabels[title.payment_method]}</p>
                            )}
                          </div>
                          {title.payment_data_source && <p className="mt-1 truncate text-xs text-muted-foreground">{title.payment_data_source}</p>}
                        </TableCell>
                        <TableCell>
                          <p className="truncate text-sm">CC: {title.cost_centers.join(", ") || "-"}</p>
                          <p className="truncate text-xs text-muted-foreground">Projeto: {title.projects.join(", ") || "-"}</p>
                        </TableCell>
                        <TableCell className="truncate text-right font-semibold">{money(title.open_amount, title.currency)}</TableCell>
                        <TableCell>
                          {currentMethod === "boleto" ? (
                            <div className="space-y-1">
                              <Input
                                value={barcodes[title.key] || ""}
                                onChange={(event) => setBarcodes((current) => ({ ...current, [title.key]: digits(event.target.value).slice(0, 80) }))}
                                inputMode="numeric"
                                maxLength={80}
                                className="font-mono text-xs"
                                placeholder="Linha digitável ou código de barras"
                              />
                              {title.boleto_digitable_line && <p className="truncate text-xs text-muted-foreground">Linha digitável capturada no pedido</p>}
                              {!hasSupplierPaymentData(title) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 max-w-full gap-1.5 px-2 text-xs"
                                  onClick={() => void openSupplierPayment(title)}
                                >
                                  <PencilLine className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">Preencher dados</span>
                                </Button>
                              )}
                            </div>
                          ) : currentMethod === "ted" ? (
                            <div className="space-y-2 text-sm leading-tight">
                              <p className="line-clamp-2">{title.bank_account_summary || "Dados bancários não encontrados no SAP"}</p>
                              <p className="text-xs text-muted-foreground">TED exige banco, agência, conta e CPF/CNPJ.</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 max-w-full gap-1.5 px-2 text-xs"
                                onClick={() => void openSupplierPayment(title)}
                              >
                                <PencilLine className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{hasSupplierPaymentData(title) ? "Editar dados" : "Preencher dados"}</span>
                              </Button>
                            </div>
                          ) : currentMethod === "pix" ? (
                            <div className="space-y-2 text-sm leading-tight">
                              <p className="line-clamp-2">{title.pix_key || "Chave PIX não encontrada no SAP"}</p>
                              <p className="text-xs text-muted-foreground">PIX exige tipo da chave, chave e CPF/CNPJ.</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 max-w-full gap-1.5 px-2 text-xs"
                                onClick={() => void openSupplierPayment(title)}
                              >
                                <PencilLine className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{hasSupplierPaymentData(title) ? "Editar dados" : "Preencher dados"}</span>
                              </Button>
                            </div>
                          ) : (
                            <div className="text-sm leading-tight">
                              <p className="line-clamp-2">{title.pix_key || title.bank_account_summary || "Dados bancários não encontrados no SAP"}</p>
                              <p className="text-xs text-muted-foreground">Selecione Boleto, TED ou PIX para gerar CNAB</p>
                              {!hasSupplierPaymentData(title) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="mt-2 h-8 max-w-full gap-1.5 px-2 text-xs"
                                  onClick={() => void openSupplierPayment(title)}
                                >
                                  <PencilLine className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">Preencher dados</span>
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">Nenhum título em aberto.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="batches">
            <div className="overflow-x-auto rounded-md border border-border">
              <Table className="min-w-[980px]">
                <TableHeader><TableRow><TableHead>Arquivo</TableHead><TableHead>Gerado em</TableHead><TableHead>Pagamento</TableHead><TableHead>Títulos</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead>Retorno</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell><p className="font-mono text-sm">{batch.filename}</p><p className="text-xs text-muted-foreground">NSA {batch.file_sequence}</p></TableCell>
                      <TableCell>{dateTime(batch.generated_at)}</TableCell>
                      <TableCell>{date(batch.payment_date)}</TableCell>
                      <TableCell>{batch.title_count}</TableCell>
                      <TableCell className="text-right font-semibold">{money(batch.total_amount)}</TableCell>
                      <TableCell><Badge variant={statusVariant(batch.status)}>{batchStatus[batch.status] || batch.status}</Badge>{batch.error_message && <p className="mt-1 max-w-[240px] text-xs text-destructive">{batch.error_message}</p>}</TableCell>
                      <TableCell>
                        <p className="text-sm">{batch.return_filename || "-"}</p>
                        {!!batch.accounts_payable_batch_items?.length && <p className="text-xs text-muted-foreground">{batch.accounts_payable_batch_items.map((item) => itemStatus[item.status] || item.status).join(" · ")}</p>}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedBatch(batch)}>
                            <Eye className="h-4 w-4" />
                            Detalhes
                          </Button>
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void downloadBatch(batch)} disabled={downloadingBatchId === batch.id}>
                            {downloadingBatchId === batch.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Arquivo
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && batches.length === 0 && <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">Nenhum lote gerado.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="returns" className="space-y-5">
            <div className="flex flex-col justify-between gap-4 border-y border-border py-5 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="return-file">Arquivo de retorno Sicoob</Label>
                <Input ref={returnInputRef} id="return-file" type="file" accept=".ret,.RET,.txt" onChange={(event) => void readReturn(event.target.files?.[0])} className="max-w-md" />
              </div>
              <Button className="gap-2" onClick={processReturn} disabled={!returnPreview || processingReturn || returnTotals.unmatched > 0}>
                {processingReturn ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                Processar retorno
              </Button>
            </div>

            {returnPreview ? (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="border-l-2 border-emerald-500 px-3"><p className="text-xs text-muted-foreground">Pagos</p><p className="text-xl font-semibold">{returnTotals.paid}</p></div>
                  <div className="border-l-2 border-amber-500 px-3"><p className="text-xs text-muted-foreground">Agendados</p><p className="text-xl font-semibold">{returnTotals.scheduled}</p></div>
                  <div className="border-l-2 border-destructive px-3"><p className="text-xs text-muted-foreground">Rejeitados</p><p className="text-xl font-semibold">{returnTotals.rejected}</p></div>
                  <div className="border-l-2 border-muted-foreground px-3"><p className="text-xs text-muted-foreground">Sem vínculo</p><p className="text-xl font-semibold">{returnTotals.unmatched}</p></div>
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table className="min-w-[850px]">
                    <TableHeader><TableRow><TableHead>Referência</TableHead><TableHead>Fornecedor</TableHead><TableHead>Pagamento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Ocorrências</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>{returnPreview.matches.map((match) => (
                      <TableRow key={`${match.lineNumber}-${match.companyReference}`}>
                        <TableCell className="font-mono">{match.companyReference || "-"}</TableCell>
                        <TableCell>{match.item?.supplier_name || match.supplierName || "Sem vínculo"}</TableCell>
                        <TableCell>{date(match.paymentDate)}</TableCell>
                        <TableCell className="text-right">{money(match.paymentAmount)}</TableCell>
                        <TableCell>{match.occurrenceCodes.join(", ") || "-"}</TableCell>
                        <TableCell><Badge variant={!match.item || match.status === "rejected" ? "destructive" : match.status === "paid" ? "default" : "secondary"}>{!match.item ? "Sem vínculo" : match.status}</Badge></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                <FileUp className="mb-3 h-7 w-7" />
                <p>Selecione um arquivo para visualizar as ocorrências.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!selectedBatch} onOpenChange={(open) => { if (!open) setSelectedBatch(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5" />
              Detalhes do lote CNAB
            </DialogTitle>
            <DialogDescription>
              {selectedBatch?.filename || "-"} · {selectedBatch ? date(selectedBatch.payment_date) : "-"} · {money(selectedBatch?.total_amount)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="border-l-2 border-cyan-500 px-3"><p className="text-xs text-muted-foreground">NSA</p><p className="text-lg font-semibold">{selectedBatch?.file_sequence || "-"}</p></div>
            <div className="border-l-2 border-emerald-500 px-3"><p className="text-xs text-muted-foreground">Títulos</p><p className="text-lg font-semibold">{selectedBatch?.title_count || 0}</p></div>
            <div className="border-l-2 border-amber-500 px-3"><p className="text-xs text-muted-foreground">Gerado em</p><p className="text-sm font-medium">{dateTime(selectedBatch?.generated_at)}</p></div>
            <div className="border-l-2 border-muted-foreground px-3"><p className="text-xs text-muted-foreground">Status</p><p className="text-sm font-medium">{selectedBatch ? batchStatus[selectedBatch.status] || selectedBatch.status : "-"}</p></div>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table className="min-w-[950px]">
              <TableHeader>
                <TableRow>
                  <TableHead>NF SAP</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retorno / SAP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedBatchItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">#{item.sap_doc_num}{Number(item.installment_id || 0) > 0 ? ` / ${item.installment_id}` : ""}</TableCell>
                    <TableCell>
                      <p className="max-w-[240px] truncate font-medium">{item.supplier_name}</p>
                      <p className="text-xs text-muted-foreground">{item.supplier_code || item.supplier_tax_id || "-"}</p>
                    </TableCell>
                    <TableCell>{paymentMethodLabels[asRemittancePaymentMethod(item.payment_method)]}</TableCell>
                    <TableCell>{date(item.due_date)}</TableCell>
                    <TableCell>{date(item.scheduled_date || selectedBatch?.payment_date)}</TableCell>
                    <TableCell className="text-right font-semibold">{money(item.amount, item.currency || "BRL")}</TableCell>
                    <TableCell><Badge variant={statusVariant(item.status)}>{itemStatus[item.status] || item.status}</Badge></TableCell>
                    <TableCell>
                      <p className="font-mono text-xs">{item.company_reference || "-"}</p>
                      <p className="text-xs text-muted-foreground">{item.sap_payment_doc_num ? `Baixa SAP #${item.sap_payment_doc_num}` : item.sap_error || "-"}</p>
                    </TableCell>
                  </TableRow>
                ))}
                {selectedBatchItems.length === 0 && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Nenhum título registrado neste lote.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            {selectedBatch && (
              <Button variant="outline" className="gap-2" onClick={() => void downloadBatch(selectedBatch)} disabled={downloadingBatchId === selectedBatch.id}>
                {downloadingBatchId === selectedBatch.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Baixar arquivo
              </Button>
            )}
            <Button onClick={() => setSelectedBatch(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={supplierPaymentOpen} onOpenChange={setSupplierPaymentOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilLine className="h-5 w-5" />
              Dados de pagamento do fornecedor
            </DialogTitle>
            <DialogDescription>
              {supplierPaymentTitle?.supplier_name || "Fornecedor"} {supplierPaymentTitle?.supplier_code ? `(${supplierPaymentTitle.supplier_code})` : ""}
            </DialogDescription>
          </DialogHeader>

          {supplierPaymentLoading ? (
            <div className="flex min-h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando dados do fornecedor...
            </div>
          ) : (
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="supplier-payment-method">Forma de pagamento</Label>
                <Select
                  value={supplierPaymentForm.method}
                  onValueChange={(value) => setSupplierPaymentField("method", value as SupplierPaymentMethod)}
                >
                  <SelectTrigger id="supplier-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ted">TED</SelectItem>
                    <SelectItem value="pix">PIX</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="beneficiary-name">Favorecido</Label>
                <Input
                  id="beneficiary-name"
                  value={supplierPaymentForm.beneficiary_name}
                  onChange={(event) => setSupplierPaymentField("beneficiary_name", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="beneficiary-tax-id">CPF/CNPJ do favorecido</Label>
                <Input
                  id="beneficiary-tax-id"
                  value={supplierPaymentForm.beneficiary_tax_id}
                  onChange={(event) => setSupplierPaymentField("beneficiary_tax_id", digits(event.target.value).slice(0, 14))}
                  inputMode="numeric"
                />
              </div>

              {supplierPaymentForm.method === "ted" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-bank-code">Banco</Label>
                    <Input
                      id="supplier-bank-code"
                      value={supplierPaymentForm.bank_code}
                      onChange={(event) => setSupplierPaymentField("bank_code", digits(event.target.value).slice(0, 3))}
                      inputMode="numeric"
                      placeholder="Ex.: 756"
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_80px] gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="supplier-branch">Agência</Label>
                      <Input
                        id="supplier-branch"
                        value={supplierPaymentForm.branch}
                        onChange={(event) => setSupplierPaymentField("branch", digits(event.target.value).slice(0, 8))}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="supplier-branch-digit">Díg.</Label>
                      <Input
                        id="supplier-branch-digit"
                        value={supplierPaymentForm.branch_digit}
                        onChange={(event) => setSupplierPaymentField("branch_digit", event.target.value.slice(0, 2))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_80px] gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="supplier-account">Conta</Label>
                      <Input
                        id="supplier-account"
                        value={supplierPaymentForm.account_number}
                        onChange={(event) => setSupplierPaymentField("account_number", digits(event.target.value).slice(0, 20))}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="supplier-account-digit">Díg.</Label>
                      <Input
                        id="supplier-account-digit"
                        value={supplierPaymentForm.account_digit}
                        onChange={(event) => setSupplierPaymentField("account_digit", event.target.value.slice(0, 2))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-account-type">Tipo de conta</Label>
                    <Select
                      value={supplierPaymentForm.account_type || "checking"}
                      onValueChange={(value) => setSupplierPaymentField("account_type", value)}
                    >
                      <SelectTrigger id="supplier-account-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checking">Conta corrente</SelectItem>
                        <SelectItem value="savings">Conta poupança</SelectItem>
                        <SelectItem value="payment">Conta pagamento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-pix-key-type">Tipo da chave PIX</Label>
                    <Select
                      value={supplierPaymentForm.pix_key_type}
                      onValueChange={(value) => setSupplierPaymentField("pix_key_type", value)}
                    >
                      <SelectTrigger id="supplier-pix-key-type">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cnpj">CNPJ</SelectItem>
                        <SelectItem value="cpf">CPF</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                        <SelectItem value="phone">Telefone</SelectItem>
                        <SelectItem value="random">Chave aleatória</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-pix-key">Chave PIX</Label>
                    <Input
                      id="supplier-pix-key"
                      value={supplierPaymentForm.pix_key}
                      onChange={(event) => setSupplierPaymentField("pix_key", event.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierPaymentOpen(false)}>Cancelar</Button>
            <Button onClick={saveSupplierPayment} disabled={supplierPaymentLoading || supplierPaymentSaving || !supplierPaymentValid}>
              {supplierPaymentSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar dados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Configuração Sicoob</DialogTitle>
            <DialogDescription>Dados do convênio e conta contábil usados nas remessas e baixas desta empresa.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            {([
              ["legal_name", "Razão social"], ["tax_id", "CPF/CNPJ"], ["agreement_code", "Código do convênio"],
              ["agency", "Agência"], ["agency_digit", "Dígito da agência"], ["account_number", "Conta"],
              ["account_digit", "Dígito da conta"], ["agency_account_digit", "Dígito agência/conta"],
              ["sap_transfer_account", "Conta contábil SAP para saída"],
            ] as Array<[keyof BankConfig, string]>).map(([key, label]) => (
              <div key={key} className={key === "legal_name" || key === "sap_transfer_account" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <Label htmlFor={`config-${key}`}>{label}</Label>
                <Input id={`config-${key}`} value={String(config[key] || "")} onChange={(event) => setConfig((current) => ({ ...current, [key]: event.target.value }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Cancelar</Button>
            <Button onClick={saveConfig} disabled={savingConfig}>{savingConfig && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
