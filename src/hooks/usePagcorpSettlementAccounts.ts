import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PagcorpSettlementAccount {
  id: string;
  company_db: string;
  card_identifier: string | null;
  settlement_account_code: string;
  cost_center: string | null;
  project: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function usePagcorpSettlementAccounts(companyDb?: string | null) {
  const [items, setItems] = useState<PagcorpSettlementAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("pagcorp_settlement_accounts")
      .select("*")
      .order("company_db", { ascending: true })
      .order("card_identifier", { ascending: true, nullsFirst: true });
    if (companyDb) q = q.eq("company_db", companyDb);
    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setItems((data || []) as PagcorpSettlementAccount[]);
    setLoading(false);
  }, [companyDb]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const upsert = useCallback(async (row: Partial<PagcorpSettlementAccount> & { company_db: string; settlement_account_code: string }) => {
    const payload = {
      company_db: row.company_db,
      card_identifier: row.card_identifier ?? null,
      settlement_account_code: row.settlement_account_code,
      cost_center: row.cost_center ?? null,
      project: row.project ?? null,
      enabled: row.enabled ?? true,
    };
    if (row.id) {
      const { error: err } = await supabase.from("pagcorp_settlement_accounts").update(payload).eq("id", row.id);
      if (err) throw err;
    } else {
      const { error: err } = await supabase.from("pagcorp_settlement_accounts").insert(payload);
      if (err) throw err;
    }
    await fetchAll();
  }, [fetchAll]);

  const remove = useCallback(async (id: string) => {
    const { error: err } = await supabase.from("pagcorp_settlement_accounts").delete().eq("id", id);
    if (err) throw err;
    await fetchAll();
  }, [fetchAll]);

  return { items, loading, error, refresh: fetchAll, upsert, remove };
}

export async function reprocessPagcorpSettlement(logId: string): Promise<void> {
  const { error: err } = await supabase
    .from("pagcorp_integration_log")
    .update({
      settlement_status: "pending",
      settlement_error: null,
      settlement_locked_at: null,
    })
    .eq("id", logId);
  if (err) throw err;
  await supabase.functions.invoke("pagcorp-settlement-watcher", { body: {} }).catch(() => {});
}
