import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Key, Save, Trash2, Loader2,
  CheckCircle2, XCircle, Eye, EyeOff, Shield, Settings2, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { useCredentials } from "@/hooks/useCredentials";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";
import { SYSTEMS, CATEGORY_LABELS, type SystemConfig } from "@/lib/system-definitions";
import { useEnabledErpTypes } from "@/hooks/useEnabledErpTypes";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { sapFunctionFetch } from "@/lib/auth-fetch";

const TEST_ENDPOINTS: Record<string, string> = {
  mastertax: "mastertax-test",
};

function CredentialModal({
  system,
  existingKeys,
  open,
  onOpenChange,
  companyDb,
}: {
  system: SystemConfig;
  existingKeys: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyDb?: string;
}) {
  const { saveCredentials, deleteCredentials, fetchCredentialValues, isLoading } = useCredentials();
  const [values, setValues] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const hasExisting = existingKeys.length > 0;

  // Load existing non-secret values (custom_fields, toggle) when dialog opens
  useEffect(() => {
    if (!open) return;
    const loadableKeys = system.fields
      .filter((f) => (f.type === "custom_fields" || f.type === "toggle") && existingKeys.includes(f.key))
      .map((f) => f.key);
    if (loadableKeys.length === 0) return;
    fetchCredentialValues(system.name, loadableKeys, companyDb).then((map) => {
      setValues((prev) => ({ ...prev, ...map }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, system.name]);

  const handleSave = async () => {
    const creds = system.fields
      .filter((f) => {
        if (f.type === "toggle") return values[f.key] !== undefined;
        return values[f.key]?.trim();
      })
      .map((f) => ({
        key: f.key,
        value: f.type === "toggle" ? (values[f.key] === "true" ? "true" : "false") : values[f.key].trim(),
      }));

    if (creds.length === 0) {
      toast.error("Preencha pelo menos um campo");
      return;
    }

    const ok = await saveCredentials(system.name, creds, companyDb);
    if (ok) {
      toast.success(`Credenciais do ${system.label} salvas com sucesso`);
      setValues({});
      onOpenChange(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remover todas as credenciais do ${system.label}?`)) return;
    const ok = await deleteCredentials(system.name, companyDb);
    if (ok) {
      toast.success(`Credenciais do ${system.label} removidas`);
      onOpenChange(false);
    }
  };

  const Icon = system.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg">{system.label}</DialogTitle>
              <DialogDescription>{system.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
          {system.fields.map((field) => {
            const isConfigured = existingKeys.includes(field.key);
            const isPassword = field.type === "password";
            const isCustom = field.type === "custom_fields";
            const isToggle = field.type === "toggle";
            const showPw = showPasswords[field.key];

            if (isCustom) {
              return (
                <CustomFieldsEditor
                  key={field.key}
                  value={values[field.key] || ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              );
            }

            if (isToggle) {
              const checked = values[field.key] === "true";
              return (
                <div
                  key={field.key}
                  className="md:col-span-2 flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
                >
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                      {field.label}
                      {isConfigured && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                    </Label>
                    {field.description && (
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) =>
                      setValues((prev) => ({ ...prev, [field.key]: v ? "true" : "false" }))
                    }
                  />
                </div>
              );
            }

            return (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-sm text-muted-foreground flex items-center gap-2">
                  {field.label}
                  {isConfigured && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                </Label>
                <div className="relative">
                  <Input
                    type={isPassword && !showPw ? "password" : "text"}
                    placeholder={isConfigured ? "••••••• (já configurado)" : field.placeholder}
                    value={values[field.key] || ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="bg-card pr-10"
                  />
                  {isPassword && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasExisting && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={isLoading}
              className="gap-2 text-destructive hover:text-destructive mr-auto"
            >
              <Trash2 className="w-4 h-4" />
              Remover
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isLoading} className="gap-2">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Credentials() {
  const navigate = useNavigate();
  const { session } = useSap();
  const companyDb = session?.companyDB;
  const { credentials, fetchCredentials, isLoading } = useCredentials();
  const [selectedSystem, setSelectedSystem] = useState<SystemConfig | null>(null);
  const [enabledSystems, setEnabledSystems] = useState<Record<string, boolean>>({});
  const { enabledNames: enabledErpNames, isLoading: erpTypesLoading } = useEnabledErpTypes();

  useEffect(() => {
    fetchCredentials(companyDb);
  }, [fetchCredentials, companyDb]);

  useEffect(() => {
    const enabled: Record<string, boolean> = { ...enabledSystems };
    SYSTEMS.forEach((s) => {
      const hasKeys = credentials.some((c) => c.system_name === s.name);
      if (hasKeys && enabled[s.name] === undefined) {
        enabled[s.name] = true;
      }
    });
    setEnabledSystems(enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  const getKeysForSystem = (system: string) =>
    credentials.filter((c) => c.system_name === system).map((c) => c.credential_key);

  const toggleSystem = (name: string, checked: boolean) => {
    setEnabledSystems((prev) => {
      const next = { ...prev, [name]: checked };
      // ERP exclusivity: deactivate other ERPs when activating one
      if (checked) {
        const activatedSystem = SYSTEMS.find((s) => s.name === name);
        if (activatedSystem?.category === "erp") {
          SYSTEMS.forEach((s) => {
            if (s.category === "erp" && s.name !== name) {
              next[s.name] = false;
            }
          });
          const others = SYSTEMS.filter((s) => s.category === "erp" && s.name !== name).map((s) => s.label);
          if (others.length > 0) {
            toast.info(`${others.join(", ")} desativado(s) — apenas um ERP pode estar ativo`);
          }
        }
      }
      return next;
    });
    if (!checked) {
      toast.info("Integração desativada. As credenciais foram mantidas.");
    }
  };

  // Group systems by category, filtering ERPs by admin-enabled list
  const erpSystems = SYSTEMS.filter((s) => s.category === "erp" && enabledErpNames.includes(s.name));
  // Non-ERP integrations: shown by default; if there's a toggle row in enabled_erp_types and it's off, hide.
  const otherSystems = SYSTEMS.filter((s) => {
    if (s.category) return false;
    if (erpTypesLoading) return true;
    // If a toggle exists for this integration, respect it; otherwise always show.
    const hasToggle = enabledErpNames !== undefined; // erpTypes is loaded; check by presence in raw list
    return hasToggle ? enabledErpNames.includes(s.name) || !["mastertax"].includes(s.name) : true;
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Credenciais <span className="text-gradient">do Sistema</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              {companyDb
                ? `Credenciais para a empresa ${companyDb}`
                : "Gerencie as conexões com sistemas externos de forma segura"}
            </p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="glass-card p-4 flex items-start gap-3 border-warning/30">
            <Shield className="w-5 h-5 text-warning mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Armazenamento Seguro</p>
              <p className="text-xs text-muted-foreground">
                As credenciais são armazenadas de forma segura no backend e nunca são expostas ao
                navegador. Apenas as funções do servidor têm acesso aos valores.
              </p>
            </div>
          </div>

          {isLoading && credentials.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-8">
              {[
                { label: "ERP", systems: erpSystems },
                { label: "Integrações", systems: otherSystems },
              ].map((group) => (
                <div key={group.label}>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {group.label}
                    {group.label === "ERP" && (
                      <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
                        — apenas um ativo por vez
                      </span>
                    )}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {group.systems.map((system) => {
                      const existingKeys = getKeysForSystem(system.name);
                      const isConfigured = existingKeys.length > 0;
                      const isEnabled = enabledSystems[system.name] ?? false;
                      const Icon = system.icon;

                      return (
                        <motion.div
                          key={system.name}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <Card
                            className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/30 ${
                              !isEnabled ? "opacity-60" : ""
                            }`}
                            onClick={() => setSelectedSystem(system)}
                          >
                            <CardContent className="p-5 space-y-4">
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="p-2.5 rounded-xl bg-primary/10">
                                    <Icon className="w-6 h-6 text-primary" />
                                  </div>
                                  <div>
                                    <h3 className="font-semibold text-foreground">{system.label}</h3>
                                    <p className="text-xs text-muted-foreground">{system.description}</p>
                                  </div>
                                </div>
                                <div onClick={(e) => e.stopPropagation()} className="pt-1">
                                  <Switch
                                    checked={isEnabled}
                                    onCheckedChange={(checked) => toggleSystem(system.name, checked)}
                                  />
                                </div>
                              </div>

                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {isConfigured ? (
                                    <Badge
                                      variant="secondary"
                                      className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      Configurado
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="secondary"
                                      className="gap-1 bg-muted text-muted-foreground"
                                    >
                                      <XCircle className="w-3 h-3" />
                                      Não configurado
                                    </Badge>
                                  )}
                                </div>
                                <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
                                  <Settings2 className="w-3.5 h-3.5" />
                                  Configurar
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {selectedSystem && (
        <CredentialModal
          system={selectedSystem}
          existingKeys={getKeysForSystem(selectedSystem.name)}
          open={!!selectedSystem}
          companyDb={companyDb}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedSystem(null);
              fetchCredentials(companyDb);
            }
          }}
        />
      )}
    </div>
  );
}
