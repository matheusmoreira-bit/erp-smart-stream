import { useState, useCallback, useEffect } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView } from "@/lib/sap-client";

export interface Usr5Record {
  UserCode: string;
  Action: string;
  ActionBy: string;
  ClientIP: string;
  Date: string;
  Time: number;
  ClientName: string;
  ProcessID: number;
  SessionID: number;
  ReasonID: number;
  ReasonDesc: string;
  WinSessnID: number;
  WinUsrName: string;
  ProcName: string;
  AliveDurtn: number;
  LogoutTime: number;
  Source: string;
  UserID: number;
}

const ACTION_LABELS: Record<string, string> = {
  I: "Login",
  O: "Logout",
  W: "Login Web",
  F: "Falha de Login",
  C: "Mudança de Senha",
  U: "Desbloqueio",
  K: "Bloqueio",
};

const SOURCE_LABELS: Record<string, string> = {
  SBO_Client: "Desktop",
  SBO_Web_Client: "Web Client",
  SBO_DI_API: "Service Layer",
};

export function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source || "—";
}

export function isFailedLogin(record: Usr5Record): boolean {
  return record.SessionID < 0;
}

export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

const USR5_ROW_CAP = 20000;

/**
 * Atividade de login do SAP (USR5).
 * A view é enorme e o HanaAPI devolve as primeiras linhas (mais antigas) quando
 * nenhum filtro é enviado — por isso restringimos por data no servidor.
 */
export function useUserActivity(windowDays = 365) {
  const { session } = useSap();
  const [records, setRecords] = useState<Usr5Record[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (forceRefresh = false, signal?: AbortSignal) => {
    if (!session || session.erpType !== "sap") { setRecords([]); return; }
    setIsLoading(true);
    setError(null);
    try {
      const days = windowDays > 0 ? windowDays : 365;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      let result;
      try {
        result = await sapQueryView<Usr5Record>(
          session,
          "USR5",
          { Date__gte: cutoff, limit: USR5_ROW_CAP },
          !forceRefresh,
        );
      } catch {
        // Se o filtro por data não for suportado pela view, ao menos limitamos o volume.
        result = await sapQueryView<Usr5Record>(session, "USR5", { limit: USR5_ROW_CAP }, !forceRefresh);
      }
      if (signal?.aborted) return;
      setRecords(result.data);
    } catch (e) {
      if (signal?.aborted) return;
      console.error("Error fetching USR5:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar atividade");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [session]);

  const refresh = useCallback(() => fetch(true), [fetch]);

  useEffect(() => {
    const c = new AbortController();
    fetch(false, c.signal);
    return () => c.abort();
  }, [fetch]);

  return { records, isLoading, error, refresh };
}
