import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { sapLogin, sapLogout, type SapSession, clearClientCache } from "@/lib/sap-client";

interface SapContextType {
  session: SapSession | null;
  isLoading: boolean;
  error: string | null;
  login: (userName: string, password: string, companyDB: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SapContext = createContext<SapContextType | null>(null);

export function SapProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SapSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (userName: string, password: string, companyDB: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const sess = await sapLogin(userName, password, companyDB);
      setSession(sess);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao conectar");
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (session) {
      await sapLogout(session);
    }
    clearClientCache();
    setSession(null);
  }, [session]);

  return (
    <SapContext.Provider value={{ session, isLoading, error, login, logout }}>
      {children}
    </SapContext.Provider>
  );
}

export function useSap() {
  const ctx = useContext(SapContext);
  if (!ctx) throw new Error("useSap must be used within SapProvider");
  return ctx;
}
