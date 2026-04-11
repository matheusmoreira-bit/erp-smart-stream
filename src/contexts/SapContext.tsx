import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
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
  // OMIE-specific (stateless — uses app_key/app_secret stored in system_credentials)
}

interface ErpContextType {
  session: ErpSession | null;
  isLoading: boolean;
  error: string | null;
  login: (userName: string, password: string, companyDB: string, erpType?: ErpType) => Promise<void>;
  logout: () => Promise<void>;
}

const ErpContext = createContext<ErpContextType | null>(null);

export function SapProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ErpSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        });
      } else if (erpType === "omie") {
        // OMIE login — validate credentials via edge function
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(`${supabaseUrl}/functions/v1/omie-proxy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ action: "login", company_db: companyDB }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);

        setSession({
          erpType: "omie",
          companyDB,
          userName: userName || "omie",
        });
      } else if (erpType.startsWith("s4hana") || erpType.startsWith("totvs") || erpType === "netsuite") {
        // S/4HANA & TOTVS — stateless, credentials stored in system_credentials
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(`${supabaseUrl}/functions/v1/credentials?system=${erpType}&company_db=${companyDB}`, {
          headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
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

  return (
    <ErpContext.Provider value={{ session, isLoading, error, login, logout }}>
      {children}
    </ErpContext.Provider>
  );
}

export function useSap() {
  const ctx = useContext(ErpContext);
  if (!ctx) throw new Error("useSap must be used within SapProvider");
  // Return backward-compatible interface
  // session always exposes companyDB/userName for auth guards and display
  // SAP-specific fields (sessionId, routeId) are present only for SAP sessions
  const session: SapSession | null = ctx.session
    ? ctx.session.erpType === "sap" && ctx.session.sessionId
      ? {
          sessionId: ctx.session.sessionId,
          routeId: ctx.session.routeId || "",
          companyDB: ctx.session.companyDB,
          userName: ctx.session.userName,
          isSuperUser: ctx.session.isSuperUser || false,
          erpType: "sap",
        }
      : {
          sessionId: `__${ctx.session.erpType}__`,
          routeId: "",
          companyDB: ctx.session.companyDB,
          userName: ctx.session.userName,
          isSuperUser: false,
          erpType: ctx.session.erpType,
        }
    : null;

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
