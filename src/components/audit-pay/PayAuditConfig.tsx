import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { usePayConfig, useSavePayConfig } from "@/hooks/useAuditPay";

export function PayAuditConfig() {
  const { data, isLoading } = usePayConfig();
  const save = useSavePayConfig();

  const [baixa, setBaixa] = useState("5");
  const [media, setMedia] = useState("15");
  const [bankWindow, setBankWindow] = useState("30");
  const [enabled, setEnabled] = useState(true);
  const [agentMode, setAgentMode] = useState("batch_daily");
  const [thresholds, setThresholds] = useState("[]");
  const [risco, setRisco] = useState("[]");

  useEffect(() => {
    if (!data) return;
    setBaixa(String(data.tolerance_pct_baixa ?? 5));
    setMedia(String(data.tolerance_pct_media ?? 15));
    setBankWindow(String(data.bank_change_window_days ?? 30));
    setEnabled(data.enabled !== false);
    setAgentMode(data.run_agent_on ?? "batch_daily");
    setThresholds(JSON.stringify(data.approval_thresholds ?? [], null, 2));
    setRisco(JSON.stringify(data.fornecedor_risco ?? [], null, 2));
  }, [data]);

  const onSave = () => {
    let parsedThresholds: unknown;
    let parsedRisco: unknown;
    try {
      parsedThresholds = JSON.parse(thresholds || "[]");
      parsedRisco = JSON.parse(risco || "[]");
    } catch {
      toast({ title: "JSON inválido", description: "Verifique as faixas de alçada e a lista de fornecedores de risco.", variant: "destructive" });
      return;
    }
    save.mutate(
      {
        tolerance_pct_baixa: Number(baixa),
        tolerance_pct_media: Number(media),
        bank_change_window_days: Number(bankWindow),
        enabled,
        run_agent_on: agentMode as "every_finding" | "batch_daily",
        approval_thresholds: parsedThresholds as never,
        fornecedor_risco: parsedRisco as never,
      },
      {
        onSuccess: () => toast({ title: "Configurações salvas" }),
        onError: (e: any) => toast({ title: "Falha ao salvar", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Configurações</h2>
        <p className="text-sm text-muted-foreground">Tolerâncias, faixas de alçada e fornecedores de risco desta empresa.</p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Auditoria ativa</Label>
            <p className="text-xs text-muted-foreground">Quando desligada, o enfileiramento automático é ignorado.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Tolerância severidade baixa (%)</Label>
            <Input type="number" value={baixa} onChange={(e) => setBaixa(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tolerância severidade média (%)</Label>
            <Input type="number" value={media} onChange={(e) => setMedia(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Janela mudança bancária (dias)</Label>
            <Input type="number" value={bankWindow} onChange={(e) => setBankWindow(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Modo de execução do agente</Label>
          <div className="flex gap-1.5">
            {[
              { k: "batch_daily", l: "Lote diário" },
              { k: "every_finding", l: "A cada divergência" },
            ].map((o) => (
              <button
                key={o.k}
                onClick={() => setAgentMode(o.k)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  agentMode === o.k ? "border-primary/30 bg-primary/15 text-primary" : "border-transparent bg-muted/40 text-muted-foreground"
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Faixas de alçada (JSON)</Label>
          <Textarea rows={5} value={thresholds} onChange={(e) => setThresholds(e.target.value)} className="font-mono text-xs" placeholder='[{"limit": 10000}, {"limit": 50000}]' />
          <p className="text-[11px] text-muted-foreground">Usadas para detectar fracionamento e pagamentos acima da alçada aprovada.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Fornecedores de risco (JSON)</Label>
          <Textarea rows={4} value={risco} onChange={(e) => setRisco(e.target.value)} className="font-mono text-xs" placeholder='[{"card_code": "F000123", "motivo": "histórico"}]' />
        </div>

        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
