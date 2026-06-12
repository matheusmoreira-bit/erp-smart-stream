import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyTargets {
  requisicao: number;
  cotacao: number;
  aprovacao: number;
  pedido_compra: number;
  nf_entrada: number;
  pagamento: number;
  aprovador: number;
}

export const DEFAULT_TARGETS: CompanyTargets = {
  requisicao: 2,
  cotacao: 3,
  aprovacao: 3,
  pedido_compra: 3,
  nf_entrada: 2,
  pagamento: 5,
  aprovador: 1,
};

export interface Company {
  id: string;
  company_db: string;
  display_name: string;
  service_layer_url: string | null;
  is_active: boolean;
  created_at: string;
  targets: CompanyTargets;
  erp_type: string;
  legal_name?: string | null;
  trade_name?: string | null;
  tax_id?: string | null;
  foreign_name?: string | null;
  is_foreign?: boolean;
}

export function useCompanies(onlyActive = false) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCompanies = useCallback(async () => {
    let q = supabase.from("companies").select("*").order("display_name");
    if (onlyActive) q = q.eq("is_active", true);
    const { data } = await q;
    setCompanies(
      (data || []).map((c: any) => ({
        ...c,
        targets: { ...DEFAULT_TARGETS, ...(c.targets as Record<string, number>) },
        erp_type: c.erp_type || "sap",
      })) as Company[]
    );
    setLoading(false);
  }, [onlyActive]);

  useEffect(() => {
    fetchCompanies();
    const channelName = `companies-sync-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "companies" }, () => fetchCompanies())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchCompanies]);

  const getLabel = useCallback((companyDb: string) => {
    return companies.find((c) => c.company_db === companyDb)?.display_name || companyDb;
  }, [companies]);

  return { companies, loading, fetchCompanies, getLabel };
}
