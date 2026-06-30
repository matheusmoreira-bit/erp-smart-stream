import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStartAuditRun } from "@/hooks/useAuditConsole";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Radar } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (runId: string) => void;
}

export function NewAuditRunDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const start = useStartAuditRun();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [scope, setScope] = useState("compras");
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);

  async function handle() {
    try {
      const res = await start.mutateAsync({ scope, dateFrom, dateTo });
      toast({ title: "Auditoria iniciada", description: "Acompanhe o progresso na lista." });
      onOpenChange(false);
      onCreated?.(res.runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao iniciar", description: msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Radar className="h-4 w-4" /> Nova auditoria</DialogTitle>
          <DialogDescription>
            O motor irá ler PO, GRPO, Faturas e Pagamentos do SAP no período e aplicar as regras ativas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Escopo</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="compras">Compras (PO/GRPO/PI/Pagamentos)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>De</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Até</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={start.isPending}>Cancelar</Button>
          <Button onClick={handle} disabled={start.isPending}>
            {start.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Iniciando…</> : "Iniciar auditoria"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
