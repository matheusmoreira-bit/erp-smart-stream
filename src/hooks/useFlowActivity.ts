import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface FlowActivityRecord {
  ts: string;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  company_db: string | null;
  detail: string | null;
}

const FLOW_ACTION_LABELS: Record<string, string> = {
  flow_document_created: "Documento criado",
  flow_created: "Documento criado",
  flow_submitted: "Enviado para aprovação",
  flow_approved: "Aprovação",
  flow_rejected: "Reprovação",
  flow_cancelled: "Cancelamento",
  flow_reactivated: "Reativação",
  flow_integrated: "Integrado ao ERP",
  flow_integration_failed: "Falha de integração",
  flow_routing_fallback: "Roteamento por fallback",
};

export function getFlowActionLabel(action: string): string {
  if (FLOW_ACTION_LABELS[action]) return FLOW_ACTION_LABELS[action];
  const raw = action.replace(/^flow_/, "").replace(/[_.]/g, " ");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function isFlowNegativeAction(action: string): boolean {
  return (
    action === "flow_rejected" ||
    action === "flow_cancelled" ||
    action === "flow_integration_failed"
  );
}

/** Atividade dos usuários gerada dentro do ERP Flow (não vem do SAP). */
export function useFlowActivity(days: number) {
  const { session } = useSap();
  const [records, setRecords] = useState<FlowActivityRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase.rpc("get_flow_user_activity", {
          _company_db: session?.companyDB ?? null,
          _days: days > 0 ? days : 365,
          _limit: 2000,
        });
        if (signal?.aborted) return;
        if (err) throw err;
        setRecords((data ?? []) as FlowActivityRecord[]);
      } catch (e) {
        if (signal?.aborted) return;
        console.error("Error fetching flow activity:", e);
        setError(e instanceof Error ? e.message : "Erro ao buscar atividade do ERP Flow");
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [session?.companyDB, days]
  );

  const refresh = useCallback(() => load(), [load]);

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  return { records, isLoading, error, refresh };
}
