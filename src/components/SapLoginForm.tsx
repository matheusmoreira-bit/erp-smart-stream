import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, Lock, User, Database, LogIn, Loader2, Settings, Box, Server, Cloud, Building2, Layers, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSap } from "@/contexts/SapContext";
import type { ErpType } from "@/contexts/SapContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useEnabledErpTypes } from "@/hooks/useEnabledErpTypes";
import cactusLogo from "@/assets/cactus-logo.png.asset.json";

interface CompanyOption {
  label: string;
  value: string;
  erp_type: string;
}

const ERP_LABELS: Record<string, { label: string; icon: typeof Server; method: string }> = {
  sap: { label: "SAP Business One", icon: Server, method: "Service Layer" },
  s4hana_cloud: { label: "SAP S/4HANA Cloud", icon: Cloud, method: "credenciais armazenadas" },
  s4hana_cloud_private: { label: "SAP S/4HANA Cloud Private", icon: Cloud, method: "credenciais armazenadas" },
  s4hana_onprem: { label: "SAP S/4HANA On-Premise", icon: Building2, method: "credenciais armazenadas" },
  omie: { label: "OMIE", icon: Box, method: "API OMIE" },
  totvs_protheus: { label: "TOTVS Protheus", icon: Layers, method: "credenciais armazenadas" },
  totvs_rm: { label: "TOTVS RM", icon: Layers, method: "credenciais armazenadas" },
  totvs_datasul: { label: "TOTVS Datasul", icon: Layers, method: "credenciais armazenadas" },
  netsuite: { label: "Oracle NetSuite", icon: Cloud, method: "credenciais armazenadas (TBA)" },
};

function getErpBadge(erpType: string): string {
  if (erpType === "sap") return "SAP B1";
  if (erpType.startsWith("s4hana")) return "S/4HANA";
  if (erpType.startsWith("totvs")) return "TOTVS";
  if (erpType === "netsuite") return "NetSuite";
  return erpType.toUpperCase();
}

export function SapLoginForm() {
  const { login, isLoading } = useSap();
  const navigate = useNavigate();
  const { enabledNames, isLoading: erpLoading } = useEnabledErpTypes();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [companyDB, setCompanyDB] = useState("");
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Filter only when we know which ERPs are enabled; otherwise show all active companies
  // so a slow/failing enabled_erp_types query never blocks the login list.
  const databases = erpLoading || enabledNames.length === 0
    ? allCompanies
    : allCompanies.filter((d) => enabledNames.includes(d.erp_type));

  const selectedCompany = databases.find((d) => d.value === companyDB);
  const erpType = selectedCompany?.erp_type || "sap";
  const needsCredentials = erpType === "sap"; // Only SAP B1 requires user/pass at login
  const isStateless = erpType === "omie" || erpType.startsWith("s4hana") || erpType.startsWith("totvs") || erpType === "netsuite";
  const erpInfo = ERP_LABELS[erpType] || ERP_LABELS.sap;
  const ErpIcon = erpInfo.icon;

  const loadCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    setCompaniesError(null);
    try {
      const { data, error } = await supabase
        .from("companies")
        .select("company_db, display_name, erp_type")
        .eq("is_active", true)
        .order("display_name");
      if (error) throw error;
      setAllCompanies(
        (data || []).map((c: any) => ({
          label: c.display_name,
          value: c.company_db,
          erp_type: c.erp_type || "sap",
        })),
      );
    } catch (e) {
      setCompaniesError(e instanceof Error ? e.message : "Falha ao carregar empresas");
    } finally {
      setCompaniesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyDB) {
      toast.error("Selecione a empresa");
      return;
    }
    if (needsCredentials && (!userName || !password)) {
      toast.error("Preencha todos os campos");
      return;
    }
    try {
      // SAP B1 usernames are typically the local-part only (e.g. "marco.tulio"),
      // not the full email. Strip the domain automatically so users can type either.
      const sapUser = needsCredentials && userName.includes("@")
        ? userName.split("@")[0].trim()
        : userName.trim();
      await login(sapUser, password, companyDB, erpType as ErpType);
      toast.success(`Conectado ao ${erpInfo.label}!`);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error ?? "");
      const lower = raw.toLowerCase();

      const isInvalidCreds =
        lower.includes("user name or password") ||
        lower.includes("invalid username or password") ||
        lower.includes("invalid credentials") ||
        lower.includes("senha incorreta") ||
        lower.includes("usuário ou senha") ||
        lower.includes("usuario ou senha") ||
        lower.includes("-304") ||
        lower.includes(" 401");

      const isLocked =
        lower.includes("locked") || lower.includes("bloquead") || lower.includes("-131");

      const isNetwork =
        lower.includes("failed to fetch") ||
        lower.includes("networkerror") ||
        lower.includes("timeout") ||
        lower.includes("econn") ||
        lower.includes("getaddrinfo");

      if (isInvalidCreds) {
        toast.error("Usuário ou senha incorretos", {
          description: "Verifique suas credenciais e tente novamente.",
        });
      } else if (isLocked) {
        toast.error("Usuário bloqueado no ERP", {
          description: "Procure o administrador para desbloquear seu acesso.",
        });
      } else if (isNetwork) {
        toast.error("Não foi possível conectar ao ERP", {
          description: "Verifique sua conexão ou se o servidor está disponível.",
        });
      } else {
        toast.error("Não foi possível entrar", {
          description: raw || "Tente novamente em instantes.",
        });
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-primary/10 glow-primary mb-4">
            <img src={cactusLogo.url} alt="Logo" className="w-8 h-8 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            ERP <span className="text-gradient">Analytics</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte-se ao seu ERP
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
          {/* Database Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Empresa
            </label>
            <Select value={companyDB} onValueChange={(val) => {
              setCompanyDB(val);
              setUserName("");
              setPassword("");
            }} disabled={companiesLoading}>
              <SelectTrigger className="bg-muted/30 border-border">
                <SelectValue placeholder={companiesLoading ? "Carregando empresas..." : "Selecione a empresa"} />
              </SelectTrigger>
              <SelectContent>
                {databases.map((db) => (
                  <SelectItem key={db.value} value={db.value}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{db.label}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {getErpBadge(db.erp_type)}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
                {!companiesLoading && databases.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    Nenhuma empresa disponível
                  </div>
                )}
              </SelectContent>
            </Select>
            {companiesError && (
              <div className="flex items-center justify-between text-xs text-destructive">
                <span>Falha ao carregar empresas.</span>
                <button type="button" onClick={loadCompanies} className="underline hover:no-underline">
                  Tentar novamente
                </button>
              </div>
            )}
          </div>


          {/* ERP indicator */}
          {companyDB && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border">
              <ErpIcon className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                Conexão via <span className="font-semibold text-foreground">{erpInfo.label}</span>
              </span>
            </div>
          )}

          {/* SAP B1 fields — user/password */}
          {needsCredentials && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <User className="w-4 h-4 text-primary" />
                  Usuário
                </label>
                <Input
                  placeholder="Seu usuário SAP"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="bg-muted/30 border-border"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" />
                  Senha
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Sua senha SAP"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-muted/30 border-border pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Stateless ERP info */}
          {isStateless && companyDB && (
            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/20 border border-border">
              O login será feito automaticamente usando as credenciais do {erpInfo.label} configuradas para esta empresa.
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <LogIn className="w-4 h-4 mr-2" />
            )}
            {isLoading ? "Conectando..." : "Entrar"}
          </Button>
        </form>

        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-muted-foreground">
            Conexão segura via {erpInfo.method}
          </p>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => navigate("/backoffice/login")}>
            <Settings className="w-3 h-3 mr-1" />
            Backoffice
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
