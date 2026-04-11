import { useState, useRef, useCallback } from "react";
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
  Trash2,
  X,
  Upload,
  FileSpreadsheet,
  Sparkles,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { type SapSearchOption } from "@/components/SapSearchCombobox";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";
import {
  useExpenses,
  STATUS_LABELS,
  STATUS_COLORS,
  type Expense,
  type ExpenseItem,
  type CreateExpenseInput,
} from "@/hooks/useExpenses";

import { useCompanies } from "@/hooks/useCompanies";

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

/* ─── Detail Modal ─── */
function ExpenseDetailModal({
  expense,
  open,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (id: string) => void;
  isSubmitting: boolean;
}) {
  if (!expense) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-foreground font-semibold">Despesa</span>
            <Badge className={STATUS_COLORS[expense.status]}>{STATUS_LABELS[expense.status]}</Badge>
            <span className="text-2xl font-bold font-mono ml-auto">{formatCurrency(expense.total_amount, expense.currency)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Fornecedor</p>
              <p className="text-foreground font-medium">{expense.supplier_name}</p>
              {expense.supplier_code && <p className="text-xs text-muted-foreground font-mono">{expense.supplier_code}</p>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Solicitante</p>
              <p className="text-foreground font-medium">{expense.requester_name}</p>
            </div>
            {expense.cost_center && (
              <div>
                <p className="text-xs text-muted-foreground">Centro de Custo</p>
                <p className="text-foreground">{expense.cost_center}</p>
              </div>
            )}
            {expense.project && (
              <div>
                <p className="text-xs text-muted-foreground">Projeto</p>
                <p className="text-foreground">{expense.project}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Data de Criação</p>
              <p className="text-foreground">{formatDate(expense.created_at)}</p>
            </div>
            {expense.current_approver && (
              <div>
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
                      <th className="text-right py-2 px-3 text-muted-foreground">Qtd</th>
                      <th className="text-right py-2 px-3 text-muted-foreground">Preço Unit.</th>
                      <th className="text-right py-2 px-3 text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expense.items.map((item, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2 px-3 text-foreground">{item.description}</td>
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

          {expense.status === "rascunho" && (
            <div className="border-t border-border pt-4 flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              <Button
                onClick={() => onSubmit(expense.id)}
                disabled={isSubmitting}
                className="gap-1.5"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Enviar para Aprovação
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Create Expense Modal ─── */
function CreateExpenseModal({
  open,
  onClose,
  onCreate,
  sapSession,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateExpenseInput) => Promise<unknown>;
  sapSession: any;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [currency, setCurrency] = useState("");
  const [currencyWarning, setCurrencyWarning] = useState<string | null>(null);
  const [docDate, setDocDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState<(Omit<ExpenseItem, "id"> & { sapItem?: SapSearchOption | null; sapCostCenter?: SapSearchOption | null; sapProject?: SapSearchOption | null })[]>([
    { description: "", quantity: 1, unit_price: 0, line_total: 0, cost_center: "", project: "" },
  ]);
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  const [suggestedSupplierName, setSuggestedSupplierName] = useState<string | undefined>(undefined);

  // Cached SAP lists
  const supplierMapRow = useCallback((row: any) => ({
    code: row.CardCode,
    name: row.CardName,
    extra: row.FederalTaxID || undefined,
    currency: row.Currency || "",
  } as SapSearchOption & { currency: string }), []);
  const { options: supplierOptions, isLoading: suppliersLoading } = useSapCachedList({
    cacheKey: "suppliers",
    endpoint: "BusinessPartners",
    params: { $select: "CardCode,CardName,FederalTaxID,Currency" },
    mapRow: supplierMapRow,
  });

  const itemMapRow = useCallback((row: any) => ({ code: row.ItemCode, name: row.ItemName }), []);
  const { options: itemOptions, isLoading: itemsLoading } = useSapCachedList({
    cacheKey: "items",
    endpoint: "Items",
    params: { $select: "ItemCode,ItemName" },
    mapRow: itemMapRow,
  });

  const costCenterMapRow = useCallback((row: any) => ({ code: row.CenterCode, name: row.CenterName }), []);
  const { options: costCenterOptions, isLoading: costCentersLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: costCenterMapRow,
  });

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
  const [aiEnabled, setAiEnabled] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      // Send company info for validation
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

      // Handle single or array result
      const docs = Array.isArray(result) ? result : [result];

      // Validate multi-attachment: all documents must be from the same supplier
      if (docs.length > 1) {
        const supplierNames = docs
          .map((d: any) => d.supplier_name?.trim().toLowerCase())
          .filter(Boolean);
        const uniqueSuppliers = [...new Set(supplierNames)];
        if (uniqueSuppliers.length > 1) {
          const names = docs.map((d: any) => d.supplier_name).filter(Boolean);
          toast.error(
            `Os documentos são de fornecedores diferentes (${names.join(", ")}). Cada despesa deve conter documentos de um único fornecedor.`,
            { duration: 8000 }
          );
          setAiWarning(`Fornecedores diferentes detectados: ${names.join(", ")}. Remova os documentos inconsistentes.`);
          setIsProcessing(false);
          return;
        }
      }

      const doc = docs[0];

      // AI suggests supplier name — user must validate by selecting from SAP search results
      // Never mark supplier as "selected" (green check) from AI alone
      if (doc.supplier_name) {
        setSuggestedSupplierName(doc.supplier_name);
      }
      if (doc.document_date) setDocDate(doc.document_date);
      if (doc.due_date) setDueDate(doc.due_date);
      if (doc.remarks) setRemarks(doc.remarks);
      if (doc.items && doc.items.length > 0) {
        const costCenterValue = (doc.cost_center_confidence ?? 0) > 0.95 ? (doc.cost_center_hint || "") : "";
        const projectValue = (doc.project_confidence ?? 0) > 0.95 ? (doc.project_hint || "") : "";
        setItems(
          doc.items.map((item: any) => ({
            description: item.description || "",
            quantity: item.quantity || 1,
            unit_price: item.unit_price || 0,
            line_total: item.line_total || (item.quantity || 1) * (item.unit_price || 0),
            cost_center: costCenterValue,
            project: projectValue,
            item_code: item.item_code_match || "",
            sapItem: null,
          }))
        );
      }
      if (doc.confidence) setAiConfidence(doc.confidence);

      // Check if document client differs from logged company
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

  const handleSupplierChange = (val: SapSearchOption | null) => {
    setSupplier(val);
    setCurrencyWarning(null);
    if (val) {
      // currency comes from the extra2 field we added to mapRow
      const supplierCurrency = (val as any).currency;
      if (supplierCurrency) {
        setCurrency(supplierCurrency);
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
        items: items.map(({ sapItem, sapCostCenter, sapProject, ...rest }) => rest),
      });
      toast.success("Despesa criada com sucesso!");
      onClose();
      resetForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar despesa");
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setSupplier(null);
    setCurrency("");
    setCurrencyWarning(null);
    setDocDate("");
    setDueDate("");
    setRemarks("");
    setAiWarning(null);
    setSuggestedSupplierName(undefined);
    setItems([{ description: "", quantity: 1, unit_price: 0, line_total: 0, cost_center: "", project: "" }]);
    setFiles([]);
    setAiConfidence(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Despesa</DialogTitle>
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

          {/* File Upload — FIRST */}
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

            {/* File list */}
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

            {/* AI confidence badge */}
            {aiConfidence !== null && (
              <div className="mt-2 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">
                  IA preencheu os campos com {Math.round(aiConfidence * 100)}% de confiança
                </span>
                {!aiEnabled && files.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-primary"
                    onClick={() => processWithAI(files)}
                    disabled={isProcessing}
                  >
                    Reprocessar
                  </Button>
                )}
              </div>
            )}

            {/* Manual re-process button when AI is enabled but not yet processed */}
            {aiEnabled && files.length > 0 && aiConfidence === null && !isProcessing && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5 text-xs"
                onClick={() => processWithAI(files)}
              >
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
              label="Fornecedor *"
              options={supplierOptions}
              isLoading={suppliersLoading}
              value={supplier}
              onChange={handleSupplierChange}
              placeholder="Digite nome, código ou CNPJ do fornecedor..."
              suggestedQuery={suggestedSupplierName}
            />
          </div>

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

          {/* Currency + Dates */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Moeda *</label>
              <Input
                value={currency}
                readOnly
                placeholder="Definida pelo fornecedor"
                className={`text-sm h-9 ${currency ? "bg-green-500/5 border-green-500/50 font-medium" : "bg-muted/30"}`}
              />
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(i)}
                      disabled={items.length <= 1}
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  {/* Item search from SAP */}
                  <CachedSearchCombobox
                    options={itemOptions}
                    isLoading={itemsLoading}
                    value={item.sapItem || null}
                    onChange={(val) => {
                      setItems((prev) => {
                        const updated = [...prev];
                        updated[i] = {
                          ...updated[i],
                          sapItem: val,
                          item_code: val?.code || "",
                          description: val?.name || updated[i].description,
                        };
                        return updated;
                      });
                    }}
                    placeholder="Buscar item SAP por nome ou código..."
                    suggestedQuery={item.description && !item.sapItem ? item.description : undefined}
                  />
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-6">
                      <label className="text-[10px] text-muted-foreground">Descrição *</label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(i, "description", e.target.value)}
                        placeholder="Descrição do item"
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Qtd</label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)}
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">Preço Unit.</label>
                      <Input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)}
                        className="text-sm h-8"
                      />
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
                          updated[i] = {
                            ...updated[i],
                            sapCostCenter: val,
                            cost_center: val?.code || "",
                          };
                          return updated;
                        });
                      }}
                      placeholder="Buscar centro de custo..."
                      suggestedQuery={item.cost_center && !item.sapCostCenter ? item.cost_center : undefined}
                    />
                    <CachedSearchCombobox
                      label="Projeto (Dimensão)"
                      options={projectOptions}
                      isLoading={projectsLoading}
                      value={item.sapProject || null}
                      onChange={(val) => {
                        setItems((prev) => {
                          const updated = [...prev];
                          updated[i] = {
                            ...updated[i],
                            sapProject: val,
                            project: val?.code || "",
                          };
                          return updated;
                        });
                      }}
                      placeholder="Buscar projeto..."
                      suggestedQuery={item.project && !item.sapProject ? item.project : undefined}
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
              Criar Despesa
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Expense Card ─── */
function ExpenseCard({ expense, onOpen }: { expense: Expense; onOpen: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 flex flex-col gap-3 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div>
          <Badge className={STATUS_COLORS[expense.status]}>{STATUS_LABELS[expense.status]}</Badge>
        </div>
        <p className="text-lg font-bold text-foreground font-mono">{formatCurrency(expense.total_amount, expense.currency)}</p>
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
          <span>{formatDate(expense.created_at)}</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Main Page ─── */
export default function ExpensesPage() {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const { expenses, isLoading, error, refresh, createExpense, submitForApproval } = useExpenses();
  const { getLabel } = useCompanies(true);
  const [search, setSearch] = useState("");
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  if (!session) {
    navigate("/");
    return null;
  }

  const companyLabel = getLabel(session?.companyDB || "");

  const filtered = expenses.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.supplier_name.toLowerCase().includes(q) ||
      e.requester_name.toLowerCase().includes(q) ||
      (e.remarks || "").toLowerCase().includes(q)
    );
  });

  const totalValue = filtered.reduce((sum, e) => sum + e.total_amount, 0);

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

  const statusOptions = [
    { value: "all", label: "Todos" },
    { value: "rascunho", label: "Rascunho" },
    { value: "pendente_aprovacao", label: "Pendente" },
    { value: "aprovado", label: "Aprovado" },
    { value: "pc_lancado", label: "PC Lançado" },
    { value: "finalizado", label: "Finalizado" },
  ];

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
              <p className="text-xs text-muted-foreground">Gestão de Despesas</p>
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
            <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Back + actions */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> Nova Despesa
          </Button>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap gap-4">
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <DollarSign className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold font-mono text-foreground">{formatCurrency(totalValue)}</p>
            </div>
          </div>
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <Calendar className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Registros</p>
              <p className="text-lg font-bold font-mono text-foreground">{filtered.length}</p>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por fornecedor, solicitante..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-muted/30 border-border"
            />
          </div>
          <div className="flex gap-1">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === opt.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={refresh}>Tentar novamente</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <DollarSign className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhuma despesa encontrada</p>
            <Button onClick={() => setShowCreate(true)} className="mt-4 gap-1.5">
              <Plus className="w-4 h-4" /> Criar primeira despesa
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                onOpen={() => setSelectedExpense(expense)}
              />
            ))}
          </div>
        )}
      </main>

      <ExpenseDetailModal
        expense={selectedExpense}
        open={!!selectedExpense}
        onClose={() => setSelectedExpense(null)}
        onSubmit={handleSubmitForApproval}
        isSubmitting={isSubmitting}
      />

      <CreateExpenseModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={createExpense}
        sapSession={session}
      />
    </div>
  );
}
