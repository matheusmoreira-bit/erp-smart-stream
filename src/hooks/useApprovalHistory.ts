import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";

export interface ApprovalHistoryRow {
  id: string;
  external_id: string;
  company_db: string;
  decision: string | null;
  decision_date: string | null;
  approver_code: string | null;
  approver_name: string | null;
  approver_email: string | null;
  requester_code: string | null;
  requester_name: string | null;
  doc_object_type: string | null;
  doc_type_name: string | null;
  doc_entry: number | null;
  doc_num: number | null;
  doc_total: number | null;
  currency: string | null;
  card_code: string | null;
  card_name: string | null;
  remarks: string | null;
  stage_name: string | null;
  step: number | null;
  synced_at: string;
}

export interface ApprovalHistorySyncState {
  last_sync_at: string | null;
  last_status: string | null;
  last_message: string | null;
  last_count: number | null;
}

export function useApprovalHistory(companyDb?: string | null) {
  const [rows, setRows] = useState<ApprovalHistoryRow[]>([]);
  const [syncState, setSyncState] = useState<ApprovalHistorySyncState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let q = supabase
        .from("approval_history")
        .select("*")
        .order("decision_date", { ascending: false, nullsFirst: false })
        .limit(2000);
      if (companyDb) q = q.eq("company_db", companyDb);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data || []) as ApprovalHistoryRow[]);

      const { data: state } = await supabase
        .from("approval_history_sync_state")
        .select("last_sync_at,last_status,last_message,last_count")
        .eq("id", 1)
        .maybeSingle();
      setSyncState((state || null) as ApprovalHistorySyncState | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar histórico");
    } finally {
      setIsLoading(false);
    }
  }, [companyDb]);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await authFetch("approval-history-sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await load();
      return body as { received: number; upserted: number };
    } finally {
      setIsSyncing(false);
    }
  }, [load]);

  useEffect(() => { load(); }, [load]);

  return { rows, syncState, isLoading, isSyncing, error, refresh: load, sync };
}
