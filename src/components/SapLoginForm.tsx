import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, Lock, User, Database, LogIn, Loader2, Settings, Box, Server, Cloud, Building2, Layers, Eye, EyeOff, ShieldCheck, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { classifyErpLoginError, attemptWarning, type ErpLoginErrorInfo } from "@/lib/erp-login-error";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSap } from "@/contexts/SapContext";
import type { ErpType } from "@/contexts/SapContext";
import { supabase } from "@/integrations/supabase/client";
import { isTestCompanyDb } from "@/lib/test-company";
import { resolveTestCompanyVisibility } from "@/lib/test-company-visibility";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useEnabledErpTypes } from "@/hooks/useEnabledErpTypes";
import { assertIdpBinding, assertSapLoginIdpBinding, upsertGoogleIdpMapping, upsertLocalAdminMapping } from "@/lib/idp-binding";
import cactusLogo from "@/assets/cactus-logo.png.asset.json";



const OMIE_PENDING_KEY = "omie_google_pending_company_db";

async function isEmailAllowedForOmieCompany(email: string, companyDb: string): Promise<boolean> {
  // Server-side check via SECURITY DEFINER RPC — the client no longer reads
  // the full user_group_assignments table just to answer this question.
  const { data, error } = await supabase.rpc("is_email_allowed_for_omie_company", {
    _email: email,
    _company_db: companyDb,
  });
  if (error) {
    console.error("[omie-allowlist] rpc failed:", error);
    return false;
  }
  return data === true;
}

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
  const { login, loginManaged, loginIdentity, isLoading } = useSap();
  const navigate = useNavigate();
  const { enabledNames, isLoading: erpLoading } = useEnabledErpTypes();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [companyDB, setCompanyDB] = useState("");
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [managedCompanyDbs, setManagedCompanyDbs] = useState<Set<string>>(new Set());
  const [cloudEmail, setCloudEmail] = useState<string | null>(null);
  // Erro de autenticação classificado + validação por campo (inline, não só toast).
  const [loginError, setLoginError] = useState<ErpLoginErrorInfo | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<{ companyDB?: string; userName?: string; password?: string }>({});


  // Filter only when we know which ERPs are enabled; otherwise show all active companies
  // so a slow/failing enabled_erp_types query never blocks the login list.
  const databases = erpLoading || enabledNames.length === 0
    ? allCompanies
    : allCompanies.filter((d) => enabledNames.includes(d.erp_type));

  const selectedCompany = databases.find((d) => d.value === companyDB);
  const erpType = selectedCompany?.erp_type || "sap";
  const isOmie = erpType === "omie";
  const isManagedSap = erpType === "sap" && !!cloudEmail && managedCompanyDbs.has(companyDB);
  // Com a identidade do Google validada, o SAP B1 nunca pede usuário/senha na
  // tela de login: a autenticação no Service Layer é adiada para o momento da
  // ação (login invisível com senha provisionada ou modal sob demanda).
  const needsCredentials = erpType === "sap" && !cloudEmail;

  const isStateless = (erpType === "omie" || erpType.startsWith("s4hana") || erpType.startsWith("totvs") || erpType === "netsuite");
  const [googleLoading, setGoogleLoading] = useState(false);
  const postRedirectHandledRef = useRef(false);
  // Contador de tentativas com credenciais inválidas por (empresa|usuário).
  // Após 2 falhas consecutivas exibimos aviso de que a próxima trava o usuário
  // no SAP B1 (política padrão bloqueia após 3 tentativas).
  const failedAttemptsRef = useRef<Map<string, number>>(new Map());
  const attemptKey = (db: string, user: string) => `${db}::${user.trim().toLowerCase()}`;
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
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const canSeeTest = await resolveTestCompanyVisibility({
        identifier: authSession?.user?.email || null,
      });
      setAllCompanies(
        (data || [])
          .filter((c: any) => canSeeTest || !isTestCompanyDb(c.company_db))
          .map((c: any) => ({
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

  // Detect Cloud (Supabase Auth) session and load managed SAP credentials for
  // this user so we can hide user/password fields whenever the selected
  // company has a stored ERP-Flow-managed password.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const email = authSession?.user?.email || null;
        if (cancelled) return;
        setCloudEmail(email);
        if (!authSession) {
          setManagedCompanyDbs(new Set());
          return;
        }
        const { listUserSapCredentials } = await import("@/lib/user-sap-credentials");
        const creds = await listUserSapCredentials();
        if (cancelled) return;
        setManagedCompanyDbs(new Set(creds.map((c) => c.company_db)));
      } catch {
        if (!cancelled) setManagedCompanyDbs(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Post Google redirect: if there's a pending OMIE company + a Supabase session,
  // verify access via user_group_assignments and complete the ERP login.
  useEffect(() => {
    if (postRedirectHandledRef.current) return;
    const pending = sessionStorage.getItem(OMIE_PENDING_KEY);
    if (!pending) return;
    postRedirectHandledRef.current = true;

    (async () => {
      setGoogleLoading(true);
      try {
        // Wait briefly for the Lovable auth wrapper to hydrate the session after redirect.
        let authSession = (await supabase.auth.getSession()).data.session;
        for (let i = 0; !authSession && i < 20; i++) {
          await new Promise((r) => setTimeout(r, 150));
          authSession = (await supabase.auth.getSession()).data.session;
        }
        const email = authSession?.user?.email || "";
        if (!email) {
          toast.error("Não foi possível obter o e-mail do Google");
          sessionStorage.removeItem(OMIE_PENDING_KEY);
          return;
        }

        const allowed = await isEmailAllowedForOmieCompany(email, pending);
        if (!allowed) {
          toast.error("Acesso não liberado", {
            description: `Sua conta ${email} não está autorizada para esta empresa OMIE. Contate o administrador.`,
          });
          try { await supabase.auth.signOut(); } catch { /* ignore */ }
          sessionStorage.removeItem(OMIE_PENDING_KEY);
          return;
        }

        // Record the Google identity so it counts as a linked IdP user.
        await upsertGoogleIdpMapping({
          email,
          displayName: (authSession?.user?.user_metadata?.full_name as string | undefined) || email,
          idpUserId: authSession?.user?.id || email,
        });

        // Enforce IdP binding flag (admins bypass via has_role check on server).
        const gate = await assertIdpBinding(email);
        if (!gate.ok) {
          toast.error("Vínculo de identidade obrigatório", { description: gate.reason });
          try { await supabase.auth.signOut(); } catch { /* ignore */ }
          sessionStorage.removeItem(OMIE_PENDING_KEY);
          return;
        }

        await login(email, "", pending, "omie");
        sessionStorage.removeItem(OMIE_PENDING_KEY);
        toast.success("Conectado ao OMIE!");

      } catch (err) {
        toast.error("Falha ao completar login OMIE", {
          description: err instanceof Error ? err.message : String(err),
        });
        sessionStorage.removeItem(OMIE_PENDING_KEY);
      } finally {
        setGoogleLoading(false);
      }
    })();
  }, [login]);

  const handleOmieGoogle = async () => {
    if (!companyDB) {
      toast.error("Selecione a empresa");
      return;
    }
    try {
      setGoogleLoading(true);

      // Reuse existing Google session (from the gate) when available.
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (existing?.user?.email) {
        const email = existing.user.email;
        const allowed = await isEmailAllowedForOmieCompany(email, companyDB);
        if (!allowed) {
          toast.error("Acesso não liberado", {
            description: `Sua conta ${email} não está autorizada para esta empresa OMIE. Contate o administrador.`,
          });
          setGoogleLoading(false);
          return;
        }
        await upsertGoogleIdpMapping({
          email,
          displayName: (existing.user.user_metadata?.full_name as string | undefined) || email,
          idpUserId: existing.user.id || email,
        });
        const gate = await assertIdpBinding(email);
        if (!gate.ok) {
          toast.error("Vínculo de identidade obrigatório", { description: gate.reason });
          setGoogleLoading(false);
          return;
        }
        await login(email, "", companyDB, "omie");
        toast.success("Conectado ao OMIE!");
        setGoogleLoading(false);
        return;
      }

      sessionStorage.setItem(OMIE_PENDING_KEY, companyDB);
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        sessionStorage.removeItem(OMIE_PENDING_KEY);
        toast.error("Falha no login com Google", {
          description: result.error instanceof Error ? result.error.message : String(result.error),
        });
        setGoogleLoading(false);
      }
      // If redirected: browser will navigate away; effect above completes the flow on return.
    } catch (err) {
      sessionStorage.removeItem(OMIE_PENDING_KEY);
      setGoogleLoading(false);
      toast.error("Falha no login com Google", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setFieldErrors({});
    if (!companyDB) {
      setFieldErrors({ companyDB: "Selecione a empresa para continuar." });
      toast.error("Selecione a empresa");
      return;
    }
    // SAP B1: a identidade já foi validada pelo Google. Entramos direto na
    // empresa, sem abrir sessão no Service Layer — ela é criada sob demanda,
    // apenas quando alguma ação precisar (invisível se houver senha
    // provisionada; senão, o modal de credenciais aparece na hora da ação).
    if (erpType === "sap" && cloudEmail) {
      try {
        await loginIdentity(companyDB, "sap");

        toast.success(`Conectado ao ${erpInfo.label}!`);
      } catch (err) {
        const info = classifyErpLoginError(err);
        setLoginError(info);
        toast.error(info.title, { description: info.description });
      }
      return;
    }
    if (needsCredentials && (!userName.trim() || !password)) {
      setFieldErrors({
        userName: !userName.trim() ? "Informe o usuário do ERP." : undefined,
        password: !password ? "Informe a senha do ERP." : undefined,
      });
      return;
    }

    try {
      // SAP B1 usernames are typically the local-part only (e.g. "marco.tulio"),
      // not the full email. Strip the domain automatically so users can type either.
      const sapUser = needsCredentials && userName.includes("@")
        ? userName.split("@")[0].trim()
        : userName.trim();
      await login(sapUser, password, companyDB, erpType as ErpType);

      // Backoffice admin? Record a `local` bypass so it becomes auditable in idp_user_mapping.
      // Best-effort — never blocks the login.
      try {
        const { data: isAdmin } = await supabase.rpc("is_sap_user_admin", { _sap_username: sapUser });
        if (isAdmin) {
          await upsertLocalAdminMapping({ sapUserCode: sapUser });
        }
      } catch { /* noop */ }

      // Enforce IdP binding flag (checks by SAP user code and, when available, by email).
      if (erpType === "sap") {
        const gate = await assertSapLoginIdpBinding({ sapUserCode: sapUser });
        if (!gate.ok) {
          toast.error("Vínculo de identidade obrigatório", { description: gate.reason });
          // Não encerrar a sessão Google aqui: isso derruba o gate de acesso e
          // devolve o usuário ao "Entrar com Google" em loop. Basta limpar o ERP.
          try { sessionStorage.removeItem("erp_session_v1"); } catch { /* ignore */ }
          window.dispatchEvent(new CustomEvent("erp:session-expired"));
          return;
        }

      }

      // Alerta sempre que o usuário logar com a senha padrão, em qualquer empresa.
      if (password === "Sap@2025") {
        try { sessionStorage.setItem("erp:default-password-warning", "1"); } catch { /* noop */ }
      }
      failedAttemptsRef.current.delete(attemptKey(companyDB, userName));
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
        const key = attemptKey(companyDB, userName);
        const prev = failedAttemptsRef.current.get(key) || 0;
        const next = prev + 1;
        failedAttemptsRef.current.set(key, next);
        if (next >= 2) {
          toast.error("Usuário ou senha incorretos", {
            description:
              "Atenção: mais uma tentativa incorreta irá bloquear o usuário no SAP. Se não lembrar a senha, contate o administrador para redefinir.",
            duration: 8000,
          });
        } else {
          toast.error("Usuário ou senha incorretos", {
            description: "Verifique suas credenciais e tente novamente.",
          });
        }
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

          {/* SAP por identidade — sessão do Service Layer criada sob demanda */}
          {erpType === "sap" && !!cloudEmail && companyDB && (
            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-primary/5 border border-primary/30 space-y-1">
              <div className="text-sm font-medium text-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" /> Entrada pela sua identidade Google
              </div>
              <div>
                Autenticado como <span className="font-medium text-foreground">{cloudEmail}</span>.{" "}
                {isManagedSap
                  ? "A conexão com o ERP é feita automaticamente quando alguma ação precisar."
                  : "Suas credenciais do ERP só serão pedidas se você executar uma ação que dependa dele."}
              </div>
            </div>
          )}


          {/* Stateless ERP info */}
          {isStateless && companyDB && !isOmie && (
            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/20 border border-border">
              O login será feito automaticamente usando as credenciais do {erpInfo.label} configuradas para esta empresa.
            </div>
          )}

          {isOmie && companyDB && (
            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/20 border border-border">
              Empresas OMIE utilizam login via Google. Seu acesso é validado pelo mapeamento configurado no Backoffice.
            </div>
          )}

          {isOmie ? (
            <Button
              type="button"
              className="w-full"
              onClick={handleOmieGoogle}
              disabled={googleLoading || isLoading || !companyDB}
            >
              {googleLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.6 14.7 2.6 12 2.6 6.9 2.6 2.8 6.7 2.8 11.9S6.9 21.4 12 21.4c6.9 0 9.3-4.8 9.3-8.6 0-.6-.1-1.1-.2-1.6H12z"/>
                </svg>
              )}
              {googleLoading ? "Conectando..." : "Entrar com Google"}
            </Button>
          ) : (
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <LogIn className="w-4 h-4 mr-2" />
              )}
              {isLoading ? "Conectando..." : "Entrar"}
            </Button>
          )}
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
