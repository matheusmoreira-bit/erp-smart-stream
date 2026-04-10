import { useState, useCallback } from "react";

export interface PagCorpTransaction {
  id: string | number;
  date: string;
  description: string;
  amount: number;
  currency?: string;
  accountCode?: string;
  accountName?: string;
  accountAlias?: string;
  cardName?: string;
  cardLastDigits?: string;
  status?: string;
  hasAccountability?: boolean;
  accountabilityApproved?: boolean;
  accountabilityId?: string | number | null;
  attachments?: unknown[];
  receipts?: any[];
  [key: string]: unknown;
}

export function usePagCorp() {
  const [transactions, setTransactions] = useState<PagCorpTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (startDate?: string, endDate?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const queryString = new URLSearchParams(params).toString();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const url = `${supabaseUrl}/functions/v1/pagcorp-proxy${queryString ? `?${queryString}` : ""}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Erro ${res.status}`);
      }

      const result = await res.json();
      const items: PagCorpTransaction[] = (result.items || []).map((item: any, index: number) => {
        const receipts = item.receipts || [];
        const hasAccountability = receipts.length > 0;
        const accountabilityApproved = receipts.some((r: any) => r.statusId === 3);

        return {
          id: item.id || item.expenseId || index,
          date: item.eventDate || item.date || item.expenseDate || item.createdAt || "",
          description: item.description || item.expenseDescription || "—",
          amount: item.amount || item.value || item.expenseValue || 0,
          currency: item.currencyCode || item.currency || "BRL",
          accountCode: item.accountCode || item.account || "",
          accountName: item.accountName || "",
          accountAlias: item.accountAlias || "",
          cardName: item.cardName || item.card_name || "",
          cardLastDigits: item.cardLastDigits || item.lastDigits || "",
          status: item.status || item.statusDescription || "",
          hasAccountability,
          accountabilityApproved,
          accountabilityId: item.accountabilityId || null,
          attachments: item.attachments || [],
          receipts,
          ...item,
        };
      });
      }));

      setTransactions(items);
    } catch (e) {
      console.error("PagCorp fetch error:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar transações");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { transactions, isLoading, error, fetchTransactions };
}
