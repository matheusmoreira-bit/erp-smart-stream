import { useCallback, useEffect } from "react";
import { useExpenses } from "@/hooks/useExpenses";
import { useOfflineOutbox } from "@/hooks/useOfflineOutbox";
import { useSap } from "@/contexts/SapContext";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import {
  assertCircuitClosed,
  getCircuitState,
  recordCircuitFailure,
  recordCircuitSuccess,
  SapCircuitOpenError,
} from "@/lib/sap-circuit-breaker";

/** Mantém o remetente da outbox ativo mesmo fora da tela de Compras. */
export function OfflineResilienceAgent() {
  const { session } = useSap();
  useExpenses("purchase", { enabled: false });
  useOfflineOutbox();

  const probe = useCallback(async () => {
    if (session?.erpType !== "sap" || !session.companyDB) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const circuit = getCircuitState(session.companyDB);
    if (circuit.state === "closed" || circuit.retryAfterMs > 0) return;

    try {
      assertCircuitClosed(session.companyDB);
      const response = await sapFunctionFetch("sap-list-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_db: session.companyDB,
          endpoint: "Users",
          params: { $select: "UserCode", $top: 1 },
          page_size: 20,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.code === "sap_unavailable" || data?.code === "no_apiuser") {
        throw new Error(data?.warning || data?.error || `HTTP ${response.status}`);
      }
      recordCircuitSuccess(session.companyDB);
    } catch (error) {
      if (error instanceof SapCircuitOpenError) return;
      recordCircuitFailure(
        session.companyDB,
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [session?.erpType, session?.companyDB]);

  useEffect(() => {
    const timer = window.setInterval(() => { void probe(); }, 30_000);
    const onOnline = () => { void probe(); };
    window.addEventListener("online", onOnline);
    void probe();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [probe]);

  return null;
}
