import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, Loader2, Plug, Save, Settings2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useSynapseIntegrations,
  type SynapseIntegration,
} from "@/hooks/useSynapseIntegrations";

/**
 * Company-scoped integration controls (activation + parameters).
 * Environment-wide settings stay in the backoffice.
 */
export function CompanyIntegrationsSection({ companyDb }: { companyDb?: string }) {
  const {
    integrations,
    isLoading,
    fetchIntegrations,
    ensureIntegration,
    updateIntegration,
  } = useSynapseIntegrations(companyDb || undefined);

  const [selected, setSelected] = useState<SynapseIntegration | null>(null);
  const [formActive, setFormActive] = useState(false);
  const [formInterval, setFormInterval] = useState(60);
  const [formParams, setFormParams] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyDb) return;
    ensureIntegration(companyDb).then(() => fetchIntegrations());
  }, [companyDb, ensureIntegration, fetchIntegrations]);

  const sorted = useMemo(
    () => [...integrations].sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR")),
    [integrations],
  );

  const openConfig = (integration: SynapseIntegration) => {
    setSelected(integration);
    setFormActive(integration.is_active);
    setFormInterval(integration.interval_minutes);
    setFormParams(
      Object.fromEntries(
        Object.entries(integration.parameters || {}).map(([k, v]) => [k, String(v ?? "")]),
      ),
    );
  };

  const handleToggle = async (integration: SynapseIntegration, checked: boolean) => {
    try {
      await updateIntegration(integration.id, { is_active: checked });
      toast.success(`${integration.display_name} ${checked ? "ativada" : "desativada"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar integração");
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(formParams)) {
        if (v === "true") params[k] = true;
        else if (v === "false") params[k] = false;
        else params[k] = v;
      }
      await updateIntegration(selected.id, {
        is_active: formActive,
        interval_minutes: Math.max(1, formInterval),
        parameters: params,
      } as Partial<SynapseIntegration>);
      toast.success("Configuração salva");
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (!companyDb) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Integrações da Empresa
        <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
          — ativação e parâmetros por empresa
        </span>
      </h2>

      {isLoading && sorted.length === 0 ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Nenhuma integração disponível para esta empresa.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sorted.map((integration) => (
            <motion.div key={integration.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card
                className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/30 ${
                  integration.is_active ? "" : "opacity-60"
                }`}
                onClick={() => openConfig(integration)}
              >
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-primary/10">
                        <Plug className="w-6 h-6 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{integration.display_name}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {integration.description}
                        </p>
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()} className="pt-1">
                      <Switch
                        checked={integration.is_active}
                        onCheckedChange={(checked) => handleToggle(integration, checked)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    {integration.is_active ? (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Ativa
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1 bg-muted text-muted-foreground">
                        <XCircle className="w-3 h-3" />
                        Inativa
                      </Badge>
                    )}
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
                      <Settings2 className="w-3.5 h-3.5" />
                      Configurar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              {selected?.display_name}
            </DialogTitle>
            <DialogDescription>{selected?.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label>Integração ativa</Label>
              <Switch checked={formActive} onCheckedChange={setFormActive} />
            </div>

            <div className="space-y-1">
              <Label>Intervalo de execução (minutos)</Label>
              <Input
                type="number"
                min={1}
                value={formInterval}
                onChange={(e) => setFormInterval(Number(e.target.value))}
                className="bg-card"
              />
            </div>

            {Object.keys(formParams).length > 0 && (
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Parâmetros</p>
                {Object.entries(formParams).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground capitalize">
                      {key.replace(/_/g, " ")}
                    </Label>
                    {value === "true" || value === "false" ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={value === "true"}
                          onCheckedChange={(checked) =>
                            setFormParams((p) => ({ ...p, [key]: String(checked) }))
                          }
                        />
                        <span className="text-sm text-muted-foreground">
                          {value === "true" ? "Sim" : "Não"}
                        </span>
                      </div>
                    ) : (
                      <Input
                        value={value}
                        onChange={(e) => setFormParams((p) => ({ ...p, [key]: e.target.value }))}
                        className="bg-card"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CompanyIntegrationsSection;
