import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { NfEntradaImport } from "@/hooks/useNfEntrada";

interface EditNfEntradaDialogProps {
  item: NfEntradaImport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditNfEntradaDialog({ item, open, onOpenChange, onSaved }: EditNfEntradaDialogProps) {
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);

  const [numero, setNumero] = useState("");
  const [serie, setSerie] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [valorTotal, setValorTotal] = useState<string>("");
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [saving, setSaving] = useState(false);

  const supplierMapRow = useCallback((row: any) => ({
    code: row.CardCode,
    name: row.CardName,
    extra: row.FederalTaxID || undefined,
    details: { fantasyName: row.AliasName || undefined, taxId: row.FederalTaxID || undefined },
  } as SapSearchOption), []);

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
    if (!item || !open) return;
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
        }
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
  }, [item, open, supplierOptions]);

  const suggestedSupplier = useMemo(() => item?.nome_fornecedor || "", [item]);

  async function handleSave() {
    if (!item) return;
    if (!dataEmissao) {
      toast({ title: "Data de emissão obrigatória", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        numero_nf: numero || null,
        serie: serie || null,
        data_emissao: dataEmissao,
        valor_total: valorTotal ? Number(valorTotal) : null,
      };
      if (supplier) {
        patch.nome_fornecedor = supplier.name || null;
        if (supplier.extra) patch.cnpj_fornecedor = supplier.extra.replace(/\D/g, "") || null;
        if (supplier.code) patch.sap_matched_card_code = supplier.code;
      }
      const { error } = await supabase
        .from("nf_entrada_imports")
        .update(patch)
        .eq("id", item.id);
      if (error) throw error;

      await supabase.from("nf_entrada_logs").insert({
        import_id: item.id,
        step: "manual_edit",
        message: `Edição manual: data ${dataEmissao}, valor ${patch.valor_total ?? "—"}, fornecedor ${supplier?.name || "—"}`,
        actor: "manual:user",
        payload: patch,
      });

      toast({ title: "NF atualizada" });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Falha ao salvar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" ref={contentRef}>
        <DialogHeader>
          <DialogTitle>Editar NF de Entrada</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <CachedSearchCombobox
            label="Fornecedor"
            options={supplierOptions}
            isLoading={suppliersLoading}
            value={supplier}
            onChange={setSupplier}
            placeholder="Digite nome, código ou CNPJ do fornecedor..."
            suggestedQuery={suggestedSupplier}
            portalContainer={contentRef.current}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nf-numero">Número</Label>
              <Input id="nf-numero" value={numero} onChange={(e) => setNumero(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="nf-serie">Série</Label>
              <Input id="nf-serie" value={serie} onChange={(e) => setSerie(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nf-data">Data de emissão *</Label>
              <Input
                id="nf-data"
                type="date"
                value={dataEmissao}
                onChange={(e) => setDataEmissao(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="nf-valor">Valor total (R$)</Label>
              <Input
                id="nf-valor"
                type="number"
                step="0.01"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
