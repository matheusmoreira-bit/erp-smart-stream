import { useEffect, useState, useCallback } from "react";

export interface PagCorpCardMappingRow {
  card_identifier: string | null;
  is_fallback: boolean;
  cost_center: string | null;
  project: string | null;
  item_code: string | null;
}

export interface PagCorpCardMappingResolved {
  costCenter: string | null;
  project: string | null;
  itemCode: string | null;
  /** Source: 'card' = mapping específico do cartão; 'fallback' = fallback da empresa; null = não há mapeamento */
  source: "card" | "fallback" | null;
}

export type CardMappingStatus = "none" | "partial" | "full";

export interface PagCorpCardMappingDescribed {
  resolved: PagCorpCardMappingResolved;
  /** none = nenhum mapeamento aplicável; partial = aplicado mas faltam campos; full = todos os 3 campos vieram */
  status: CardMappingStatus;
  /** Labels human-readable dos campos faltantes ('Centro de Custo' | 'Projeto' | 'Item') */
  missingFields: string[];
  cardKey: string | null;
}

/**
 * Carrega TODAS as linhas de pagcorp_card_mapping da empresa atual e expõe
 * uma função que resolve o mapeamento aplicável a uma transação (por
 * cardLastDigits/cardName). Resultados em cache local do hook (1 fetch por
 * mudança de empresa).
 */
export function usePagCorpCardMapping(companyDb: string | undefined) {
  const [rows, setRows] = useState<PagCorpCardMappingRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedCompanyDb, setLoadedCompanyDb] = useState<string | null>(null);

  useEffect(() => {
    if (!companyDb) {
      setRows([]);
      setLoadedCompanyDb(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadedCompanyDb(null);
      try {
        const { sapFunctionFetch } = await import("@/lib/auth-fetch");
        const res = await sapFunctionFetch("pagcorp-card-mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list-mappings", company_db: companyDb }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || result.success === false) {
          throw new Error(result.error || `Erro ${res.status}`);
        }
        if (!cancelled) {
          setRows(((result.mappings as PagCorpCardMappingRow[]) || []).map((r) => ({
            card_identifier: r.card_identifier,
            is_fallback: !!r.is_fallback,
            cost_center: r.cost_center || null,
            project: r.project || null,
            item_code: r.item_code || null,
          })));
          setLoadedCompanyDb(companyDb);
        }
      } catch (e) {
        console.warn("PagCorp card mapping load failed:", e);
        if (!cancelled) {
          setRows([]);
          setLoadedCompanyDb(companyDb);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDb]);

  const resolveKeys = (tx: {
    cardLastDigits?: unknown;
    cardId?: unknown;
    cardName?: unknown;
    accountAlias?: unknown;
    accountName?: unknown;
  }): string[] => {
    const candidates = [tx.cardLastDigits, tx.cardId, tx.cardName, tx.accountAlias, tx.accountName]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);
    return Array.from(new Set(candidates));
  };

  const resolveKey = (tx: {
    cardLastDigits?: unknown;
    cardId?: unknown;
    cardName?: unknown;
    accountAlias?: unknown;
    accountName?: unknown;
  }): string | null => {
    return resolveKeys(tx)[0] || null;
  };

  const resolve = useCallback(
    (tx: { cardLastDigits?: unknown; cardId?: unknown; cardName?: unknown; accountAlias?: unknown; accountName?: unknown }): PagCorpCardMappingResolved => {
      const keys = resolveKeys(tx);
      const specific = rows.find(
        (r) => !r.is_fallback && !!r.card_identifier && keys.includes(String(r.card_identifier).trim()),
      );
      if (specific) {
        return {
          costCenter: specific.cost_center,
          project: specific.project,
          itemCode: specific.item_code,
          source: "card",
        };
      }
      const fallback = rows.find((r) => r.is_fallback);
      if (fallback) {
        return {
          costCenter: fallback.cost_center,
          project: fallback.project,
          itemCode: fallback.item_code,
          source: "fallback",
        };
      }
      return { costCenter: null, project: null, itemCode: null, source: null };
    },
    [rows],
  );

  const describe = useCallback(
    (tx: { cardLastDigits?: unknown; cardId?: unknown; cardName?: unknown; accountAlias?: unknown; accountName?: unknown }): PagCorpCardMappingDescribed => {
      const resolved = resolve(tx);
      const missing: string[] = [];
      if (!resolved.costCenter) missing.push("Centro de Custo");
      if (!resolved.project) missing.push("Projeto");
      if (!resolved.itemCode) missing.push("Item");
      let status: CardMappingStatus;
      if (!resolved.source) status = "none";
      else if (missing.length === 0) status = "full";
      else status = "partial";
      return { resolved, status, missingFields: missing, cardKey: resolveKey(tx) };
    },
    [resolve],
  );

  const isLoaded = !!companyDb && loadedCompanyDb === companyDb && !isLoading;

  return { rows, isLoading, isLoaded, resolve, describe };
}
