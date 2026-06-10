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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { toast } from "sonner";
import { type ExpenseItem, type CreateExpenseInput } from "@/hooks/useExpenses";
import { SupplierFormModal, type SupplierFormPrefill } from "@/components/SupplierFormModal";
import { UserPlus } from "lucide-react";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
}

export interface PagCorpPrefill {
  description?: string;
  amount?: number;
  currency?: string;
  accountAlias?: string;
  receipts?: any[];
  triggerAI?: boolean;
}

export type ExpenseMode = "purchase" | "sales";

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
}) {
  const isSales = mode === "sales";
  const bpLabel = isSales ? "Cliente" : "Fornecedor";
  const [dialogContainer, setDialogContainer] = useState<HTMLDivElement | null>(null);
  const [isCreating, setIsCreating] = useState(false);
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

  // Cached SAP lists
  const supplierMapRow = useCallback((row: any) => ({
    code: row.CardCode,
    name: row.CardName,
    extra: row.FederalTaxID || undefined,
    currency: row.Currency || "",
  } as SapSearchOption & { currency: string }), []);
  const { options: supplierOptions, isLoading: suppliersLoading } = useSapCachedList({
    cacheKey: isSales ? "customers_active" : "suppliers_active",
    endpoint: "BusinessPartners",
    params: isSales
      ? { $select: "CardCode,CardName,FederalTaxID,Currency", $filter: "CardType eq 'cCustomer' and Frozen eq 'tNO'" }
      : { $select: "CardCode,CardName,FederalTaxID,Currency", $filter: "CardType eq 'cSupplier' and Frozen eq 'tNO'" },
    mapRow: supplierMapRow,
  });

  const itemMapRow = useCallback((row: any) => ({ code: row.ItemCode, name: row.ItemName }), []);
  const { options: itemOptions, isLoading: itemsLoading } = useSapCachedList({
    cacheKey: isSales ? "items_sales_active" : "items_purchase_active",
    endpoint: "Items",
    params: {
      $filter: isSales
        ? "Valid eq 'tYES' and Frozen eq 'tNO' and SalesItem eq 'tYES'"
        : "Valid eq 'tYES' and Frozen eq 'tNO' and PurchaseItem eq 'tYES'",
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

  // Reset when modal closes
  useEffect(() => {
    if (!open && initialized) {
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
      setFiles([]);
      setAiConfidence(null);
      setPendingPrefill(null);
    }
  }, [open, initialized]);

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

  const processWithAI = async (filesToProcess: File[]) => {
    setIsProcessing(true);
    setAiConfidence(null);
    try {
      const formData = new FormData();
      filesToProcess.forEach((f) => formData.append("files", f));
      formData.append("company_db", sapSession?.companyDB || "");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-expense-doc`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: formData,
        }
      );

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Erro ao processar");
      }

      const { result } = await resp.json();
      const docs = Array.isArray(result) ? result : [result];

      if (docs.length > 1) {
        const supplierNames = docs.map((d: any) => d.supplier_name?.trim().toLowerCase()).filter(Boolean);
        const uniqueSuppliers = [...new Set(supplierNames)];
        if (uniqueSuppliers.length > 1) {
          const names = docs.map((d: any) => d.supplier_name).filter(Boolean);
          toast.error(`Os documentos são de fornecedores diferentes (${names.join(", ")}). Cada despesa deve conter documentos de um único fornecedor.`, { duration: 8000 });
          setAiWarning(`Fornecedores diferentes detectados: ${names.join(", ")}. Remova os documentos inconsistentes.`);
          setIsProcessing(false);
          return;
        }
      }

      const doc = docs[0];

      if (doc.supplier_name) setSuggestedSupplierName(doc.supplier_name);
      // Capture supplier data for "Cadastrar Fornecedor" fallback (incluindo
      // endereço, e-mail, telefones, país e moeda extraídos pela IA do documento)
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

      if (doc.items && doc.items.length > 0) {
        setItems(
          doc.items.map((item: any) => {
            const qty = Number(item.quantity) || 1;
            let unit = Number(item.unit_price) || 0;
            const lineTotalRaw = Number(item.line_total) || 0;
            // Derive unit_price from line_total / qty when AI returned only the total
            if (unit === 0 && lineTotalRaw !== 0 && qty !== 0) {
              unit = lineTotalRaw / qty;
            }
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
          })
        );
      } else if (doc.total_amount && Number(doc.total_amount) > 0) {
        // Fallback: no items detected, create single line with total amount
        const fallbackDesc =
          doc.remarks ||
          (doc.supplier_name ? `Despesa - ${doc.supplier_name}` : "Despesa");
        setItems([
          {
            description: fallbackDesc,
            quantity: 1,
            unit_price: Number(doc.total_amount),
            line_total: Number(doc.total_amount),
            cost_center: costCenterValue,
            project: projectValue,
            item_code: "",
            sapItem: null,
            searchHint: "",
          },
        ]);
      }
      if (doc.confidence) setAiConfidence(doc.confidence);

      setAiWarning(null);
      if (doc.client_warning) {
        setAiWarning(doc.client_warning);
        toast.warning(doc.client_warning, { duration: 8000 });
      }

      toast.success("Documento processado pela IA! Valide o fornecedor e os itens nos campos abaixo.");
    } catch (e) {
      console.error("AI processing error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao processar com IA");
    } finally {
      setIsProcessing(false);
    }
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
    setItems((prev) => [...prev, { description: "", quantity: 1, unit_price: 0, line_total: 0, cost_center: "", project: "" }]);
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
    setIsCreating(true);
    try {
      await onCreate({
        supplier_name: supplier.name,
        supplier_code: supplier.code || undefined,
        currency: currency || undefined,
        remarks: remarks || undefined,
        origin,
        skipRules,
        doc_type: mode,
        items: items.map(({ sapItem, sapCostCenter, sapProject, searchHint, ...rest }) => rest),
        files: files.length > 0 ? files : undefined,
      });
      toast.success(isSales ? "Pedido de venda criado com sucesso!" : "Despesa criada com sucesso!");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar despesa");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        ref={setDialogContainer}
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title || (isSales ? "Novo Pedido de Venda" : "Nova Despesa")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* AI Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Processar com IA</span>
              <span className="text-xs text-muted-foreground">(preenche campos automaticamente)</span>
            </div>
            <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
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
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{file.name}</span>
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
              <p className="text-sm text-destructive">{aiWarning}</p>
              <button onClick={() => setAiWarning(null)} className="ml-auto text-destructive/70 hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

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
                  onClick={() => setShowSupplierForm(true)}
                  className="gap-1.5 text-xs h-7 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Cadastrar {bpLabel}
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

          {/* Currency + Dates — filial usa o padrão configurado no cadastro da empresa */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Moeda *{loadingCurrencies && <span className="ml-1 text-muted-foreground">(carregando…)</span>}
              </label>
              {currencyOptions ? (
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger
                    className={`text-sm h-9 ${currency ? "bg-green-500/5 border-green-500/50 font-medium" : "bg-muted/30"}`}
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
                  className={`text-sm h-9 ${currency ? "bg-green-500/5 border-green-500/50 font-medium" : "bg-muted/30"}`}
                />
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Data do Documento *</label>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="text-sm h-9" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Data de Vencimento *</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="text-sm h-9" />
            </div>
          </div>

          <div>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Descrição da despesa..." rows={2} />
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Itens</p>
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
                    placeholder="Buscar item SAP por nome ou código..."
                    suggestedQuery={!item.sapItem ? (item.searchHint || item.description || undefined) : undefined}
                    portalContainer={dialogContainer}
                  />
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-6">
                      <label className="text-[10px] text-muted-foreground">Descrição *</label>
                      <Input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} placeholder="Descrição do item" className="text-sm h-8" />
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
                      placeholder="Buscar centro de custo..."
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
                      placeholder="Buscar projeto..."
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
          </div>

          <div className="border-t border-border pt-4 flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={isCreating}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isCreating || isProcessing} className="gap-1.5">
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {isSales ? "Criar Pedido de Venda" : "Criar Despesa"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
