import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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

/**
 * Carrega TODAS as linhas de pagcorp_card_mapping da empresa atual e expõe
 * uma função que resolve o mapeamento aplicável a uma transação (por
 * cardLastDigits/cardName). Resultados em cache local do hook (1 fetch por
 * mudança de empresa).
 */
export function usePagCorpCardMapping(companyDb: string | undefined) {
  const [rows, setRows] = useState<PagCorpCardMappingRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyDb) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const { data } = await (supabase as any)
          .from("pagcorp_card_mapping")
          .select("card_identifier,is_fallback,cost_center,project,item_code")
          .eq("company_db", companyDb);
        if (!cancelled) setRows((data as PagCorpCardMappingRow[]) || []);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDb]);

  const resolveKey = (tx: { cardLastDigits?: unknown; cardName?: unknown }): string | null => {
    const last = tx.cardLastDigits ? String(tx.cardLastDigits).trim() : "";
    if (last) return last;
    const name = tx.cardName ? String(tx.cardName).trim() : "";
    return name || null;
  };

  const resolve = useCallback(
    (tx: { cardLastDigits?: unknown; cardName?: unknown }): PagCorpCardMappingResolved => {
      const key = resolveKey(tx);
      const specific = key
        ? rows.find((r) => !r.is_fallback && r.card_identifier === key)
        : undefined;
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

  return { rows, isLoading, resolve };
}
