import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  integrated?: boolean;
  integrationLogId?: string;
  [key: string]: unknown;
}

export function usePagCorp() {
  const [transactions, setTransactions] = useState<PagCorpTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (startDate?: string, endDate?: string, companyDb?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (companyDb) params.companyDb = companyDb;

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
          integrated: false,
          ...item,
        };
      });

      // Check which transactions are already integrated
      const expenseIds = items.map((t) => Number(t.id)).filter((id) => !isNaN(id));
      if (expenseIds.length > 0) {
        const { data: logs } = await supabase
          .from("pagcorp_integration_log")
          .select("pagcorp_expense_id, id, status")
          .in("pagcorp_expense_id", expenseIds)
          .eq("status", "success");

        const integratedMap = new Map<number, string>();
        (logs || []).forEach((log: any) => {
          integratedMap.set(log.pagcorp_expense_id, log.id);
        });

        items.forEach((t) => {
          const logId = integratedMap.get(Number(t.id));
          if (logId) {
            t.integrated = true;
            t.integrationLogId = logId;
          }
        });
      }

      setTransactions(items);
    } catch (e) {
      console.error("PagCorp fetch error:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar transações");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logIntegration = useCallback(async (
    transaction: PagCorpTransaction,
    integrationType: "generic" | "accountability",
    status: "success" | "error" | "pending",
    companyDb?: string,
    integratedBy?: string,
    sapDocEntry?: number,
    sapDocNum?: number,
    errorMessage?: string,
    sapPayload?: any,
    sapResponse?: any,
  ) => {
    const { data, error } = await supabase
      .from("pagcorp_integration_log")
      .insert({
        pagcorp_expense_id: Number(transaction.id),
        pagcorp_data: {
          description: transaction.description,
          amount: transaction.amount,
          currency: transaction.currency,
          date: transaction.date,
          accountAlias: transaction.accountAlias,
          accountCode: transaction.accountCode,
          hasAccountability: transaction.hasAccountability,
          accountabilityApproved: transaction.accountabilityApproved,
          receipts: transaction.receipts,
        },
        integration_type: integrationType,
        status,
        company_db: companyDb || null,
        integrated_by: integratedBy || null,
        sap_doc_entry: sapDocEntry || null,
        sap_doc_num: sapDocNum || null,
        error_message: errorMessage || null,
        sap_payload: sapPayload || null,
        sap_response: sapResponse || null,
      } as any)
      .select("id")
      .single();

    if (error) throw error;

    // Audit
    const { logAuditAction } = await import("@/hooks/useAuditLog");
    await logAuditAction({
      action: "integrate",
      entity_type: "pagcorp_transaction",
      entity_id: String(transaction.id),
      details: { integrationType, status, companyDb, sapDocEntry, sapDocNum, amount: transaction.amount, description: transaction.description },
    });

    return data;
  }, []);

  return { transactions, isLoading, error, fetchTransactions, logIntegration };
}
