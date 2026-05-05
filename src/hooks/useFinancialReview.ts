import { useCallback, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

export type AdvanceDocType = "ADVANCE_AP" | "ADVANCE_AR" | "PAYMENT_OA_OUT" | "PAYMENT_OA_IN";

export interface AdvanceItem {
  doc_type: AdvanceDocType;
  doc_entry: number;
  doc_num: number | null;
  card_code: string;
  card_name: string;
  bp_type: "supplier" | "customer";
  doc_date: string | null;
  doc_total: number;
  paid_to_date: number;
  open_amount: number;
  doc_currency: string;
  remarks: string | null;
  reference: string | null;
}

export interface OpenInvoice {
  doc_entry: number;
  doc_num: number;
  doc_date: string;
  doc_total: number;
  paid_to_date: number;
  open_amount: number;
  doc_currency: string;
  reference: string | null;
}

export interface InvoiceWithAdvances extends OpenInvoice {
  card_code: string;
  card_name: string;
  bp_type: "supplier" | "customer";
  invoice_kind: "PURCHASE" | "SALES";
  advances_count: number;
  advances_open_total: number;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const r = await authFetch("financial-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data as T;
}

export function useFinancialReview(companyDb: string | undefined) {
  const [items, setItems] = useState<AdvanceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    setError(null);
    try {
      const r = await call<{ items: AdvanceItem[] }>({ action: "list-advances", company_db: companyDb });
      setItems(r.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  const listOpenInvoices = useCallback(
    async (cardCode: string, bpType: "supplier" | "customer") => {
      if (!companyDb) throw new Error("Empresa não selecionada");
      const r = await call<{ items: OpenInvoice[] }>({
        action: "list-open-invoices",
        company_db: companyDb,
        card_code: cardCode,
        bp_type: bpType,
      });
      return r.items || [];
    },
    [companyDb],
  );

  const cancelPayment = useCallback(
    async (docType: AdvanceDocType, docEntry: number) => {
      if (!companyDb) throw new Error("Empresa não selecionada");
      await call({ action: "cancel-payment", company_db: companyDb, doc_type: docType, doc_entry: docEntry });
    },
    [companyDb],
  );

  const autoLink = useCallback(
    async (params: {
      docType: AdvanceDocType;
      docEntry: number;
      invoiceDocEntry: number;
      cardCode: string;
      amount?: number;
    }) => {
      if (!companyDb) throw new Error("Empresa não selecionada");
      const r = await call<{ ok: true; applied: number }>({
        action: "auto-link",
        company_db: companyDb,
        doc_type: params.docType,
        doc_entry: params.docEntry,
        invoice_doc_entry: params.invoiceDocEntry,
        card_code: params.cardCode,
        amount: params.amount,
      });
      return r;
    },
    [companyDb],
  );

  return { items, loading, error, refresh, listOpenInvoices, cancelPayment, autoLink };
}
