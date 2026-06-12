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
  isNondeductible?: boolean;
  nondeductibleSupplierCode?: string;
  nondeductibleSupplierName?: string;
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

      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const queryString = new URLSearchParams(params).toString();
      const url = `pagcorp-proxy${queryString ? `?${queryString}` : ""}`;
      const res = await sapFunctionFetch(url);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Erro ${res.status}`);
      }

      const result = await res.json();
      const seenIds = new Set<string | number>();
      const items: PagCorpTransaction[] = (result.items || []).map((item: any, index: number) => {
        const receipts = item.receipts || [];
        const hasAccountability = receipts.length > 0;
        const accountabilityApproved = receipts.some((r: any) => r.statusId === 3);

        // Resolve a STABLE + UNIQUE id. Spread item LAST would otherwise let an
        // undefined item.id overwrite our computed id, and duplicate ids would
        // make a single checkbox click toggle multiple rows.
        let resolvedId: string | number = item.id ?? item.expenseId ?? index;
        if (seenIds.has(resolvedId)) {
          resolvedId = `${resolvedId}-${index}`;
        }
        seenIds.add(resolvedId);

        return {
          ...item,
          id: resolvedId,
          date: item.eventDate || item.date || item.expenseDate || item.createdAt || "",
          description: item.description || item.expenseDescription || "—",
          amount: item.amount || item.value || item.expenseValue || 0,
          currency: (() => {
            const explicit = item.currencyCode || item.currency;
            if (explicit && explicit !== "##") return explicit;
            const classification = String(item.eventClassification || "").toLowerCase();
            if (classification.includes("dolar") || classification.includes("dólar") || classification.includes("dollar") || classification.includes("usd")) {
              return "USD";
            }
            return "BRL";
          })(),
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

      // Annotate nondeductible cards (mapped by company)
      if (companyDb) {
        const { data: nondeductible } = await supabase
          .from("pagcorp_nondeductible_cards" as any)
          .select("card_identifier, supplier_code, supplier_name")
          .eq("company_db", companyDb);
        if (nondeductible && nondeductible.length) {
          const map = new Map<string, { code: string; name?: string }>();
          (nondeductible as any[]).forEach((c) =>
            map.set(String(c.card_identifier), { code: c.supplier_code, name: c.supplier_name }),
          );
          items.forEach((t) => {
            const key = (t.cardLastDigits && String(t.cardLastDigits).trim()) ||
              (t.cardName && String(t.cardName).trim()) || "";
            const hit = key ? map.get(key) : undefined;
            if (hit) {
              t.isNondeductible = true;
              t.nondeductibleSupplierCode = hit.code;
              t.nondeductibleSupplierName = hit.name;
            }
          });
        }
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

  /**
   * Direct integration: PagCorp transaction → SAP (PC + NF + Pagamento), no
   * approvals, no internal expense row. Logs everything in pagcorp_integration_log.
   */
  const integrateDirect = useCallback(async (
    transaction: PagCorpTransaction,
    integrationType: "generic" | "accountability",
    companyDb: string,
    supplierCode: string,
    supplierName?: string,
    integratedBy?: string,
    lineOverrides?: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }>,
    nondeductible?: boolean,
  ) => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const res = await sapFunctionFetch("pagcorp-to-sap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction,
        companyDb,
        integrationType,
        supplierCode,
        supplierName,
        integratedBy,
        lineOverrides: lineOverrides || {},
        nondeductible: !!nondeductible,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      throw new Error(result.error || `Erro ${res.status}`);
    }
    return result;
  }, []);


  /**
   * Consolidated integration: many PagCorp transactions → ONE SAP Purchase Order
   * with one line per transaction, all under the same supplier.
   */
  const integrateConsolidated = useCallback(async (
    transactions: PagCorpTransaction[],
    companyDb: string,
    supplierCode: string,
    supplierName?: string,
    integratedBy?: string,
    lineOverrides?: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }>,
  ) => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const res = await sapFunctionFetch("pagcorp-to-sap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions,
        companyDb,
        integrationType: "generic",
        supplierCode,
        supplierName,
        integratedBy,
        lineOverrides: lineOverrides || {},
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      throw new Error(result.error || `Erro ${res.status}`);
    }
    return result;
  }, []);


  return { transactions, isLoading, error, fetchTransactions, logIntegration, integrateDirect, integrateConsolidated };
}
