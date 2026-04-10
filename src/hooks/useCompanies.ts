import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Company {
  id: string;
  company_db: string;
  display_name: string;
  service_layer_url: string | null;
  is_active: boolean;
  created_at: string;
}

export function useCompanies(onlyActive = false) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCompanies = useCallback(async () => {
    let q = supabase.from("companies").select("*").order("display_name");
    if (onlyActive) q = q.eq("is_active", true);
    const { data } = await q;
    setCompanies(data || []);
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
