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

export function useSynapseIntegrations() {
  const [integrations, setIntegrations] = useState<SynapseIntegration[]>([]);
  const [logs, setLogs] = useState<SynapseLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const fetchIntegrations = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("synapse_integrations")
        .select("*")
        .order("display_name");
      if (error) throw error;
      setIntegrations((data as unknown as SynapseIntegration[]) || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const runNow = useCallback(async (integrationKey: string) => {
    setIsRunning(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/synapse-jc-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
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
    runNow,
  };
}
