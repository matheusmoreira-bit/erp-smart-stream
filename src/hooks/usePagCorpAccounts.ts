import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PagCorpCardInfo {
  id?: string | number;
  alias?: string;
  status?: string;
  type?: string;
  coverage?: string;
}

export interface PagCorpAccountInfo {
  account: string;
  parentAccount: string | null;
  alias: string | null;
  accountType: string | null;
  costCenter: string | null;
  status: string | null;
  active: boolean | null;
  cards: PagCorpCardInfo[];
  cardHolders: { document?: string; emails?: { email?: string }[] }[];
  available: number | null;
}

export interface PagCorpBalanceSnapshot {
  account: string;
  alias: string | null;
  account_type: string | null;
  available: number;
  snapshot_date: string;
}

export function isTreasury(a: Pick<PagCorpAccountInfo, "accountType">): boolean {
  return String(a.accountType || "").toLowerCase().includes("treasury");
}

/**
 * Contas PagCorp (tesouraria + cartões) com saldo disponível ao vivo,
 * mais o histórico diário de saldos gravado pelo backend.
 */
export function usePagCorpAccounts(companyDb?: string) {
  const [accounts, setAccounts] = useState<PagCorpAccountInfo[]>([]);
  const [snapshots, setSnapshots] = useState<PagCorpBalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyDb) {
      setAccounts([]);
      setSnapshots([]);
      return;
    }
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const res = await sapFunctionFetch(
        `pagcorp-proxy?action=accounts&companyDb=${encodeURIComponent(companyDb)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Erro ${res.status}`);
      if (body?.notConfigured) {
        setNotConfigured(true);
        setAccounts([]);
      } else {
        setAccounts(Array.isArray(body?.accounts) ? body.accounts : []);
        setCapturedAt(body?.capturedAt ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar saldos");
      setAccounts([]);
    } finally {
      setLoading(false);
    }

    const since = new Date();
    since.setDate(since.getDate() - 120);
    const { data } = await supabase
      .from("pagcorp_balance_snapshots")
      .select("account, alias, account_type, available, snapshot_date")
      .eq("company_db", companyDb)
      .gte("snapshot_date", since.toISOString().slice(0, 10))
      .order("snapshot_date", { ascending: true });
    setSnapshots(
      (data ?? []).map((r) => ({
        account: String(r.account),
        alias: r.alias,
        account_type: r.account_type,
        available: Number(r.available ?? 0),
        snapshot_date: String(r.snapshot_date),
      })),
    );
  }, [companyDb]);

  useEffect(() => {
    void load();
  }, [load]);

  return { accounts, snapshots, loading, error, notConfigured, capturedAt, reload: load };
}
