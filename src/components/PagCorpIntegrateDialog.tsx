import { useState, useEffect, useCallback } from "react";
import { Loader2, CreditCard, Sparkles, Upload, Plus, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SapSearchCombobox, type SapSearchOption } from "@/components/SapSearchCombobox";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { SupplierFormModal, type SupplierFormPrefill } from "@/components/SupplierFormModal";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";
import { supabase } from "@/integrations/supabase/client";
import { findSupplierByTaxId, type Supplier } from "@/hooks/useSuppliers";
import { toast } from "sonner";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
}

export interface PagCorpLineOverride {
  costCenter?: string | null;
  project?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  transaction: PagCorpTransaction | null;
  integrationType: "generic" | "accountability";
  companyDb?: string;
  onConfirm: (supplier: SapSearchOption, override: PagCorpLineOverride) => Promise<void>;
}


export function PagCorpIntegrateDialog({
  open,
  onClose,
  transaction,
  integrationType,
  companyDb,
  onConfirm,
}: Props) {
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [costCenter, setCostCenter] = useState<SapSearchOption | null>(null);
  const [project, setProject] = useState<SapSearchOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTried, setAiTried] = useState(false);
  const [aiResult, setAiResult] = useState<SupplierFormPrefill | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);

  const ccMap = (row: any) => ({ code: row.CenterCode, name: row.CenterName });
  const prMap = (row: any) => ({ code: row.Code, name: row.Name });
  const { options: ccOptions, isLoading: ccLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: ccMap,
  });
  const { options: prOptions, isLoading: prLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: prMap,
  });


  const runAi = useCallback(async (tx: PagCorpTransaction) => {
    if (!companyDb) return;
    setAiBusy(true);
    setAiNotice(null);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-ai-extract", {
        body: {
          description: tx.description,
          amount: tx.amount,
          receipts: tx.receipts || [],
          attachments: (tx.attachments || []).slice(0, 5),
          hint: tx.accountName || tx.accountAlias,
        },
      });
      if (error) throw error;
      const extracted = (data as any)?.supplier;
      if (!extracted?.federal_tax_id || !extracted?.card_name) {
        setAiNotice("IA não conseguiu identificar o fornecedor neste documento.");
        return;
      }

      // Check local DB by tax id
      const existing = await findSupplierByTaxId(extracted.federal_tax_id, companyDb);
      if (existing && existing.card_code) {
        setSupplier({
          code: existing.card_code,
          name: existing.card_name,
          extra: existing.federal_tax_id || undefined,
        });
        toast.success("Fornecedor encontrado no cadastro local", {
          description: existing.card_name,
        });
        return;
      }

      setAiResult({
        card_name: extracted.card_name,
        federal_tax_id: extracted.federal_tax_id,
        email: extracted.email,
        phone1: extracted.phone1,
        phone2: extracted.phone2,
        bill_to_street: extracted.bill_to_street,
        bill_to_zip: extracted.bill_to_zip,
        bill_to_city: extracted.bill_to_city,
        bill_to_state: extracted.bill_to_state,
        bill_to_block: extracted.bill_to_block,
        bill_to_building: extracted.bill_to_building,
      });
      setAiNotice(`Fornecedor identificado pela IA: ${extracted.card_name}. Cadastre para integrar.`);
    } catch (e) {
      console.error("supplier-ai-extract failed", e);
      setAiNotice(e instanceof Error ? e.message : "Falha na extração via IA");
    } finally {
      setAiBusy(false);
    }
  }, [companyDb]);

  useEffect(() => {
    if (!open || !transaction) return;
    setSupplier(null);
    setSubmitting(false);
    setAiTried(false);
    setAiResult(null);
    setAiNotice(null);
    setSupplierFormOpen(false);

    // Auto-trigger AI extraction
    setAiTried(true);
    void runAi(transaction);
  }, [open, transaction?.id, runAi, transaction]);

  if (!transaction) return null;

  const handleSubmit = async () => {
    if (!supplier) return;
    setSubmitting(true);
    try {
      await onConfirm(supplier, {
        costCenter: costCenter?.code || null,
        project: project?.code || null,
      });
    } finally {
      setSubmitting(false);
    }
  };


  const handleSupplierSaved = (s: Supplier) => {
    if (s.card_code) {
      setSupplier({
        code: s.card_code,
        name: s.card_name,
        extra: s.federal_tax_id || undefined,
      });
      setAiNotice(null);
    }
    setSupplierFormOpen(false);
  };

  return (
    <>
      <Dialog open={open && !supplierFormOpen} onOpenChange={(v) => !v && !submitting && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {integrationType === "accountability" ? (
                <Sparkles className="w-5 h-5 text-primary" />
              ) : (
                <Upload className="w-5 h-5 text-primary" />
              )}
              Integrar no SAP
            </DialogTitle>
            <DialogDescription>
              Será criado <strong>Pedido de Compra + NF de Entrada + Pagamento</strong> no SAP, sem passar
              por aprovações.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <CreditCard className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{transaction.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {transaction.accountAlias || transaction.accountName || "—"}
                    {transaction.cardLastDigits && ` • •••${transaction.cardLastDigits}`}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums">
                  {formatCurrency(transaction.amount, transaction.currency)}
                </p>
              </div>
            </div>

            {aiBusy && (
              <div className="rounded-md bg-primary/10 border border-primary/30 p-3 flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>Identificando fornecedor com IA…</span>
              </div>
            )}

            {!aiBusy && aiNotice && (
              <div className="rounded-md bg-warning/10 border border-warning/30 p-3 flex items-start gap-2 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 text-warning shrink-0" />
                <div className="flex-1">
                  <p>{aiNotice}</p>
                  {aiResult && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2 gap-1.5"
                      onClick={() => setSupplierFormOpen(true)}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Cadastrar fornecedor
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Fornecedor SAP <span className="text-destructive">*</span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={() => transaction && runAi(transaction)}
                  disabled={aiBusy}
                >
                  <Sparkles className="w-3 h-3" />
                  IA
                </Button>
              </div>
              <SapSearchCombobox
                endpoint="BusinessPartners"
                filterTemplate="CardType eq 'cSupplier' and (contains(CardName,'{q}') or contains(CardCode,'{q}'))"
                selectFields="CardCode,CardName,FederalTaxID"
                mapRow={(row: any) => ({
                  code: row.CardCode,
                  name: row.CardName,
                  extra: row.FederalTaxID || undefined,
                })}
                value={supplier}
                onChange={setSupplier}
                placeholder="Buscar fornecedor por nome ou código…"
                suggestedQuery={!supplier && aiResult?.card_name ? aiResult.card_name : undefined}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!supplier || submitting}>
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Integrar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SupplierFormModal
        open={supplierFormOpen}
        onClose={() => setSupplierFormOpen(false)}
        onSaved={handleSupplierSaved}
        prefill={aiResult}
        source="pagcorp_ai"
      />
    </>
  );
}
