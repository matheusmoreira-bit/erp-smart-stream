import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapLogin, sapLogout, ensureSapAuthToken, sapKeepAlive, type SapSession, clearClientCache } from "@/lib/sap-client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { clearErpLocalState } from "@/lib/clear-erp-local-state";
import { registerSapSessionResolver, type ResolvedSapSession } from "@/lib/sap-session-broker";
import { SapCredentialsDialog } from "@/components/SapCredentialsDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ErpType = "sap" | "omie" | "s4hana_cloud" | "s4hana_cloud_private" | "s4hana_onprem" | "totvs_protheus" | "totvs_rm" | "totvs_datasul" | "netsuite";

export interface ErpSession {
  erpType: ErpType;
  companyDB: string;
  userName: string;
  // SAP-specific
  sessionId?: string;
  routeId?: string;
  sapAuthToken?: string;
  isSuperUser?: boolean;
  // Expiry timestamp (ms epoch). User session is capped at 30min
  // to mirror SAP Service Layer's SessionTimeout. After that, any
  // user-scoped request must re-authenticate via the login screen.
  expiresAt?: number;
  // OMIE-specific (stateless — uses app_key/app_secret stored in system_credentials)
}

interface ErpContextType {
  session: ErpSession | null;
  isLoading: boolean;
  error: string | null;
  login: (userName: string, password: string, companyDB: string, erpType?: ErpType) => Promise<void>;
  loginManaged: (companyDB: string) => Promise<void>;
  /**
   * Entra na empresa apenas com a identidade já autenticada (Google/Cloud),
   * sem abrir sessão no Service Layer. A sessão do ERP é criada sob demanda,
   * no momento em que alguma ação precisar dela.
   */
  loginIdentity: (companyDB: string, erpType?: ErpType) => Promise<void>;
  logout: () => Promise<void>;
}

const ErpContext = createContext<ErpContextType | null>(null); // stable ref


const ERP_SESSION_STORAGE_KEY = "erp_session_v1";

function loadStoredSession(): ErpSession | null {
  try {
    const raw = sessionStorage.getItem(ERP_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ErpSession;
    // Drop expired sessions on load so user is forced through the login screen.
    if (parsed?.expiresAt && Date.now() >= parsed.expiresAt) {
      sessionStorage.removeItem(ERP_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistSession(session: ErpSession | null) {
  try {
    if (session) {
      sessionStorage.setItem(ERP_SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(ERP_SESSION_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function SapProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<ErpSession | null>(() => loadStoredSession());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const setSession = useCallback((next: ErpSession | null | ((prev: ErpSession | null) => ErpSession | null)) => {
    setSessionState((prev) => {
      const resolved = typeof next === "function" ? (next as (p: ErpSession | null) => ErpSession | null)(prev) : next;
      persistSession(resolved);
      return resolved;
    });
  }, []);


  const login = useCallback(async (userName: string, password: string, companyDB: string, erpType: ErpType = "sap") => {
    setIsLoading(true);
    setError(null);
    try {
      // Se sobrou uma sessão Supabase Auth de um login LOCAL (email/senha) de outro
      // usuário, encerra antes de prosseguir para não herdar isAdmin/roles.
      // IMPORTANTE: nunca encerrar uma sessão Google — ela é o gate de acesso ao app.
      // O usuário SAP pode legitimamente diferir do e-mail Google (aliases, .ext,
      // nome civil vs. usuário SAP); deslogar aqui causava loop entre o formulário
      // de login e o "Entrar com Google".
      try {
        const { data: { session: prev } } = await supabase.auth.getSession();
        const provider = (prev?.user?.app_metadata?.provider || "").toLowerCase();
        const isOAuth = provider && provider !== "email";
        const prevLocal = (prev?.user?.email || "").split("@")[0].trim().toLowerCase();
        const newLocal = (userName || "").split("@")[0].trim().toLowerCase();
        if (prev && !isOAuth && prevLocal && newLocal && prevLocal !== newLocal) {
          await supabase.auth.signOut();
        }
      } catch { /* ignore */ }

      if (erpType === "sap") {
        const sapSess = await sapLogin(userName, password, companyDB);
        setSession({
          erpType: "sap",
          companyDB,
          userName,
          sessionId: sapSess.sessionId,
          routeId: sapSess.routeId,
          sapAuthToken: sapSess.sapAuthToken,
          isSuperUser: sapSess.isSuperUser,
          expiresAt: sapSess.expiresAt ?? Date.now() + 30 * 60 * 1000,
        });
      } else if (erpType === "omie") {
        // OMIE login — validate credentials via edge function (requires Lovable Cloud auth)
        const { publicFunctionFetch } = await import("@/lib/auth-fetch");
        const res = await publicFunctionFetch("omie-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "login", company_db: companyDB }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);

        setSession({
          erpType: "omie",
          companyDB,
          userName: userName || "omie",
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
      } else if (erpType.startsWith("s4hana") || erpType.startsWith("totvs") || erpType === "netsuite") {
        // S/4HANA & TOTVS — stateless, credentials stored in system_credentials
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const { data: { session: authSession2 } } = await supabase.auth.getSession();
        const authToken2 = authSession2?.access_token || anonKey;
        const res = await fetch(`${supabaseUrl}/functions/v1/credentials?system=${erpType}&company_db=${companyDB}`, {
          headers: { Authorization: `Bearer ${authToken2}`, apikey: anonKey },
        });
        const erpLabel = erpType.startsWith("s4hana") ? "S/4HANA" : "TOTVS";
        if (!res.ok) throw new Error(`Credenciais ${erpLabel} não configuradas para esta empresa`);
        const credsData = await res.json();
        if (!credsData.credentials || credsData.credentials.length === 0) {
          throw new Error(`Credenciais ${erpLabel} não encontradas. Configure na tela de Credenciais.`);
        }

        setSession({
          erpType,
          companyDB,
          userName: userName || erpType,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
      }

      // Audit login
      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({
        action: `${erpType}_login`,
        entity_type: "erp_session",
        actor_email: userName,
        company_db: companyDB,
        details: { companyDB, erpType },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao conectar");
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginManaged = useCallback(async (companyDB: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { sapAutoLogin } = await import("@/lib/user-sap-credentials");
      const result = await sapAutoLogin(companyDB);
      const timeoutMin = Math.min(Math.max(result.sessionTimeout || 30, 1), 30);
      setSession({
        erpType: "sap",
        companyDB: result.companyDB,
        userName: result.sapUser,
        sessionId: result.sessionId,
        routeId: result.routeId,
        expiresAt: Date.now() + timeoutMin * 60 * 1000,
      });
      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({
        action: "sap_managed_login",
        entity_type: "erp_session",
        actor_email: result.sapUser,
        company_db: companyDB,
        details: { companyDB },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao conectar");
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [setSession]);


  // ------------------------------------------------------------------
  // Login "por identidade": entra na empresa sem abrir sessão no Service
  // Layer. A identidade já foi validada pelo Google (Lovable Cloud).
  // ------------------------------------------------------------------
  const loginIdentity = useCallback(async (companyDB: string, erpType: ErpType = "sap") => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const email = authSession?.user?.email || "";
      if (!email) throw new Error("Sessão de identidade não encontrada. Entre com sua conta Google.");

      // Nome de usuário no ERP: usa o mapeamento provisionado quando existir.
      let sapUser = email.split("@")[0].toLowerCase();
      try {
        const { listUserSapCredentials } = await import("@/lib/user-sap-credentials");
        const creds = await listUserSapCredentials(companyDB);
        const match = creds.find((c) => c.company_db === companyDB);
        if (match?.sap_user) sapUser = match.sap_user;
      } catch { /* mantém o fallback pelo e-mail */ }

      setSession({
        erpType,
        companyDB,
        userName: sapUser,
        // sem sessionId: será criado sob demanda pela primeira ação no ERP
      });

      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({
        action: "erp_identity_login",
        entity_type: "erp_session",
        actor_email: email,
        company_db: companyDB,
        details: { companyDB, erpType, sapUser },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao entrar na empresa");
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [setSession]);

  // ------------------------------------------------------------------
  // Broker: cria a sessão do Service Layer somente quando uma ação precisa.
  // ------------------------------------------------------------------
  const sessionRef = useRef<ErpSession | null>(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const [credPrompt, setCredPrompt] = useState<{ companyDB: string; defaultUser: string } | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const credResolveRef = useRef<((s: ResolvedSapSession | null) => void) | null>(null);

  const resolveSapSessionForAction = useCallback(async (companyDB: string): Promise<ResolvedSapSession | null> => {
    const current = sessionRef.current;
    const db = companyDB || current?.companyDB || "";
    if (!db) return null;

    // 1) Sessão viva reutilizável.
    if (
      current?.erpType === "sap" &&
      current.sessionId &&
      current.companyDB === db &&
      (!current.expiresAt || Date.now() < current.expiresAt)
    ) {
      return {
        sessionId: current.sessionId,
        routeId: current.routeId || "",
        companyDB: db,
        userName: current.userName,
        isSuperUser: current.isSuperUser,
      };
    }

    // 2) Senha provisionada → login invisível.
    try {
      const { sapAutoLogin } = await import("@/lib/user-sap-credentials");
      const result = await sapAutoLogin(db);
      const timeoutMin = Math.min(Math.max(result.sessionTimeout || 30, 1), 30);
      setSession((prev) => ({
        erpType: "sap",
        companyDB: db,
        userName: result.sapUser,
        sessionId: result.sessionId,
        routeId: result.routeId,
        isSuperUser: prev?.companyDB === db ? prev?.isSuperUser : undefined,
        expiresAt: Date.now() + timeoutMin * 60 * 1000,
      }));
      return {
        sessionId: result.sessionId,
        routeId: result.routeId || "",
        companyDB: db,
        userName: result.sapUser,
      };
    } catch {
      /* sem senha provisionada (ou credencial inválida) → pede ao usuário */
    }

    // 3) Modal de login da empresa.
    if (credResolveRef.current) credResolveRef.current(null);
    return await new Promise<ResolvedSapSession | null>((resolve) => {
      credResolveRef.current = resolve;
      setCredError(null);
      setCredPrompt({ companyDB: db, defaultUser: current?.userName || "" });
    });
  }, [setSession]);

  useEffect(() => {
    registerSapSessionResolver(resolveSapSessionForAction);
    return () => registerSapSessionResolver(null);
  }, [resolveSapSessionForAction]);

  const handleCredSubmit = useCallback(async (userName: string, password: string, remember: boolean) => {
    if (!credPrompt) return;
    setCredLoading(true);
    setCredError(null);
    try {
      const sapSess = await sapLogin(userName, password, credPrompt.companyDB);
      setSession({
        erpType: "sap",
        companyDB: credPrompt.companyDB,
        userName,
        sessionId: sapSess.sessionId,
        routeId: sapSess.routeId,
        sapAuthToken: sapSess.sapAuthToken,
        isSuperUser: sapSess.isSuperUser,
        expiresAt: sapSess.expiresAt ?? Date.now() + 30 * 60 * 1000,
      });
      if (remember) {
        try {
          const { saveUserSapCredential } = await import("@/lib/user-sap-credentials");
          await saveUserSapCredential(credPrompt.companyDB, userName, password);
        } catch { /* opcional — não bloqueia a ação */ }
      }
      credResolveRef.current?.({
        sessionId: sapSess.sessionId,
        routeId: sapSess.routeId || "",
        companyDB: credPrompt.companyDB,
        userName,
        isSuperUser: sapSess.isSuperUser,
      });
      credResolveRef.current = null;
      setCredPrompt(null);
    } catch (e) {
      setCredError(e instanceof Error ? e.message : "Falha ao autenticar no ERP");
    } finally {
      setCredLoading(false);
    }
  }, [credPrompt, setSession]);

  const handleCredCancel = useCallback(() => {
    credResolveRef.current?.(null);
    credResolveRef.current = null;
    setCredPrompt(null);
    setCredError(null);
  }, []);



  const performLogout = useCallback(async () => {
    if (session?.erpType === "sap" && session.sessionId) {
      await sapLogout({
        sessionId: session.sessionId,
        routeId: session.routeId || "",
        companyDB: session.companyDB,
        userName: session.userName,
        isSuperUser: session.isSuperUser || false,
      });
    }
    clearClientCache();
    setSession(null);
    setError(null);
    setIsLoading(false);
    // Zera o cache do React Query e todo o estado local persistido para que um
    // reload em "/" não reaproveite dados do usuário/empresa anterior.
    try { queryClient.clear(); } catch { /* ignore */ }
    clearErpLocalState();
    // A sessão do Google (Lovable Cloud) NÃO é encerrada aqui: o "Sair" apenas
    // desconecta da empresa/ERP. A identidade Google segue válida por até 24h
    // (limite aplicado no GoogleAuthGate). Ao logar em outra empresa com outro
    // usuário SAP, `login()` já derruba a sessão Supabase anterior.
    toast.success("Empresa desconectada", {
      description: "Você saiu da empresa. Sua conta Google continua conectada.",
    });
    // Volta para a raiz e força reload para garantir a tela de login limpa.
    window.setTimeout(() => window.location.replace("/"), 900);

  }, [session, queryClient, setSession]);

  // `logout` agora apenas solicita a confirmação — o encerramento real
  // acontece no diálogo renderizado pelo provider.
  const logout = useCallback(async () => {
    setConfirmLogoutOpen(true);
  }, []);


  // Listen for SAP Service Layer session-expired events emitted by sap-client.
  // Don't try to silently relogin with cached credentials — clear state so the
  // user is sent back to the login screen.
  useEffect(() => {
    const handler = () => {
      clearClientCache();
      setSession(null);
      try { queryClient.clear(); } catch { /* ignore */ }
      clearErpLocalState();
      setError("Sua sessão com o ERP expirou. Faça login na empresa novamente.");
      // A sessão Google permanece — o usuário só precisa reconectar à empresa.

    };
    window.addEventListener("erp:session-expired", handler);
    return () => window.removeEventListener("erp:session-expired", handler);
  }, [setSession, queryClient]);

  // Circuit breaker por empresa: avisa o usuário quando uma base entra em
  // cooldown (e quando volta), sem derrubar a sessão nem outras rotinas.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { companyDB?: string; state?: string; retryAfterMs?: number }
        | undefined;
      if (!detail) return;
      if (detail.state === "open") {
        const mins = Math.max(1, Math.round((detail.retryAfterMs || 0) / 60000));
        toast.warning(
          `Base ${detail.companyDB} indisponível. Pausando chamadas por ~${mins} min para não afetar as demais rotinas.`,
        );
      } else if (detail.state === "closed") {
        toast.success(`Base ${detail.companyDB} voltou a responder.`);
      }
    };
    window.addEventListener("erp:circuit-breaker", handler);
    return () => window.removeEventListener("erp:circuit-breaker", handler);
  }, []);


  // Hard cap: any user session expires after at most 30 minutes (matching SAP
  // Service Layer's SessionTimeout). Once that window elapses, dispatch the
  // expiry event so the user is returned to the login screen. After login the
  // SessionID issued by /Login is reused for every subsequent user-scoped
  // request — service-account requests use the Apiuser flow on the server.
  useEffect(() => {
    const exp = session?.expiresAt;
    if (!exp) return;
    const ms = exp - Date.now();
    if (ms <= 0) {
      window.dispatchEvent(new CustomEvent("erp:session-expired"));
      return;
    }
    const t = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("erp:session-expired"));
    }, ms);
    return () => window.clearTimeout(t);
  }, [session?.expiresAt]);

  // Keep-alive: enquanto houver sessão SAP ativa, faz um ping leve periódico no
  // Service Layer para impedir que o SessionTimeout derrube o usuário no meio
  // do trabalho. Cada ping bem-sucedido renova a janela de 30 min (rolling).
  useEffect(() => {
    if (session?.erpType !== "sap" || !session.sessionId) return;
    const snapshot = {
      sessionId: session.sessionId,
      routeId: session.routeId || "",
      companyDB: session.companyDB,
      userName: session.userName,
      isSuperUser: !!session.isSuperUser,
      erpType: "sap" as const,
    };

    let cancelled = false;
    const ping = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const alive = await sapKeepAlive(snapshot);
      if (cancelled) return;
      if (!alive) {
        window.dispatchEvent(new CustomEvent("erp:session-expired"));
        return;
      }
      setSession((prev) => (
        prev?.erpType === "sap" && prev.sessionId === snapshot.sessionId
          ? { ...prev, expiresAt: Date.now() + 30 * 60 * 1000 }
          : prev
      ));
    };

    // Ping a cada 5 minutos + ao voltar para a aba.
    const interval = window.setInterval(() => { void ping(); }, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void ping(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session?.erpType, session?.sessionId, session?.routeId, session?.companyDB, session?.userName, session?.isSuperUser, setSession]);


  useEffect(() => {
    if (session?.erpType !== "sap" || !session.sessionId || session.sapAuthToken) return;
    let cancelled = false;
    void ensureSapAuthToken({
      sessionId: session.sessionId,
      routeId: session.routeId || "",
      companyDB: session.companyDB,
      userName: session.userName,
      isSuperUser: !!session.isSuperUser,
      erpType: "sap",
      expiresAt: session.expiresAt,
    }).then((token) => {
      if (cancelled || !token) return;
      setSession((prev) => (
        prev?.erpType === "sap" && prev.sessionId === session.sessionId
          ? { ...prev, sapAuthToken: token }
          : prev
      ));
    });
    return () => { cancelled = true; };
  }, [session?.erpType, session?.sessionId, session?.sapAuthToken, session?.routeId, session?.companyDB, session?.userName, session?.isSuperUser, session?.expiresAt, setSession]);

  return (
    <ErpContext.Provider value={{ session, isLoading, error, login, loginManaged, logout }}>
      {children}
      <AlertDialog open={confirmLogoutOpen} onOpenChange={(open) => { if (!loggingOut) setConfirmLogoutOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair da empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              {session?.userName
                ? `Você será desconectado de ${session.userName} (${session.companyDB}). Sua conta Google continua conectada para escolher outra empresa.`
                : "Você será desconectado da empresa. Sua conta Google continua conectada."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loggingOut}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={loggingOut}
              onClick={async (e) => {
                e.preventDefault();
                setLoggingOut(true);
                try {
                  await performLogout();
                } catch {
                  setLoggingOut(false);
                  setConfirmLogoutOpen(false);
                  toast.error("Não foi possível encerrar a sessão. Tente novamente.");
                }
              }}
            >
              {loggingOut ? "Saindo…" : "Sair"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ErpContext.Provider>
  );
}

export function useSap() {
  const ctx = useContext(ErpContext);
  if (!ctx) throw new Error("useSap must be used within SapProvider");

  const session = useMemo<SapSession | null>(() => {
    if (!ctx.session) return null;

    if (ctx.session.erpType === "sap" && ctx.session.sessionId) {
      return {
        sessionId: ctx.session.sessionId,
        routeId: ctx.session.routeId || "",
        sapAuthToken: ctx.session.sapAuthToken,
        companyDB: ctx.session.companyDB,
        userName: ctx.session.userName,
        isSuperUser: ctx.session.isSuperUser || false,
        erpType: "sap",
        expiresAt: ctx.session.expiresAt,
      };
    }

    return {
      sessionId: `__${ctx.session.erpType}__`,
      routeId: "",
      companyDB: ctx.session.companyDB,
      userName: ctx.session.userName,
      isSuperUser: false,
      erpType: ctx.session.erpType,
    };
  }, [ctx.session]);

  return {
    session,
    erpSession: ctx.session,
    isLoading: ctx.isLoading,
    error: ctx.error,
    login: ctx.login,
    loginManaged: ctx.loginManaged,
    logout: ctx.logout,
  };
}

export function useErp() {
  const ctx = useContext(ErpContext);
  if (!ctx) throw new Error("useErp must be used within SapProvider");
  return ctx;
}
