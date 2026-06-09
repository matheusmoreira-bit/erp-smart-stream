import { useState } from "react";
import { Loader2, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PresentationPeriod } from "@/lib/pagcorp-presentation";

interface Props {
  open: boolean;
  onClose: () => void;
  companyLabel: string;
  onGenerate: (period: PresentationPeriod) => Promise<void>;
}

const OPTIONS: { value: PresentationPeriod; label: string; hint: string }[] = [
  { value: "monthly", label: "Mensal", hint: "Último mês completo (≈30 dias)" },
  { value: "quarterly", label: "Trimestral", hint: "Últimos 3 meses" },
  { value: "semestral", label: "Semestral", hint: "Últimos 6 meses" },
];

export function PagCorpPresentationDialog({ open, onClose, companyLabel, onGenerate }: Props) {
  const [period, setPeriod] = useState<PresentationPeriod>("quarterly");
  const [busy, setBusy] = useState(false);

  const handleGenerate = async () => {
    setBusy(true);
    try {
      await onGenerate(period);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Gerar Apresentação PagCorp
          </DialogTitle>
          <DialogDescription>
            Gera um <strong>.pptx</strong> com resumo executivo, breakdown por centro de custo
            (R$ e US$), evolução mensal e detalhamento por cartão para <strong>{companyLabel}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Período</label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PresentationPeriod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded p-2">
            O download começa automaticamente após a geração. Períodos maiores podem demorar
            alguns segundos enquanto buscamos os dados em blocos de 30 dias.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleGenerate} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Gerar .pptx
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
