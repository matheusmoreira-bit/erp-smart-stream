import { useState } from "react";
import { useEnabledErpTypes } from "@/hooks/useEnabledErpTypes";
import { useSynapseGlobalSettings, type SynapseGlobalSetting } from "@/hooks/useSynapseGlobalSettings";
import { SYSTEMS } from "@/lib/system-definitions";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, Save } from "lucide-react";
import { toast } from "sonner";

export default function IntegrationsTab() {
  const { erpTypes, isLoading, toggle } = useEnabledErpTypes();
  const { settings, isLoading: gLoading, update, getDisplay, isSaving } = useSynapseGlobalSettings();
  const [edits, setEdits] = useState<Record<string, { active: boolean; interval: number }>>({});

  const handleToggle = async (erpType: string, checked: boolean) => {
    await toggle(erpType, checked);
    const sys = SYSTEMS.find((s) => s.name === erpType);
    toast.success(`${sys?.label || erpType} ${checked ? "ativado" : "desativado"}`);
  };

  const getEdit = (s: SynapseGlobalSetting) =>
    edits[s.id] || { active: s.is_active_global, interval: s.interval_minutes };

  const setEdit = (id: string, patch: Partial<{ active: boolean; interval: number }>) =>
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || { active: false, interval: 15 }), ...patch },
    }));

  const handleSave = async (s: SynapseGlobalSetting) => {
    const e = getEdit(s);
    try {
      await update(s.id, { is_active_global: e.active, interval_minutes: Math.max(1, e.interval) });
      toast.success("Configuração global salva");
      setEdits((prev) => { const n = { ...prev }; delete n[s.id]; return n; });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Integrações Disponíveis</h2>
        <p className="text-sm text-muted-foreground">
          Selecione quais ERPs ficam visíveis na tela de credenciais e no login.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {erpTypes.map((erp) => {
          const sys = SYSTEMS.find((s) => s.name === erp.erp_type);
          if (!sys) return null;
          const Icon = sys.icon;

          return (
            <div
              key={erp.erp_type}
              className={`flex items-center gap-4 p-4 rounded-xl border border-border bg-card transition-opacity ${
                !erp.is_active ? "opacity-50" : ""
              }`}
            >
              <div className="p-2.5 rounded-xl bg-primary/10">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground">{sys.label}</p>
                <p className="text-xs text-muted-foreground truncate">{sys.description}</p>
              </div>
              <Badge
                variant={erp.is_active ? "default" : "secondary"}
                className="text-[10px] mr-2"
              >
                {erp.is_active ? "Ativo" : "Inativo"}
              </Badge>
              <Switch
                checked={erp.is_active}
                onCheckedChange={(checked) => handleToggle(erp.erp_type, checked)}
              />
            </div>
          );
        })}
      </div>

      <div className="border-t border-border pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Configurações Globais — Synapse</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Controla globalmente os fluxos automáticos. Cada empresa ainda precisa ativar a integração no Synapse.
        </p>

        {gLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : settings.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhuma configuração global cadastrada.</p>
        ) : (
          <div className="space-y-3">
            {settings.map((s) => {
              const meta = getDisplay(s.integration_key);
              const e = getEdit(s);
              const dirty = e.active !== s.is_active_global || e.interval !== s.interval_minutes;
              return (
                <div key={s.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{meta.name}</p>
                      <p className="text-xs text-muted-foreground">{meta.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={e.active ? "default" : "secondary"} className="text-[10px]">
                        {e.active ? "Ativo" : "Inativo"}
                      </Badge>
                      <Switch
                        checked={e.active}
                        onCheckedChange={(v) => setEdit(s.id, { active: v })}
                      />
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1 max-w-xs space-y-1">
                      <Label className="text-xs">Frequência (minutos)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={e.interval}
                        onChange={(ev) => setEdit(s.id, { interval: Number(ev.target.value) })}
                        className="bg-background"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleSave(s)}
                      disabled={!dirty || isSaving}
                      className="gap-2"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Salvar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
