import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SapSearchCombobox, type SapSearchOption } from "@/components/SapSearchCombobox";
import type { NondeductibleCard, NondeductibleCardInput } from "@/hooks/useNondeductibleCards";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: NondeductibleCard | null;
  /** Distinct card options harvested from the period's transactions */
  cardSuggestions?: { identifier: string; label: string; holder?: string }[];
  onSubmit: (input: NondeductibleCardInput, id?: string) => Promise<void>;
}

export function PagCorpNondeductibleDialog({
  open,
  onClose,
  editing,
  cardSuggestions = [],
  onSubmit,
}: Props) {
  const [identifier, setIdentifier] = useState("");
  const [label, setLabel] = useState("");
  const [holder, setHolder] = useState("");
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setIdentifier(editing.card_identifier);
      setLabel(editing.card_label || "");
      setHolder(editing.card_holder || "");
      setSupplier(
        editing.supplier_code
          ? { code: editing.supplier_code, name: editing.supplier_name || editing.supplier_code }
          : null,
      );
    } else {
      setIdentifier("");
      setLabel("");
      setHolder("");
      setSupplier(null);
    }
    setSubmitting(false);
  }, [open, editing]);

  const handleSuggestion = (id: string) => {
    const s = cardSuggestions.find((c) => c.identifier === id);
    if (!s) return;
    setIdentifier(s.identifier);
    if (!label) setLabel(s.label);
    if (!holder && s.holder) setHolder(s.holder);
  };

  const canSubmit = identifier.trim() && supplier?.code && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(
        {
          card_identifier: identifier.trim(),
          card_label: label.trim() || null,
          card_holder: holder.trim() || null,
          supplier_code: supplier!.code,
          supplier_name: supplier!.name,
        },
        editing?.id,
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar cartão indedutível" : "Adicionar cartão indedutível"}
          </DialogTitle>
          <DialogDescription>
            Despesas desse cartão são consideradas <strong>indedutíveis</strong> — sem prestação
            de contas, sem aprovação e integradas ao SAP em 1 Pedido de Compra consolidado para
            o fornecedor escolhido.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {cardSuggestions.length > 0 && !editing && (
            <div>
              <Label className="text-xs text-muted-foreground">Cartões detectados no período</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background h-10 px-3 text-sm"
                onChange={(e) => handleSuggestion(e.target.value)}
                value=""
              >
                <option value="">— Selecione para preencher —</option>
                {cardSuggestions.map((c) => (
                  <option key={c.identifier} value={c.identifier}>
                    {c.label} {c.identifier !== c.label ? `(${c.identifier})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">
              Identificador do cartão <span className="text-destructive">*</span>
            </Label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Ex: 4321 (últimos 4) ou nome interno"
              disabled={!!editing}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Rótulo</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Apelido amigável" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Portador</Label>
              <Input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Nome do portador" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">
              Fornecedor SAP <span className="text-destructive">*</span>
            </Label>
            <SapSearchCombobox
              endpoint="BusinessPartners"
              filterTemplate="CardType eq 'cSupplier' and Frozen eq 'tNO' and (contains(tolower(CardName),'{qLower}') or contains(tolower(CardCode),'{qLower}') or contains(tolower(AliasName),'{qLower}') or contains(FederalTaxID,'{q}'))"
              selectFields="CardCode,CardName,AliasName,FederalTaxID"
              mapRow={(row: any) => ({
                code: row.CardCode,
                name: row.CardName,
                extra: row.FederalTaxID || undefined,
                details: { fantasyName: row.AliasName || undefined, taxId: row.FederalTaxID || undefined },
              })}
              value={supplier}
              onChange={setSupplier}
              placeholder="Buscar por código, razão social, nome fantasia ou CNPJ…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {editing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
