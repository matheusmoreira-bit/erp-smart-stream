import { useCallback, useEffect, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import {
  getStandaloneMode,
  invalidateStandaloneModes,
  loadStandaloneModes,
  subscribeStandaloneModes,
  type StandaloneMode,
} from "@/lib/standalone-mode";

const POLL_MS = 60_000;

/** Modo standalone da empresa ativa (ou de uma empresa informada). */
export function useStandaloneMode(companyDbOverride?: string | null) {
  const { session } = useSap();
  const companyDb = companyDbOverride ?? session?.companyDB ?? null;
  const [mode, setMode] = useState<StandaloneMode | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const row = await getStandaloneMode(companyDb);
    setMode(row);
    setLoading(false);
  }, [companyDb]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await loadStandaloneModes();
      if (!cancelled) await refresh();
    };
    void run();
    const timer = window.setInterval(() => {
      invalidateStandaloneModes();
    }, POLL_MS);
    const unsubscribe = subscribeStandaloneModes(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [refresh]);

  return { mode, isStandalone: !!mode, loading, refresh };
}
