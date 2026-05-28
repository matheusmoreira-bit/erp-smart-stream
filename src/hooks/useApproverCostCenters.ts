import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ApproverCostCenter {
  id: string;
  sap_email: string;
  company_db: string;
  cost_center: string;
  cost_center_name: string | null;
}

/**
 * Mapeamento (email do aprovador + empresa) → set de cost centers da sua alçada.
 * Carregado uma vez por empresa e cacheado em memória do hook.
 */
export function useApproverCostCenters(companyDB: string | undefined) {
  const [rows, setRows] = useState<ApproverCostCenter[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyDB) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from("approver_cost_centers")
        .select("id,sap_email,company_db,cost_center,cost_center_name")
        .eq("company_db", companyDB);
      setRows((data as ApproverCostCenter[]) || []);
    } finally {
      setLoading(false);
    }
  }, [companyDB]);

  useEffect(() => {
    load();
  }, [load]);

  /** Set de cost centers cadastrados para um determinado email (lowercase) */
  const getCostCentersForEmail = useCallback(
    (email: string | undefined | null): Set<string> => {
      const e = (email || "").toLowerCase().trim();
      if (!e) return new Set();
      return new Set(
        rows
          .filter((r) => (r.sap_email || "").toLowerCase().trim() === e)
          .map((r) => r.cost_center),
      );
    },
    [rows],
  );

  return { rows, loading, refresh: load, getCostCentersForEmail };
}
