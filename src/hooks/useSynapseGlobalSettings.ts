import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SynapseGlobalSetting {
  id: string;
  integration_key: string;
  is_active_global: boolean;
  interval_minutes: number;
  parameters: Record<string, unknown>;
  updated_at: string;
}

const DISPLAY: Record<string, { name: string; description: string }> = {
  purchase_order_notifications: {
    name: "Notificações de Pedidos de Compra",
    description: "Controle global do fluxo que envia emails de andamento dos PO ao solicitante.",
  },
};

export function useSynapseGlobalSettings() {
  const [settings, setSettings] = useState<SynapseGlobalSetting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("synapse_global_settings")
        .select("*")
        .order("integration_key");
      if (error) throw error;
      setSettings((data as unknown as SynapseGlobalSetting[]) || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const update = useCallback(async (id: string, patch: Partial<SynapseGlobalSetting>) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("synapse_global_settings")
        .update(patch as any)
        .eq("id", id);
      if (error) throw error;
      await fetchAll();
    } finally {
      setIsSaving(false);
    }
  }, [fetchAll]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const getDisplay = (key: string) =>
    DISPLAY[key] || { name: key, description: "" };

  return { settings, isLoading, isSaving, update, getDisplay, refresh: fetchAll };
}
