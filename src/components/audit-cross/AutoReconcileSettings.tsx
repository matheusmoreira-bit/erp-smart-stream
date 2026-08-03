import { useCallback, useEffect, useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CfgState {
  auto_conciliar: boolean;
  auto_score_min: number;
  auto_exigir_lancamento_erp: boolean;
  tolerancia_valor_abs: number;
  tolerancia_valor_pct: number;
  janela_dias: number;
  usar_raiz_cnpj_fallback: boolean;
}

const DEFAULTS: CfgState = {
  auto_conciliar: true,
  auto_score_min: 0.9,
  auto_exigir_lancamento_erp: false,
  tolerancia_valor_abs: 1,
  tolerancia_valor_pct: 0.005,
  janela_dias: 10,
  usar_raiz_cnpj_fallback: false,
};

/**
 * Regras da conciliação automática por empresa: o que casa acima do score mínimo
 * (e, opcionalmente, com lançamento confirmado no ERP) sai do Kanban de exceções.
 */
export function AutoReconcileSettings({
  empresaId,
  onSaved,
}: {
  empresaId: string;
  onSaved?: () => void;
}) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<CfgState>(DEFAULTS);

  const load = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("auditoria_cruzamento_config" as any)
      .select("*")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (err) setError(err.message);
    else if (data) {
      const d = data as any;
      setCfg({
        auto_conciliar: d.auto_conciliar ?? DEFAULTS.auto_conciliar,
        auto_score_min: Number(d.auto_score_min ?? DEFAULTS.auto_score_min),
        auto_exigir_lancamento_erp: d.auto_exigir_lancamento_erp ?? DEFAULTS.auto_exigir_lancamento_erp,
        tolerancia_valor_abs: Number(d.tolerancia_valor_abs ?? DEFAULTS.tolerancia_valor_abs),
        tolerancia_valor_pct: Number(d.tolerancia_valor_pct ?? DEFAULTS.tolerancia_valor_pct),
        janela_dias: Number(d.janela_dias ?? DEFAULTS.janela_dias),
        usar_raiz_cnpj_fallback: d.usar_raiz_cnpj_fallback ?? DEFAULTS.usar_raiz_cnpj_fallback,
      });
    } else {
      setCfg(DEFAULTS);
    }
    setLoading(false);
  }, [empresaId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  function invalid(): string | null {
    if (!(cfg.auto_score_min >= 0 && cfg.auto_score_min <= 1)) return "Score mínimo deve ficar entre 0 e 1.";
    if (!(cfg.tolerancia_valor_abs >= 0)) return "Tolerância em R$ não pode ser negativa.";
    if (!(cfg.tolerancia_valor_pct >= 0 && cfg.tolerancia_valor_pct <= 1)) return "Tolerância percentual deve ficar entre 0 e 1.";
    if (!(Number.isFinite(cfg.janela_dias) && cfg.janela_dias >= 0 && cfg.janela_dias <= 180)) return "Janela de dias deve ficar entre 0 e 180.";
    return null;
  }

  async function handleSave() {
    const problem = invalid();
    if (problem) {
      toast({ title: "Valores inválidos", description: problem, variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error: err } = await supabase
      .from("auditoria_cruzamento_config" as any)
      .upsert(
        {
          empresa_id: empresaId,
          ...cfg,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "empresa_id" },
      );
    setSaving(false);
    if (err) {
      toast({ title: "Falha ao salvar regras", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: "Regras de conciliação salvas" });
    setOpen(false);
    onSaved?.();
  }

  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1" disabled={!empresaId}>
          <Settings2 className="w-3 h-3" /> Regras automáticas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conciliação fiscal automática</DialogTitle>
          <DialogDescription>
            Define quando NFS-e, pagamento e lançamento no ERP casam sozinhos. O que passar nessas
            regras sai do Kanban e só as exceções continuam visíveis.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando regras…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm px-3 py-2">
            {error}
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm">
                Conciliar automaticamente
                <span className="block text-xs text-muted-foreground">
                  Desligado, tudo fica como exceção para revisão manual.
                </span>
              </span>
              <Switch
                checked={cfg.auto_conciliar}
                onCheckedChange={(v) => setCfg((c) => ({ ...c, auto_conciliar: v }))}
                disabled={!isAdmin}
              />
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm">
                Exigir lançamento confirmado no ERP
                <span className="block text-xs text-muted-foreground">
                  Só conclui quando a nota já virou documento no ERP (3ª perna).
                </span>
              </span>
              <Switch
                checked={cfg.auto_exigir_lancamento_erp}
                onCheckedChange={(v) => setCfg((c) => ({ ...c, auto_exigir_lancamento_erp: v }))}
                disabled={!isAdmin}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs" htmlFor="auto-score">Score mínimo (0–1)</Label>
                <Input
                  id="auto-score" type="number" step="0.05" min={0} max={1} disabled={!isAdmin}
                  value={cfg.auto_score_min}
                  onChange={(e) => setCfg((c) => ({ ...c, auto_score_min: num(e.target.value) }))}
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor="auto-dias">Janela de dias (±)</Label>
                <Input
                  id="auto-dias" type="number" step="1" min={0} max={180} disabled={!isAdmin}
                  value={cfg.janela_dias}
                  onChange={(e) => setCfg((c) => ({ ...c, janela_dias: num(e.target.value) }))}
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor="auto-abs">Tolerância R$</Label>
                <Input
                  id="auto-abs" type="number" step="0.01" min={0} disabled={!isAdmin}
                  value={cfg.tolerancia_valor_abs}
                  onChange={(e) => setCfg((c) => ({ ...c, tolerancia_valor_abs: num(e.target.value) }))}
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor="auto-pct">Tolerância % (0,005 = 0,5%)</Label>
                <Input
                  id="auto-pct" type="number" step="0.001" min={0} max={1} disabled={!isAdmin}
                  value={cfg.tolerancia_valor_pct}
                  onChange={(e) => setCfg((c) => ({ ...c, tolerancia_valor_pct: num(e.target.value) }))}
                />
              </div>
            </div>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm">
                Aceitar matriz/filial pelo CNPJ raiz
                <span className="block text-xs text-muted-foreground">
                  Casa fornecedores com os mesmos 8 primeiros dígitos.
                </span>
              </span>
              <Switch
                checked={cfg.usar_raiz_cnpj_fallback}
                onCheckedChange={(v) => setCfg((c) => ({ ...c, usar_raiz_cnpj_fallback: v }))}
                disabled={!isAdmin}
              />
            </label>

            {!isAdmin && (
              <p className="text-xs text-muted-foreground">
                Somente administradores podem alterar estas regras.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          <Button onClick={handleSave} disabled={!isAdmin || saving || loading}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Salvar regras
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AutoReconcileSettings;
