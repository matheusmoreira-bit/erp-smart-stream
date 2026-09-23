import { useEffect, useState, useCallback } from "react";
import {
  resolveCardMapping,
  type CardSupplierRuleLike,
  type MappingSource,
} from "@/lib/pagcorp-card-resolve";

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
  accountCode: string | null;
  /** Origem mais específica aplicada; null = sem mapeamento */
  source: MappingSource | null;
  fieldSources: Partial<Record<"costCenter" | "project" | "itemCode" | "accountCode", MappingSource>>;
}

export type CardMappingStatus = "none" | "partial" | "full";

export interface PagCorpCardMappingDescribed {
  resolved: PagCorpCardMappingResolved;
  status: CardMappingStatus;
  missingFields: string[];
  cardKey: string | null;
}

type TxLike = {
  cardLastDigits?: unknown;
  cardId?: unknown;
  cardName?: unknown;
  accountAlias?: unknown;
  accountName?: unknown;
};

export const EMPTY_CARD_MAPPING: PagCorpCardMappingResolved = {
  costCenter: null, project: null, itemCode: null, accountCode: null, source: null, fieldSources: {},
};

export function resolveTxCardKeys(tx: TxLike): string[] {
  const candidates = [tx.cardLastDigits, tx.cardId, tx.cardName, tx.accountAlias, tx.accountName]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

/**
 * Carrega mapeamentos por cartão e regras Cartão + Fornecedor da empresa
 * e resolve CC/Projeto/Item/Conta para uma transação (merge por campo:
 * Cartão+Fornecedor > Cartão > Fallback).
 */
export function usePagCorpCardMapping(companyDb: string | undefined) {
  const [rows, setRows] = useState<PagCorpCardMappingRow[]>([]);
  const [rules, setRules] = useState<CardSupplierRuleLike[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedCompanyDb, setLoadedCompanyDb] = useState<string | null>(null);

  useEffect(() => {
    if (!companyDb) {
      setRows([]);
      setRules([]);
      setLoadedCompanyDb(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadedCompanyDb(null);
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const call = async (action: string) => {
        const res = await sapFunctionFetch("pagcorp-card-mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, company_db: companyDb }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || result.success === false) throw new Error(result.error || `Erro ${res.status}`);
        return result;
      };
      const [m, r] = await Promise.allSettled([call("list-mappings"), call("list-card-supplier")]);
      if (cancelled) return;
      if (m.status === "fulfilled") {
        setRows(((m.value.mappings as PagCorpCardMappingRow[]) || []).map((x) => ({
          card_identifier: x.card_identifier,
          is_fallback: !!x.is_fallback,
          cost_center: x.cost_center || null,
          project: x.project || null,
          item_code: x.item_code || null,
        })));
      } else {
        console.warn("PagCorp card mapping load failed:", m.reason);
        setRows([]);
      }
      if (r.status === "fulfilled") setRules((r.value.rules as CardSupplierRuleLike[]) || []);
      else {
        console.warn("PagCorp card+supplier rules load failed:", r.reason);
        setRules([]);
      }
      setLoadedCompanyDb(companyDb);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDb]);

  const resolve = useCallback(
    (tx: TxLike, supplierCode?: string | null): PagCorpCardMappingResolved =>
      resolveCardMapping(resolveTxCardKeys(tx), supplierCode, rows, rules),
    [rows, rules],
  );

  const describe = useCallback(
    (tx: TxLike, supplierCode?: string | null): PagCorpCardMappingDescribed => {
      const resolved = resolve(tx, supplierCode);
      const missing: string[] = [];
      if (!resolved.costCenter) missing.push("Centro de Custo");
      if (!resolved.project) missing.push("Projeto");
      if (!resolved.itemCode) missing.push("Item");
      let status: CardMappingStatus;
      if (!resolved.source) status = "none";
      else if (missing.length === 0) status = "full";
      else status = "partial";
      return { resolved, status, missingFields: missing, cardKey: resolveTxCardKeys(tx)[0] || null };
    },
    [resolve],
  );

  const isLoaded = !!companyDb && loadedCompanyDb === companyDb && !isLoading;

  return { rows, rules, isLoading, isLoaded, resolve, describe };
}
