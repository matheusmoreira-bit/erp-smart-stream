import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SynapseIntegration {
  id: string;
  integration_key: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  interval_minutes: number;
  parameters: Record<string, unknown>;
  company_db: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SynapseLog {
  id: string;
  integration_key: string;
  status: string;
  details: Record<string, unknown>;
  affected_count: number;
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function useSynapseIntegrations(companyDB?: string) {
  const [integrations, setIntegrations] = useState<SynapseIntegration[]>([]);
  const [logs, setLogs] = useState<SynapseLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const fetchIntegrations = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("synapse_integrations")
        .select("*")
        .order("display_name");
      if (companyDB) query = query.eq("company_db", companyDB);
      const { data, error } = await query;
      if (error) throw error;
      setIntegrations((data as unknown as SynapseIntegration[]) || []);
    } finally {
      setIsLoading(false);
    }
  }, [companyDB]);

  const fetchLogs = useCallback(async (integrationKey: string, limit = 20) => {
    const { data, error } = await supabase
      .from("synapse_execution_log")
      .select("*")
      .eq("integration_key", integrationKey)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    setLogs((data as unknown as SynapseLog[]) || []);
  }, []);

  const updateIntegration = useCallback(async (id: string, updates: Partial<SynapseIntegration>) => {
    const { error } = await supabase
      .from("synapse_integrations")
      .update(updates as any)
      .eq("id", id);
    if (error) throw error;
    await fetchIntegrations();
  }, [fetchIntegrations]);

  const ensureIntegration = useCallback(async (companyDb: string) => {
    // Ensure JumpCloud integration
    const { data: jcData } = await supabase
      .from("synapse_integrations")
      .select("id")
      .eq("integration_key", "jumpcloud_sap_sync")
      .eq("company_db", companyDb)
      .maybeSingle();

    if (!jcData) {
      await supabase.from("synapse_integrations").insert({
        integration_key: "jumpcloud_sap_sync",
        display_name: "JumpCloud → SAP B1",
        description:
          "Sincroniza status de usuários do JumpCloud com o SAP B1. Usuários desabilitados no JumpCloud são automaticamente bloqueados no SAP.",
        is_active: false,
        interval_minutes: 360,
        parameters: { auto_disable: true },
        company_db: companyDb,
      } as any);
    }

    // Ensure PagCorp integration
    const { data: pcData } = await supabase
      .from("synapse_integrations")
      .select("id")
      .eq("integration_key", "pagcorp_erp_sync")
      .eq("company_db", companyDb)
      .maybeSingle();

    if (!pcData) {
      await supabase.from("synapse_integrations").insert({
        integration_key: "pagcorp_erp_sync",
        display_name: "PagCorp → ERP",
        description:
          "Integra despesas com prestação de contas aprovada do PagCorp para o ERP (SAP B1). Executa automaticamente a cada 30 minutos.",
        is_active: false,
        interval_minutes: 30,
        parameters: {
          days_back: 30,
          sap_endpoint: "PurchaseOrders",
          default_supplier_code: "",
          default_item_code: "",
          default_cost_center: "",
          default_project: "",
          default_bpl_id: "1",
          default_currency: "",
          default_doc_rate: "",
        },
        company_db: companyDb,
      } as any);
    }

    await fetchIntegrations();
  }, [fetchIntegrations]);

  const runNow = useCallback(async (integrationKey: string, companyDb?: string) => {
    setIsRunning(true);
    try {
      const edgeFunctionMap: Record<string, string> = {
        jumpcloud_sap_sync: "synapse-jc-sync",
        pagcorp_erp_sync: "synapse-pagcorp-sync",
      };
      const functionName = edgeFunctionMap[integrationKey] || "synapse-jc-sync";

      const { authFetch } = await import("@/lib/auth-fetch");
      const res = await authFetch(functionName, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_db: companyDb }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
      await fetchIntegrations();
      return data;
    } finally {
      setIsRunning(false);
    }
  }, [fetchIntegrations]);

  return {
    integrations,
    logs,
    isLoading,
    isRunning,
    fetchIntegrations,
    fetchLogs,
    updateIntegration,
    ensureIntegration,
    runNow,
  };
}
