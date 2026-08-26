// Feed da tela de Aprovações: UMA chamada ao servidor + pintura instantânea.
//
// Estratégia (stale-while-revalidate):
//   1. No mount, o estado é hidratado do cache local (sessionStorage) — a lista
//      aparece imediatamente, sem esperar rede.
//   2. Em paralelo, revalida no servidor via `approvals-feed`.
//
// Isso substitui os dois `useExpenses` (compras + vendas) e o download da
// matriz de regras inteira que a tela fazia no carregamento.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import type { Expense } from "@/hooks/useExpenses";
import type { ApprovalTrackSegment } from "@/hooks/useApprovals";

export interface ApprovalFeedDoc extends Expense {
  doc_type?: "purchase" | "sales";
  /** Aprovadores do nível atual da regra (resolvidos no servidor). */
  level_approvers?: Array<{ name: string; email: string }>;
  approval_segments?: ApprovalTrackSegment[];
  viewer_segment_keys?: string[];
  viewer_segmented?: boolean;
  restricted_segment_count?: number;
  restricted_item_count?: number;
}

interface FeedState {
  docs: ApprovalFeedDoc[];
  privileged: boolean;
  generatedAt: string | null;
}

const EMPTY: FeedState = { docs: [], privileged: false, generatedAt: null };

function cacheKey(companyDb: string, user: string) {
  // v2 invalida snapshots anteriores ao recorte server-side por ramificação.
  return `approvals-feed:v2:${companyDb}:${user}`;
}

function readCache(key: string): FeedState | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeedState;
    return Array.isArray(parsed?.docs) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: FeedState) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — cache é apenas otimização */
  }
}

export function useApprovalsFeed() {
  const { session } = useSap();
  const companyDb = session?.companyDB || "";
  const userKey = (session?.userName || "").toLowerCase();
  const key = companyDb ? cacheKey(companyDb, userKey) : "";

  const [state, setState] = useState<FeedState>(() => (key && readCache(key)) || EMPTY);
  // Só mostra "carregando" quando não há nada em cache para pintar.
  const [isLoading, setIsLoading] = useState<boolean>(() => !(key && readCache(key)));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  // Snapshot do estado atual para decidir se uma resposta menor deve ser aceita.
  const stateRef = useRef<FeedState>(state);
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!companyDb) {
      setState(EMPTY);
      setIsLoading(false);
      return;
    }
    if (inFlight.current) return inFlight.current;

    const fetchOnce = async (): Promise<FeedState & { degraded: boolean }> => {
      const res = await sapFunctionFetch("approvals-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_db: companyDb }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `approvals-feed ${res.status}`);
      return {
        docs: (body?.docs || []) as ApprovalFeedDoc[],
        privileged: Boolean(body?.privileged),
        degraded: Boolean(body?.degraded),
        generatedAt: body?.generated_at || new Date().toISOString(),
      };
    };

    const run = (async () => {
      setIsRefreshing(true);
      setError(null);
      try {
        let result = await fetchOnce();

        // A fila do aprovador nunca pode ser esvaziada por uma resposta
        // incompleta: se o servidor sinalizou permissões degradadas, ou se a
        // lista veio vazia depois de ter documentos, confirmamos com uma
        // segunda leitura antes de aceitar o resultado menor.
        const hadDocs = stateRef.current.docs.length > 0;
        if (result.degraded || (hadDocs && result.docs.length === 0)) {
          await new Promise((r) => setTimeout(r, 1200));
          const confirm = await fetchOnce().catch(() => null);
          // Continua degradado/indisponível: mantém o que já está em tela.
          if (!confirm || confirm.degraded) return;
          result = confirm;
        }

        const next: FeedState = {
          docs: result.docs,
          privileged: result.privileged,
          generatedAt: result.generatedAt,
        };
        setState(next);
        if (key) writeCache(key, next);

      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar aprovações");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [companyDb, key]);


  // Troca de empresa: repinta do cache daquela empresa antes de revalidar.
  useEffect(() => {
    const cached = key ? readCache(key) : null;
    if (cached) {
      setState(cached);
      setIsLoading(false);
    } else {
      setState(EMPTY);
      setIsLoading(Boolean(companyDb));
    }
    void load();
  }, [key, companyDb, load]);

  /** Remove um documento da lista sem esperar o servidor (ação otimista). */
  const removeLocal = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = { ...prev, docs: prev.docs.filter((d) => d.id !== id) };
        if (key) writeCache(key, next);
        return next;
      });
    },
    [key],
  );

  return {
    docs: state.docs,
    privileged: state.privileged,
    generatedAt: state.generatedAt,
    isLoading,
    isRefreshing,
    error,
    refresh: load,
    removeLocal,
  };
}
