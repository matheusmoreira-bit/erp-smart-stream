import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, FileSearch, Loader2, SearchX } from "lucide-react";
import { toast } from "sonner";
import { useMastertaxPoSearch, type MastertaxCandidate } from "@/hooks/useMastertaxPoSearch";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

interface Props {
  open: boolean;
  onClose: () => void;
  companyDb: string | null | undefined;
  poDocEntry: number | string;
  poLabel?: string;
  onDone?: () => void;
}

export function PoMastertaxNfDialog({ open, onClose, companyDb, poDocEntry, poLabel, onDone }: Props) {
  const { search, link, reset, loading, linking, error, result } = useMastertaxPoSearch(companyDb);
  const [windowDays, setWindowDays] = useState("90");
  const [cnpj, setCnpj] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);

  const runSearch = useCallback(async (days: string, cnpjValue: string) => {
    setSelected("");
    setActionError(null);
    const data = await search(poDocEntry, Number(days), cnpjValue);
    if (data?.candidates?.length) setSelected(data.candidates[0].chave_acesso);
  }, [search, poDocEntry]);

  useEffect(() => {
    if (open) void runSearch(windowDays, cnpj);
    else { reset(); setCnpj(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poDocEntry]);

  const handleLink = async (mode: "draft" | "post") => {
    if (!selected) return;
    setActionError(null);
    try {
      const res = await link(poDocEntry, selected, mode);
      const doc = mode === "post"
        ? `NF de entrada #${res.invoiceDocNum || res.invoiceDocEntry}`
        : `esboço #${res.draftId}`;
      toast.success(res.alreadyExists ? `Já existia: ${doc}` : `Criado no ERP: ${doc}`);
      onDone?.();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      setActionError(msg);
      toast.error(msg);
    }
  };

  const candidates: MastertaxCandidate[] = result?.candidates || [];
  const po = result?.purchaseOrder;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !linking) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-primary" aria-hidden="true" />
            Buscar NF na Master Tax
          </DialogTitle>
          <DialogDescription>
            Notas com fornecedor, valor e data próximos ao pedido {poLabel || `#${poDocEntry}`}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="mt-window" className="text-xs text-muted-foreground">Período em torno da data do pedido</Label>
            <Select
              value={windowDays}
              onValueChange={(v) => { setWindowDays(v); void runSearch(v, cnpj); }}
              disabled={loading || linking}
            >
              <SelectTrigger id="mt-window" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="60">60 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
                <SelectItem value="180">180 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="mt-cnpj" className="text-xs text-muted-foreground">CNPJ do fornecedor (opcional)</Label>
            <Input
              id="mt-cnpj"
              inputMode="numeric"
              placeholder="Somente números"
              className="w-52"
              value={cnpj}
              disabled={loading || linking}
              onChange={(e) => setCnpj(e.target.value.replace(/\D/g, "").slice(0, 14))}
              onKeyDown={(e) => { if (e.key === "Enter") void runSearch(windowDays, cnpj); }}
            />
          </div>

          <Button
            variant="secondary"
            onClick={() => void runSearch(windowDays, cnpj)}
            disabled={loading || linking}
          >
            Filtrar
          </Button>

          {supplierTaxId && supplierTaxId !== cnpj && (
            <Button
              variant="ghost"
              className="text-xs"
              onClick={() => { setCnpj(supplierTaxId); void runSearch(windowDays, supplierTaxId); }}
              disabled={loading || linking}
            >
              Usar CNPJ do pedido
            </Button>
          )}
        </div>

        {po && (
          <p className="text-xs text-muted-foreground">
            Pedido: <span className="text-foreground font-medium">{po.cardName || po.cardCode}</span>
            {" · "}{formatDate(po.docDate)}{" · "}{formatCurrency(po.docTotal)}
            {result?.cnpjFilter ? ` · filtrando pelo CNPJ ${result.cnpjFilter}` : ""}
          </p>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Procurando notas…
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && result && !result.masterTaxConfigured && (
          <p className="text-xs text-amber-600">
            Master Tax não configurada para esta empresa — mostrando apenas notas já importadas.
          </p>
        )}
        {!loading && !error && result?.warning && (
          <p className="text-xs text-amber-600">{result.warning}</p>
        )}

        {!loading && !error && result && candidates.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <SearchX className="w-6 h-6" aria-hidden="true" />
            <p>Nenhuma nota compatível entre {formatDate(result.window.de)} e {formatDate(result.window.ate)}.</p>
            <p className="text-xs">Amplie o período acima para procurar em um intervalo maior.</p>
          </div>
        )}

        {!loading && !error && candidates.length > 0 && (
          <ScrollArea className="max-h-[45vh] pr-2">
            <RadioGroup value={selected} onValueChange={setSelected} className="space-y-2">
              {candidates.map((c) => {
                const linkedElsewhere = !!c.alreadyLinkedPoDocEntry &&
                  String(c.alreadyLinkedPoDocEntry) !== String(poDocEntry);
                return (
                  <label
                    key={c.chave_acesso}
                    htmlFor={`nf-${c.chave_acesso}`}
                    className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      selected === c.chave_acesso ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <RadioGroupItem
                      id={`nf-${c.chave_acesso}`}
                      value={c.chave_acesso}
                      disabled={linkedElsewhere}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          NF {c.numero_nf || "—"}{c.serie ? `/${c.serie}` : ""}
                        </span>
                        <span className="font-mono text-sm">{formatCurrency(c.valor_total)}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(c.data_emissao)}</span>
                        {Math.abs(c.valorDiff) >= 0.01 && (
                          <Badge variant="outline" className="text-[10px]">
                            {c.valorDiff > 0 ? "+" : ""}{formatCurrency(c.valorDiff)} vs. pedido
                          </Badge>
                        )}
                        {c.source === "importada" && (
                          <Badge variant="outline" className="text-[10px]">já importada</Badge>
                        )}
                        {c.alreadyPosted && (
                          <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">
                            NF já lançada
                          </Badge>
                        )}
                        {linkedElsewhere && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600">
                            vinculada a outro pedido
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{c.nome_fornecedor || "—"}</p>
                      {c.reasons.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">{c.reasons.join(" · ")}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </ScrollArea>
        )}

        {actionError && (
          <p className="text-xs text-destructive">{actionError}</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={linking}>Fechar</Button>
          <Button
            variant="outline"
            onClick={() => void handleLink("draft")}
            disabled={!selected || linking || loading}
          >
            {linking && <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />}
            Criar esboço da NF
          </Button>
          <Button
            onClick={() => void handleLink("post")}
            disabled={!selected || linking || loading}
          >
            {linking && <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />}
            Lançar NF de entrada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PoMastertaxNfDialog;
