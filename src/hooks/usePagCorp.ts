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
  cardId?: string | number;
  cardName?: string;
  cardLastDigits?: string;
  eventClassification?: string;
  status?: string;
  hasAccountability?: boolean;
  accountabilityApproved?: boolean;
  accountabilityId?: string | number | null;
  attachments?: unknown[];
  receipts?: any[];
  integrated?: boolean;
  integrationLogId?: string;
  sapDocNum?: number | null;
  sapDocEntry?: number | null;
  settlementStatus?: string | null;
  settlementPaymentDocNum?: number | null;
  settlementError?: string | null;
  isReversed?: boolean;
  isNondeductible?: boolean;
  nondeductibleAtExpense?: boolean;
  nondeductibleSupplierCode?: string;
  nondeductibleSupplierName?: string;
  [key: string]: unknown;
}

export function usePagCorp() {
  const [transactions, setTransactions] = useState<PagCorpTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (startDate?: string, endDate?: string, companyDb?: string) => {
    setError(null);
    const cacheKey = `pagcorp:txns:${startDate || ""}:${endDate || ""}`;

    // 1. Stale-while-revalidate: paint cached data instantly when available.
    let hadCache = false;
    if (companyDb) {
      try {
        const { readCache } = await import("@/lib/external-cache");
        const cached = await readCache<PagCorpTransaction[]>(cacheKey, companyDb);
        if (cached?.data?.length) {
          setTransactions(cached.data);
          hadCache = true;
        }
      } catch {/* ignore cache errors */}
    }
    if (!hadCache) setIsLoading(true);

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
            // Prioriza a moeda original da compra; só assume BRL como último recurso.
            const candidates = [
              item.originalCurrencyCode,
              item.originalCurrency,
              item.paymentCurrency,
              item.paymentCurrencyCode,
              item.eventCurrency,
              item.eventCurrencyCode,
              item.cardCurrency,
              item.cardCurrencyCode,
              item.currencyCode,
              item.currency,
              item.currencySymbol,
            ];
            for (const c of candidates) {
              if (!c) continue;
              const s = String(c).toUpperCase().trim();
              if (!s || s === "##" || s === "N/A") continue;
              if (s === "R$" || s === "BRL") return "BRL";
              if (s === "US$" || s === "$" || s === "USD") return "USD";
              if (/^[A-Z]{3}$/.test(s)) return s;
            }
            // Heurística textual final
            const text = [item.eventClassification, item.classification, item.description]
              .map((x) => String(x || "").toLowerCase()).join(" ");
            if (/(dolar|dólar|dollar|\busd\b|us\$|exterior)/.test(text)) return "USD";
            return "BRL";
          })(),
          accountCode: item.accountCode || item.account || "",
          accountName: item.accountName || item.parentAccountAlias || item.accountAlias || "",
          accountAlias: item.accountAlias || item.parentAccountAlias || "",
          cardId: item.cardId || item.card_id || "",
          cardName: item.cardName || item.card_name || item.accountAlias || item.parentAccountAlias || "",
          cardLastDigits: item.cardLastDigits || item.lastDigits || "",
          status: item.status || item.statusDescription || "",
          hasAccountability,
          accountabilityApproved,
          accountabilityId: item.accountabilityId || null,
          attachments: item.attachments || [],
          receipts,
          integrated: false,
          isReversed: Number(item.amount || item.value || item.expenseValue || 0) === 0,
        };
      });

      // Check which transactions are already integrated NA EMPRESA ATUAL.
      // Sem company_db, não marca como integrada (evita herdar status de outra base).
      const expenseIds = items.map((t) => Number(t.id)).filter((id) => !isNaN(id));
      if (expenseIds.length > 0 && companyDb) {
        const { data: logs } = await supabase
          .from("pagcorp_integration_log")
          .select("pagcorp_expense_id, id, status, sap_doc_num, sap_doc_entry, settlement_status, settlement_payment_doc_num, settlement_error")
          .in("pagcorp_expense_id", expenseIds)
          .eq("status", "success")
          .eq("company_db", companyDb);

        const integratedMap = new Map<number, { id: string; docNum: number | null; docEntry: number | null; settlementStatus: string | null; settlementPaymentDocNum: number | null; settlementError: string | null }>();
        (logs || []).forEach((log: any) => {
          integratedMap.set(log.pagcorp_expense_id, {
            id: log.id,
            docNum: log.sap_doc_num ?? null,
            docEntry: log.sap_doc_entry ?? null,
            settlementStatus: log.settlement_status ?? null,
            settlementPaymentDocNum: log.settlement_payment_doc_num ?? null,
            settlementError: log.settlement_error ?? null,
          });
        });

        items.forEach((t) => {
          const hit = integratedMap.get(Number(t.id));
          if (hit) {
            t.integrated = true;
            t.integrationLogId = hit.id;
            t.sapDocNum = hit.docNum;
            t.sapDocEntry = hit.docEntry;
            t.settlementStatus = hit.settlementStatus;
            t.settlementPaymentDocNum = hit.settlementPaymentDocNum;
            t.settlementError = hit.settlementError;
          }
        });
      }

      // Annotate nondeductible cards + per-expense overrides
      if (companyDb) {
        // 1) Card-level
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

        // 2) Per-expense overrides (B4) — prevalece sobre o do cartão
        const expIds = items.map((t) => Number(t.id)).filter((n) => !isNaN(n));
        if (expIds.length > 0) {
          const { data: ndExp } = await supabase
            .from("pagcorp_nondeductible_expenses" as any)
            .select("pagcorp_expense_id, supplier_code, supplier_name")
            .eq("company_db", companyDb)
            .in("pagcorp_expense_id", expIds);
          if (ndExp && ndExp.length) {
            const map = new Map<number, { code?: string; name?: string }>();
            (ndExp as any[]).forEach((r) =>
              map.set(Number(r.pagcorp_expense_id), {
                code: r.supplier_code || undefined,
                name: r.supplier_name || undefined,
              }),
            );
            items.forEach((t) => {
              const hit = map.get(Number(t.id));
              if (hit) {
                t.isNondeductible = true;
                t.nondeductibleAtExpense = true;
                if (hit.code) t.nondeductibleSupplierCode = hit.code;
                if (hit.name) t.nondeductibleSupplierName = hit.name;
              }
            });
          }
        }
      }

      setTransactions(items);

      // Catálogo de cartões: upsert distintos vistos nesta busca para alimentar
      // o mapeamento de cartões mesmo sem refazer a chamada ao PagCorp.
      if (companyDb && items.length > 0) {
        try {
          const cardMap = new Map<string, {
            company_db: string;
            card_identifier: string;
            card_name: string | null;
            card_last_digits: string | null;
            card_label: string | null;
            account_alias: string | null;
            last_seen_at: string;
          }>();
          const nowIso = new Date().toISOString();
          for (const t of items) {
            const last = t.cardLastDigits ? String(t.cardLastDigits).trim() : "";
            const cardId = t.cardId ? String(t.cardId).trim() : "";
            const name = t.cardName ? String(t.cardName).trim() : "";
            const identifier = last || cardId || name;
            if (!identifier || cardMap.has(identifier)) continue;
            const label = [name || t.accountAlias || t.accountName, last ? `•••• ${last}` : cardId ? `ID ${cardId}` : null].filter(Boolean).join(" ") || identifier;
            cardMap.set(identifier, {
              company_db: companyDb,
              card_identifier: identifier,
              card_name: name || null,
              card_last_digits: last || null,
              card_label: label,
              account_alias: t.accountAlias ? String(t.accountAlias) : null,
              last_seen_at: nowIso,
            });
          }
          if (cardMap.size > 0) {
            const { sapFunctionFetch } = await import("@/lib/auth-fetch");
            await sapFunctionFetch("pagcorp-card-mapping", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "catalog", cards: Array.from(cardMap.values()) }),
            });
          }
        } catch (e) {
          console.warn("PagCorp card catalog upsert failed:", e);
        }
      }

      // Persist to DB cache so the next visit / period switch is instant
      if (companyDb) {
        try {
          const { writeCache } = await import("@/lib/external-cache");
          await writeCache(cacheKey, companyDb, items);
        } catch (e) {
          console.warn("PagCorp cache write failed:", e);
        }
      }

    } catch (e) {
      console.error("PagCorp fetch error:", e);
      if (!hadCache) setError(e instanceof Error ? e.message : "Erro ao buscar transações");
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
    nondeductible?: boolean,
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
        nondeductible: !!nondeductible,
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
