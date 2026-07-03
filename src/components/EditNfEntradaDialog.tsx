import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { supabase } from "@/integrations/supabase/client";
import type { NfEntradaImport } from "@/hooks/useNfEntrada";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

interface Props {
  item: NfEntradaImport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditNfEntradaDialog({ item, open, onOpenChange, onSaved }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);

  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [numero, setNumero] = useState("");
  const [serie, setSerie] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [valorTotal, setValorTotal] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const supplierMapRow = useCallback(
    (row: any) =>
      ({
        code: row.CardCode,
        name: row.CardName,
        extra: row.FederalTaxID || undefined,
        details: { fantasyName: row.AliasName || undefined, taxId: row.FederalTaxID || undefined },
      }) as SapSearchOption,
    [],
  );

  const { options: supplierOptions, isLoading: suppliersLoading } = useSapCachedList({
    cacheKey: "suppliers_active_v2",
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,FederalTaxID,Currency",
      $filter: "CardType eq 'cSupplier' and Frozen eq 'tNO'",
    },
    mapRow: supplierMapRow,
  });

  useEffect(() => {
    if (!open || !item) return;
    setNumero(item.numero_nf || "");
    setSerie(item.serie || "");
    setDataEmissao(item.data_emissao ? item.data_emissao.slice(0, 10) : "");
    setValorTotal(item.valor_total != null ? String(item.valor_total) : "");
    if (item.sap_matched_card_code) {
      const existing = supplierOptions.find((o) => o.code === item.sap_matched_card_code);
      setSupplier(
        existing || {
          code: item.sap_matched_card_code,
          name: item.nome_fornecedor || item.sap_matched_card_code,
          extra: item.cnpj_fornecedor || undefined,
        },
      );
    } else if (item.nome_fornecedor || item.cnpj_fornecedor) {
      setSupplier({
        code: "",
        name: item.nome_fornecedor || "",
        extra: item.cnpj_fornecedor || undefined,
      });
    } else {
      setSupplier(null);
    }
  }, [open, item, supplierOptions]);

  const suggestedSupplier = useMemo(() => item?.nome_fornecedor || "", [item]);
  const valorNum = Number(valorTotal) || 0;

  const handleSave = async () => {
    if (!item) return;
    if (!supplier || !supplier.name.trim()) {
      toast.error("Informe o fornecedor");
      return;
    }
    if (!dataEmissao) {
      toast.error("Informe a data de emissão");
      return;
    }
    setIsSaving(true);
    try {
      const patch = {
        numero_nf: numero || null,
        serie: serie || null,
        data_emissao: dataEmissao,
        valor_total: valorNum || null,
        nome_fornecedor: supplier.name || null,
        ...(supplier.extra
          ? { cnpj_fornecedor: supplier.extra.replace(/\D/g, "") || null }
          : {}),
        ...(supplier.code ? { sap_matched_card_code: supplier.code } : {}),
      };
      const { error } = await supabase
        .from("nf_entrada_imports")
        .update(patch)
        .eq("id", item.id);
      if (error) throw error;

      await supabase.from("nf_entrada_logs").insert({
        import_id: item.id,
        step: "manual_edit",
        message: `Edição manual: NF ${numero}/${serie || "-"}, data ${dataEmissao}, valor ${formatCurrency(valorNum)}, fornecedor ${supplier.name}`,
        actor: "manual:user",
        payload: JSON.parse(JSON.stringify(patch)),
      });

      toast.success("NF atualizada com sucesso!");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
    } finally {
      setIsSaving(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" ref={contentRef}>
        <DialogHeader>
          <DialogTitle className="pr-6">
            <span>Editar NF de Entrada</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <CachedSearchCombobox
              label="Fornecedor *"
              options={supplierOptions}
              isLoading={suppliersLoading}
              value={supplier}
              onChange={setSupplier}
              placeholder="Digite nome, código ou CNPJ do fornecedor..."
              suggestedQuery={suggestedSupplier}
              portalContainer={contentRef.current}
            />
            {supplier?.code && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">Código: {supplier.code}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Número NF *</label>
              <Input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Série</label>
              <Input
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Data de emissão *</label>
              <Input
                type="date"
                value={dataEmissao}
                onChange={(e) => setDataEmissao(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Itens
              </p>
            </div>
            <div className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/10">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">
                  Item 1
                </span>
              </div>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-4">
                  <label className="text-[10px] text-muted-foreground">
                    Chave de acesso <span className="opacity-60">(referência)</span>
                  </label>
                  <Input
                    value={item.chave_acesso || ""}
                    readOnly
                    className="text-xs h-8 font-mono bg-muted/30"
                  />
                </div>
                <div className="col-span-4">
                  <label className="text-[10px] text-muted-foreground">Descrição</label>
                  <Input
                    value={`NF ${numero || "—"}/${serie || "—"} — ${supplier?.name || "—"}`}
                    readOnly
                    className="text-sm h-8 bg-muted/30"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-muted-foreground">Valor total *</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={valorTotal}
                    onChange={(e) => setValorTotal(e.target.value)}
                    className="text-sm h-8 font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-muted-foreground">Total</label>
                  <Input
                    value={formatCurrency(valorNum)}
                    readOnly
                    className="text-sm h-8 bg-muted/30 font-mono"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                NF de serviço (NFS-e): os itens vêm do XML e não podem ser editados linha a linha aqui.
              </p>
            </div>
            <div className="flex justify-end mt-3">
              <p className="text-sm font-medium text-foreground">
                Total:{" "}
                <span className="text-lg font-bold font-mono">{formatCurrency(valorNum)}</span>
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-4 flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
