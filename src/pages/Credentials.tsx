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
  Eye,
  EyeOff,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { useCredentials } from "@/hooks/useCredentials";
import { toast } from "sonner";

interface SystemConfig {
  name: string;
  label: string;
  icon: typeof Key;
  fields: { key: string; label: string; type?: string; placeholder?: string }[];
}

const SYSTEMS: SystemConfig[] = [
  {
    name: "pagcorp",
    label: "PagCorp",
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
    icon: Server,
    fields: [
      { key: "service_layer_url", label: "URL do Service Layer", placeholder: "https://servidor:50000/b1s/v1/" },
      { key: "company_db", label: "Banco de Dados", placeholder: "SBO_EMPRESA" },
      { key: "username", label: "Usuário", placeholder: "manager" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do Service Layer" },
    ],
  },
];

function SystemCredentialForm({ system, existingKeys }: { system: SystemConfig; existingKeys: string[] }) {
  const { saveCredentials, deleteCredentials, isLoading } = useCredentials();
  const [values, setValues] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const hasExisting = existingKeys.length > 0;

  const handleSave = async () => {
    const creds = system.fields
      .filter(f => values[f.key]?.trim())
      .map(f => ({ key: f.key, value: values[f.key].trim() }));

    if (creds.length === 0) {
      toast.error("Preencha pelo menos um campo");
      return;
    }

    const ok = await saveCredentials(system.name, creds);
    if (ok) {
      toast.success(`Credenciais do ${system.label} salvas com sucesso`);
      setValues({});
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remover todas as credenciais do ${system.label}?`)) return;
    const ok = await deleteCredentials(system.name);
    if (ok) toast.success(`Credenciais do ${system.label} removidas`);
  };

  const Icon = system.icon;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">{system.label}</h3>
            <p className="text-xs text-muted-foreground">
              {hasExisting ? `${existingKeys.length} credenciais configuradas` : "Nenhuma credencial configurada"}
            </p>
          </div>
        </div>
        {hasExisting && (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Configurado
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {system.fields.map(field => {
          const isConfigured = existingKeys.includes(field.key);
          const isPassword = field.type === "password";
          const showPw = showPasswords[field.key];

          return (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-sm text-muted-foreground flex items-center gap-2">
                {field.label}
                {isConfigured && <CheckCircle2 className="w-3 h-3 text-success" />}
              </Label>
              <div className="relative">
                <Input
                  type={isPassword && !showPw ? "password" : "text"}
                  placeholder={isConfigured ? "••••••• (já configurado)" : field.placeholder}
                  value={values[field.key] || ""}
                  onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="bg-card pr-10"
                />
                {isPassword && (
                  <button
                    type="button"
                    onClick={() => setShowPasswords(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
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

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave} disabled={isLoading} className="gap-2">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Credenciais
        </Button>
        {hasExisting && (
          <Button variant="outline" onClick={handleDelete} disabled={isLoading} className="gap-2 text-destructive hover:text-destructive">
            <Trash2 className="w-4 h-4" />
            Remover
          </Button>
        )}
      </div>
    </motion.div>
  );
}

export default function Credentials() {
  const navigate = useNavigate();
  const { credentials, fetchCredentials, isLoading } = useCredentials();

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const getKeysForSystem = (system: string) =>
    credentials.filter(c => c.system_name === system).map(c => c.credential_key);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Credenciais <span className="text-gradient">do Sistema</span>
            </h1>
            <p className="text-xs text-muted-foreground">Gerencie as conexões com sistemas externos de forma segura</p>
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
                As credenciais são armazenadas de forma segura no backend e nunca são expostas ao navegador.
                Apenas as funções do servidor têm acesso aos valores.
              </p>
            </div>
          </div>

          {isLoading && credentials.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            SYSTEMS.map(system => (
              <SystemCredentialForm
                key={system.name}
                system={system}
                existingKeys={getKeysForSystem(system.name)}
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
