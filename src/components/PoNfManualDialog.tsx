import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { AiNfFields, ManualNfInput } from "@/hooks/useMastertaxPoSearch";

interface Props {
  open: boolean;
  onClose: () => void;
  poLabel: string;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  poTotal?: number | null;
  poDate?: string | null;
  international?: boolean;
  expenseId?: string | null;
  busy: boolean;
  onAiExtract?: () => Promise<{ fields: AiNfFields; analyzedFiles: number }>;
  onSubmit: (nf: ManualNfInput, mode: "draft" | "post") => Promise<void>;
}

function toAmount(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  const s = String(raw ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!s) return "";
  const normalized = s.lastIndexOf(",") > s.lastIndexOf(".")
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? String(n) : "";
}

export function PoNfManualDialog({
  open, onClose, poLabel, supplierName, supplierTaxId, poTotal, poDate,
  international, expenseId, busy, onAiExtract, onSubmit,
}: Props) {
  const [numero, setNumero] = useState("");
  const [serie, setSerie] = useState("");
  const [chave, setChave] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [valor, setValor] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNumero(""); setSerie(""); setChave("");
    setDataEmissao(poDate ? String(poDate).slice(0, 10) : "");
    setValor(poTotal ? String(poTotal) : "");
    setCnpj(supplierTaxId || "");
    setFornecedor(supplierName || "");
    setAiNote(null);
    setFormError(null);
  }, [open, poDate, poTotal, supplierTaxId, supplierName]);

  const runAi = async () => {
    if (!onAiExtract) return;
    setAiLoading(true);
    setAiNote(null);
    try {
      const { fields, analyzedFiles } = await onAiExtract();
      if (fields.numero_nf) setNumero(String(fields.numero_nf));
      if (fields.serie) setSerie(String(fields.serie));
      if (fields.chave_acesso) setChave(String(fields.chave_acesso).replace(/\D+/g, ""));
      if (fields.data_emissao) setDataEmissao(String(fields.data_emissao).slice(0, 10));
      const v = toAmount(fields.valor_total);
      if (v) setValor(v);
      if (fields.cnpj_fornecedor) setCnpj(String(fields.cnpj_fornecedor).replace(/\D+/g, ""));
      if (fields.nome_fornecedor) setFornecedor(String(fields.nome_fornecedor));
      setAiNote(`Sugestão gerada a partir de ${analyzedFiles} anexo(s). Confira cada campo antes de lançar.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const submit = async (mode: "draft" | "post") => {
    setFormError(null);
    const valorNum = Number(toAmount(valor));
    if (!numero.trim()) return setFormError("Informe o número da NF.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao)) return setFormError("Informe a data de emissão.");
    if (!Number.isFinite(valorNum) || valorNum <= 0) return setFormError("Informe o valor total da NF.");
    const chaveDigits = chave.replace(/\D+/g, "");
    if (chaveDigits && chaveDigits.length !== 44) return setFormError("A chave de acesso deve ter 44 dígitos.");
    try {
      await onSubmit({
        numero_nf: numero.trim(),
        serie: serie.trim() || undefined,
        chave_acesso: chaveDigits || undefined,
        data_emissao: dataEmissao,
        valor_total: valorNum,
        cnpj_fornecedor: cnpj.replace(/\D+/g, "") || undefined,
        nome_fornecedor: fornecedor.trim() || undefined,
      }, mode);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const disabled = busy || aiLoading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lançar NF de entrada manualmente</DialogTitle>
          <DialogDescription>
            Os dados abaixo serão enviados ao ERP e vinculados ao pedido {poLabel}.
          </DialogDescription>
        </DialogHeader>

        {international && (
          <Alert>
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            <AlertDescription className="text-xs">
              Fornecedor internacional: a nota não existe na Master Tax, por isso o lançamento é manual.
            </AlertDescription>
          </Alert>
        )}

        {onAiExtract && expenseId && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
            <Button type="button" size="sm" variant="outline" onClick={() => void runAi()} disabled={disabled}>
              {aiLoading
                ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" /> Lendo anexos…</>
                : <><Sparkles className="w-4 h-4 mr-1" aria-hidden="true" /> Preencher com IA pelos anexos</>}
            </Button>
            <span className="text-xs text-muted-foreground">Opcional — você pode preencher tudo à mão.</span>
          </div>
        )}
        {aiNote && <p className="text-xs text-amber-600">{aiNote}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="nf-numero">Número da NF *</Label>
            <Input id="nf-numero" value={numero} onChange={(e) => setNumero(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nf-serie">Série</Label>
            <Input id="nf-serie" value={serie} onChange={(e) => setSerie(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nf-data">Data de emissão *</Label>
            <Input id="nf-data" type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nf-valor">Valor total *</Label>
            <Input id="nf-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="nf-chave">Chave de acesso (44 dígitos, opcional)</Label>
            <Input id="nf-chave" value={chave} onChange={(e) => setChave(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nf-cnpj">CNPJ / ID fiscal do fornecedor</Label>
            <Input id="nf-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nf-forn">Fornecedor</Label>
            <Input id="nf-forn" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} disabled={disabled} />
          </div>
        </div>

        {formError && <p className="text-xs text-destructive">{formError}</p>}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Fechar</Button>
          <Button variant="outline" onClick={() => void submit("draft")} disabled={disabled}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />}
            Criar esboço
          </Button>
          <Button onClick={() => void submit("post")} disabled={disabled}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />}
            Lançar NF no ERP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PoNfManualDialog;
