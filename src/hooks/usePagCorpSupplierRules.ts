import { useCallback, useEffect, useState } from "react";
import { findSupplierRule, type PagCorpSupplierRule } from "@/lib/pagcorp-supplier-rules";

export interface PagCorpSupplierRuleRow extends PagCorpSupplierRule {
  id: string;
}

/**
 * Carrega as regras de fornecedor padrão por descrição da empresa atual
 * e expõe um resolvedor por descrição de transação.
 */
export function usePagCorpSupplierRules(companyDb: string | undefined) {
  const [rules, setRules] = useState<PagCorpSupplierRuleRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedCompanyDb, setLoadedCompanyDb] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyDb) {
      setRules([]);
      setLoadedCompanyDb(null);
      return;
    }
    setIsLoading(true);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const res = await sapFunctionFetch("pagcorp-card-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-supplier-rules", company_db: companyDb }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) throw new Error(result.error || `Erro ${res.status}`);
      setRules((result.rules as PagCorpSupplierRuleRow[]) || []);
    } catch (e) {
      console.warn("PagCorp supplier rules load failed:", e);
      setRules([]);
    } finally {
      setLoadedCompanyDb(companyDb);
      setIsLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const resolve = useCallback(
    (description: unknown) => findSupplierRule(rules, description),
    [rules],
  );

  const isLoaded = !!companyDb && loadedCompanyDb === companyDb && !isLoading;

  return { rules, isLoading, isLoaded, reload: load, resolve };
}
