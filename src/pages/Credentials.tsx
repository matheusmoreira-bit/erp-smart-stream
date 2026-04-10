import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Key,
  CreditCard,
  Server,
  Save,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Shield,
  Settings2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { useCredentials } from "@/hooks/useCredentials";
import { toast } from "sonner";

interface SystemField {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
}

interface SystemConfig {
  name: string;
  label: string;
  description: string;
  icon: typeof Key;
  fields: SystemField[];
}

const SYSTEMS: SystemConfig[] = [
  {
    name: "pagcorp",
    label: "PagCorp",
    description: "Gateway de pagamentos corporativos",
    icon: CreditCard,
    fields: [
      { key: "api_base_url", label: "URL Base da API", placeholder: "https://bifrost.acgsa.com.br/kraken/v1/" },
      { key: "client_key", label: "Client Key", placeholder: "UUID do client" },
      { key: "client_secret", label: "Client Secret", type: "password", placeholder: "UUID do secret" },
      { key: "login_email", label: "Login / Email", placeholder: "usuario_login" },
      { key: "login_password", label: "Senha", type: "password", placeholder: "Senha de acesso" },
      { key: "aes_key", label: "Chave AES (Base64)", type: "password", placeholder: "Chave AES-256 em Base64" },
      { key: "hmac_key", label: "Chave HMAC (Base64)", type: "password", placeholder: "Chave HMAC-SHA256 em Base64" },
      { key: "account_id", label: "Account ID", placeholder: "ID da conta PagCorp" },
    ],
  },
  {
    name: "sap",
    label: "SAP Business One",
    description: "Credencial usada exclusivamente para integrações automáticas (ex: PagCorp → SAP). Não é utilizada para carregamento de dados em tela.",
    icon: Server,
    fields: [
      { key: "service_layer_url", label: "URL do Service Layer", placeholder: "https://servidor:50000/b1s/v1/" },
      { key: "company_db", label: "Banco de Dados", placeholder: "SBO_EMPRESA" },
      { key: "username", label: "Usuário de Integração", placeholder: "usuario_integracao" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário de integração" },
    ],
  },
  {
    name: "jumpcloud",
    label: "JumpCloud",
    description: "Gestão de identidades e diretório de usuários",
    icon: Users,
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "Chave de API do JumpCloud" },
      { key: "org_id", label: "Organization ID", placeholder: "ID da organização" },
    ],
  },
];

function CredentialModal({
  system,
  existingKeys,
  open,
  onOpenChange,
}: {
  system: SystemConfig;
  existingKeys: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { saveCredentials, deleteCredentials, isLoading } = useCredentials();
  const [values, setValues] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const hasExisting = existingKeys.length > 0;

  const handleSave = async () => {
    const creds = system.fields
      .filter((f) => values[f.key]?.trim())
      .map((f) => ({ key: f.key, value: values[f.key].trim() }));

    if (creds.length === 0) {
      toast.error("Preencha pelo menos um campo");
      return;
    }

    const ok = await saveCredentials(system.name, creds);
    if (ok) {
      toast.success(`Credenciais do ${system.label} salvas com sucesso`);
      setValues({});
      onOpenChange(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remover todas as credenciais do ${system.label}?`)) return;
    const ok = await deleteCredentials(system.name);
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
            const showPw = showPasswords[field.key];

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
  const { credentials, fetchCredentials, isLoading } = useCredentials();
  const [selectedSystem, setSelectedSystem] = useState<SystemConfig | null>(null);
  const [enabledSystems, setEnabledSystems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  // Auto-enable systems that have credentials
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
    setEnabledSystems((prev) => ({ ...prev, [name]: checked }));
    if (!checked) {
      toast.info("Integração desativada. As credenciais foram mantidas.");
    }
  };

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
              Gerencie as conexões com sistemas externos de forma segura
            </p>
          </div>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SYSTEMS.map((system) => {
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
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="pt-1"
                          >
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
          )}
        </div>
      </main>

      {selectedSystem && (
        <CredentialModal
          system={selectedSystem}
          existingKeys={getKeysForSystem(selectedSystem.name)}
          open={!!selectedSystem}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedSystem(null);
              fetchCredentials();
            }
          }}
        />
      )}
    </div>
  );
}
