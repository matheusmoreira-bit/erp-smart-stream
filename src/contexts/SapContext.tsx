import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapLogin, sapLogout, type SapSession, clearClientCache } from "@/lib/sap-client";

export type ErpType = "sap" | "omie" | "s4hana_cloud" | "s4hana_cloud_private" | "s4hana_onprem" | "totvs_protheus" | "totvs_rm" | "totvs_datasul" | "netsuite";

export interface ErpSession {
  erpType: ErpType;
  companyDB: string;
  userName: string;
  // SAP-specific
  sessionId?: string;
  routeId?: string;
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
      if (erpType === "sap") {
        const sapSess = await sapLogin(userName, password, companyDB);
        setSession({
          erpType: "sap",
          companyDB,
          userName,
          sessionId: sapSess.sessionId,
          routeId: sapSess.routeId,
          isSuperUser: sapSess.isSuperUser,
          expiresAt: sapSess.expiresAt ?? Date.now() + 30 * 60 * 1000,
        });
      } else if (erpType === "omie") {
        // OMIE login — validate credentials via edge function (requires Lovable Cloud auth)
        const { authFetch } = await import("@/lib/auth-fetch");
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

  const logout = useCallback(async () => {
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
  }, [session]);

  // Listen for SAP Service Layer session-expired events emitted by sap-client.
  // Don't try to silently relogin with cached credentials — clear state so the
  // user is sent back to the login screen.
  useEffect(() => {
    const handler = () => {
      clearClientCache();
      setSession(null);
      setError("Sua sessão expirou. Faça login novamente.");
    };
    window.addEventListener("erp:session-expired", handler);
    return () => window.removeEventListener("erp:session-expired", handler);
  }, [setSession]);

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

  return (
    <ErpContext.Provider value={{ session, isLoading, error, login, logout }}>
      {children}
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
    logout: ctx.logout,
  };
}

export function useErp() {
  const ctx = useContext(ErpContext);
  if (!ctx) throw new Error("useErp must be used within SapProvider");
  return ctx;
}
