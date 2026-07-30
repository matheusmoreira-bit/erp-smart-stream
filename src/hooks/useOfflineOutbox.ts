import { useCallback, useEffect, useState } from "react";
import {
  flushOutbox,
  listOutbox,
  subscribeOutbox,
  type OutboxEntry,
} from "@/lib/offline-outbox";

/**
 * Estado reativo da fila offline + reenvio automático.
 * Dispara flush quando: a conexão volta, o circuit breaker fecha, a aba volta
 * ao foco, ou a cada 60s (rede de segurança).
 */
export function useOfflineOutbox() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [isFlushing, setIsFlushing] = useState(false);

  useEffect(() => subscribeOutbox(setEntries), []);

  const flush = useCallback(async (force = false) => {
    setIsFlushing(true);
    try {
      return await flushOutbox({ force });
    } finally {
      setIsFlushing(false);
      setEntries(await listOutbox());
    }
  }, []);

  useEffect(() => {
    const onOnline = () => void flush();
    const onCircuit = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { state?: string } | undefined;
      if (detail?.state === "closed") void flush();
    };
    const onFocus = () => void flush();
    const timer = window.setInterval(() => void flush(), 60_000);

    window.addEventListener("online", onOnline);
    window.addEventListener("erp:circuit-breaker", onCircuit as EventListener);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("erp:circuit-breaker", onCircuit as EventListener);
      window.removeEventListener("focus", onFocus);
    };
  }, [flush]);

  return {
    entries,
    pendingCount: entries.filter((e) => e.status !== "failed").length,
    failedCount: entries.filter((e) => e.status === "failed").length,
    isFlushing,
    flush,
  };
}
