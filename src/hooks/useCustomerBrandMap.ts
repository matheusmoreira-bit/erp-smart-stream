import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { normalizeWords } from "@/lib/text-normalize";

export interface CustomerBrandRule {
  id: string;
  company_db: string;
  customer_code: string;
  customer_name: string | null;
  project_code: string;
  brand: string | null;
  to_emails: string[];
  cc_emails: string[];
  is_active: boolean;
  source: string;
}

/** Normaliza texto para comparação (sem acento/caixa/símbolos). */
export function normalizeKey(value: unknown): string {
  return normalizeWords(value);
}

/** Máximo de marcas vinculadas por cliente (regra de negócio). */
export const MAX_BRANDS_PER_CUSTOMER = 3;

/**
 * Mapeamento Cliente × Marca(Projeto) → destinatários da NFS-e.
 * Usado tanto na aba de manutenção (Contas a Receber) quanto no pedido de venda,
 * para liberar apenas as marcas vinculadas ao cliente.
 */
export function useCustomerBrandMap(companyDbOverride?: string) {
  const { session } = useSap();
  const companyDb = companyDbOverride ?? session?.companyDB ?? "";
  const [rules, setRules] = useState<CustomerBrandRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyDb) {
      setRules([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("nfse_email_recipients")
      .select(
        "id, company_db, customer_code, customer_name, project_code, brand, to_emails, cc_emails, is_active, source",
      )
      .eq("company_db", companyDb)
      .order("customer_name", { nullsFirst: false })
      .order("project_code");
    if (err) setError(err.message);
    setRules(((data as CustomerBrandRule[]) || []).filter(Boolean));
    setLoading(false);
  }, [companyDb]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Regras ativas de um cliente (por código CXXXXXX). */
  const brandsForCustomer = useCallback(
    (customerCode?: string | null) => {
      const code = String(customerCode || "").trim().toUpperCase();
      if (!code) return [] as CustomerBrandRule[];
      return rules.filter(
        (r) => r.is_active && String(r.customer_code || "").trim().toUpperCase() === code,
      );
    },
    [rules],
  );

  /** Destinatários (to/cc) de um cliente + marca. */
  const recipientsFor = useCallback(
    (customerCode?: string | null, projectCode?: string | null) => {
      const list = brandsForCustomer(customerCode);
      const proj = normalizeKey(projectCode);
      const match =
        list.find((r) => normalizeKey(r.project_code) === proj) ||
        list.find((r) => normalizeKey(r.brand) === proj);
      return {
        to: match?.to_emails ?? [],
        cc: match?.cc_emails ?? [],
        matched: !!match,
      };
    },
    [brandsForCustomer],
  );

  const byCustomer = useMemo(() => {
    const map = new Map<string, CustomerBrandRule[]>();
    for (const r of rules) {
      const key = String(r.customer_code || "").trim().toUpperCase() || "—";
      map.set(key, [...(map.get(key) || []), r]);
    }
    return map;
  }, [rules]);

  return { companyDb, rules, byCustomer, loading, error, reload: load, brandsForCustomer, recipientsFor };
}

/**
 * Aplica a regra de liberação de marcas no pedido de venda:
 * libera apenas as marcas vinculadas ao cliente + o projeto homônimo ao cliente.
 * Sem mapeamento cadastrado, mantém a lista integral (evita travar a operação).
 */
export function filterProjectsForCustomer<T extends { code: string; name?: string | null }>(
  options: T[],
  customer: { code?: string | null; name?: string | null } | null,
  linked: CustomerBrandRule[],
): T[] {
  if (!customer?.code) return options;
  const customerName = normalizeKey(customer.name);
  const allowed = new Set<string>();
  for (const r of linked) {
    allowed.add(normalizeKey(r.project_code));
    if (r.brand) allowed.add(normalizeKey(r.brand));
  }
  if (!allowed.size && !customerName) return options;
  const filtered = options.filter((o) => {
    const code = normalizeKey(o.code);
    const name = normalizeKey(o.name);
    if (allowed.has(code) || allowed.has(name)) return true;
    // Projeto homônimo ao cliente
    return !!customerName && (name === customerName || code === customerName);
  });
  return filtered.length ? filtered : options;
}
