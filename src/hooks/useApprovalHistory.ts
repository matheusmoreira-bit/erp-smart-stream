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
  /** Fonte da decisão: 'sap' = SAP Approval Hub, 'erp_flow' = fluxo interno */
  source?: "sap" | "erp_flow";
  /** Preenchido apenas para rows internos (permite abrir o mapa de relações) */
  expense_id?: string | null;
  /** Rastreabilidade: quando a decisão foi tomada por um substituto autorizado */
  substituted_for_email?: string | null;
  substituted_for_name?: string | null;
  substitution_id?: string | null;
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
      // 1) Aprovações SAP (approval_history)
      let q = supabase
        .from("approval_history")
        .select("*")
        .order("decision_date", { ascending: false, nullsFirst: false })
        .limit(2000);
      if (companyDb) q = q.eq("company_db", companyDb);
      const { data: sapRows, error: sapErr } = await q;
      if (sapErr) throw sapErr;

      // 2) Aprovações internas do ERP Flow (expense_approval_log)
      //    Traz decisão 'approved'/'rejected' e enriquece com dados da despesa.
      let expensesQ = supabase
        .from("expenses")
        .select(
          "id, supplier_code, supplier_name, total_amount, currency, sap_doc_entry, sap_doc_num, doc_type, requester_name, requester_email, company_db, created_at",
        )
        .limit(5000);
      if (companyDb) expensesQ = expensesQ.eq("company_db", companyDb);
      const { data: expenses } = await expensesQ;
      const expensesById = new Map<string, any>((expenses || []).map((e: any) => [e.id, e]));

      let logQ = supabase
        .from("expense_approval_log")
        .select("*")
        .in("decision", ["approved", "rejected"])
        .order("decided_at", { ascending: false, nullsFirst: false })
        .limit(5000);
      const { data: logRows } = await logQ;

      const internalRows: ApprovalHistoryRow[] = ((logRows || []) as any[])
        .map((l) => {
          const e = expensesById.get(l.expense_id);
          if (!e) return null; // expense fora da company atual
          return {
            id: `log-${l.id}`,
            external_id: `erp-flow:${l.expense_id}:${l.level_order ?? 0}`,
            company_db: e.company_db,
            decision: l.decision === "approved" ? "Y" : "N",
            decision_date: l.decided_at || l.created_at,
            approver_code: l.approver_email || l.approver_name || null,
            approver_name: l.approver_name || null,
            approver_email: l.approver_email || null,
            requester_code: e.requester_email || null,
            requester_name: e.requester_name || null,
            doc_object_type: null,
            doc_type_name:
              e.doc_type === "sales" ? "Pedido de Venda (ERP Flow)" : "Pedido de Compra (ERP Flow)",
            doc_entry: typeof e.sap_doc_entry === "number" ? e.sap_doc_entry : null,
            doc_num: typeof e.sap_doc_num === "number" ? e.sap_doc_num : null,
            doc_total: Number(e.total_amount || 0),
            currency: e.currency || "BRL",
            card_code: e.supplier_code || null,
            card_name: e.supplier_name || null,
            remarks: l.remarks || null,
            stage_name: l.level_order ? `Nível ${l.level_order}` : null,
            step: l.level_order || null,
            synced_at: l.decided_at || l.created_at,
            source: "erp_flow" as const,
            expense_id: l.expense_id,
          } as ApprovalHistoryRow;
        })
        .filter(Boolean) as ApprovalHistoryRow[];

      // Dedupe: se a mesma decisão já existe no SAP para o mesmo doc_entry/company_db,
      // preserva a versão SAP (mais rica). Aqui só evita duplicação óbvia de par
      // (company_db, doc_entry, decision, step) quando o SAP já sincronizou.
      const sapKey = new Set(
        ((sapRows || []) as ApprovalHistoryRow[])
          .filter((r) => r.doc_entry != null)
          .map((r) => `${r.company_db}|${r.doc_entry}|${r.decision}|${r.step ?? 0}`),
      );
      const filteredInternal = internalRows.filter((r) => {
        if (r.doc_entry == null) return true;
        return !sapKey.has(`${r.company_db}|${r.doc_entry}|${r.decision}|${r.step ?? 0}`);
      });

      const merged = [
        ...((sapRows || []) as ApprovalHistoryRow[]).map((r) => ({ ...r, source: "sap" as const })),
        ...filteredInternal,
      ].sort((a, b) => {
        const da = a.decision_date ? new Date(a.decision_date).getTime() : 0;
        const db = b.decision_date ? new Date(b.decision_date).getTime() : 0;
        return db - da;
      });

      setRows(merged);

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
      const res = await sapFunctionFetch("approval-history-sync", { method: "POST" });
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
