import { useState, useCallback } from "react";

export interface PagCorpTransaction {
  id: string | number;
  date: string;
  description: string;
  amount: number;
  cardHolder?: string;
  cardLastDigits?: string;
  category?: string;
  status?: string;
  merchantName?: string;
  hasAccountability?: boolean;
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
      const items: PagCorpTransaction[] = (result.items || []).map((item: any, index: number) => ({
        id: item.id || item.expenseId || index,
        date: item.date || item.expenseDate || item.createdAt || "",
        description: item.description || item.expenseDescription || item.merchantName || "—",
        amount: item.amount || item.value || item.expenseValue || 0,
        cardHolder: item.cardHolderName || item.userName || item.cardHolder || "",
        cardLastDigits: item.cardLastDigits || item.lastDigits || "",
        category: item.category || item.expenseCategory || "",
        status: item.status || "",
        merchantName: item.merchantName || item.establishment || "",
        hasAccountability: item.hasAccountability ?? item.accountabilityId != null,
        ...item,
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
