import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TemporalMetrics {
  // SAP nativo: rascunho/aprovação inicial -> PO gerado
  sapNativeAvgHours: number | null;
  sapNativeSamples: number;
  sapNativeMedianHours: number | null;
  // ERP Flow: criação da expense -> integração ao SAP
  flowAvgHours: number | null;
  flowSamples: number;
  flowMedianHours: number | null;
  // ERP Flow: criação -> aprovação final (sem contar integração)
  flowApprovalAvgHours: number | null;
  flowApprovalSamples: number;
  // Ciclo: PO -> NF entrada
  poToNfAvgDays: number | null;
  poToNfSamples: number;
  // Ciclo: NF entrada -> Pagamento
  nfToPayAvgDays: number | null;
  nfToPaySamples: number;
  // Ciclo end-to-end (Flow) por doc
  totalCycleFlowAvgDays: number | null;
  // Reduções computadas
  reducaoAprovacaoPercent: number | null;
}

interface Options {
  companyDb?: string;
  from?: Date;
  to?: Date;
  consolidated?: boolean;
}

interface ExpenseTiming {
  id: string;
  company_db: string;
  created_at: string;
  sap_doc_entry: number | null;
}

interface ApprovalLogRow {
  expense_id: string;
  decision: string;
  decided_at: string;
}

interface ApprovalHistoryRow {
  company_db: string;
  doc_entry: number | null;
  decision: string | null;
  decision_date: string | null;
}

interface PoRow {
  company_db: string;
  doc_entry: number;
  doc_date: string | null;
}

interface NfRow {
  company_db: string;
  doc_entry: number;
  doc_date: string | null;
  base_po_doc_entry: number | null;
}

interface PayRow {
  company_db: string;
  doc_entry: number;
  doc_date: string | null;
  invoice_links: any;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 86400 * 1000;

export function useTemporalAnalysis(opts: Options) {
  const { companyDb, from, to, consolidated } = opts;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseTiming[]>([]);
  const [logs, setLogs] = useState<ApprovalLogRow[]>([]);
  const [history, setHistory] = useState<ApprovalHistoryRow[]>([]);
  const [pos, setPos] = useState<PoRow[]>([]);
  const [nfs, setNfs] = useState<NfRow[]>([]);
  const [pays, setPays] = useState<PayRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = from?.toISOString();
      const toIso = to?.toISOString();

      // Paginação para superar o limite padrão do PostgREST (1000 linhas/resposta)
      const PAGE = 1000;
      async function fetchAll<T>(build: () => any): Promise<T[]> {
        const out: T[] = [];
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await build().range(offset, offset + PAGE - 1);
          if (error) throw error;
          const rows = (data || []) as T[];
          out.push(...rows);
          if (rows.length < PAGE) break;
          if (offset > 500000) break;
        }
        return out;
      }

      const buildExp = () => {
        let q = supabase.from("expenses").select("id, company_db, created_at, sap_doc_entry").order("created_at", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromIso) q = q.gte("created_at", fromIso);
        if (toIso) q = q.lte("created_at", toIso);
        return q;
      };
      const buildHist = () => {
        let q = supabase.from("approval_history").select("company_db, doc_entry, decision, decision_date").order("decision_date", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromIso) q = q.gte("decision_date", fromIso);
        if (toIso) q = q.lte("decision_date", toIso);
        return q;
      };
      const buildPo = () => {
        let q = supabase.from("sap_purchase_order_cache").select("company_db, doc_entry, doc_date").order("doc_date", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromIso) q = q.gte("doc_date", fromIso.slice(0, 10));
        if (toIso) q = q.lte("doc_date", toIso.slice(0, 10));
        return q;
      };
      const buildNf = () => {
        let q = supabase.from("sap_nf_entrada_cache").select("company_db, doc_entry, doc_date, base_po_doc_entry").order("doc_date", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromIso) q = q.gte("doc_date", fromIso.slice(0, 10));
        if (toIso) q = q.lte("doc_date", toIso.slice(0, 10));
        return q;
      };
      const buildPay = () => {
        let q = supabase.from("sap_vendor_payment_cache").select("company_db, doc_entry, doc_date, invoice_links").order("doc_date", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromIso) q = q.gte("doc_date", fromIso.slice(0, 10));
        if (toIso) q = q.lte("doc_date", toIso.slice(0, 10));
        return q;
      };

      const [expRows, histRows, poRows, nfRows, payRows] = await Promise.all([
        fetchAll<ExpenseTiming>(buildExp),
        fetchAll<ApprovalHistoryRow>(buildHist),
        fetchAll<PoRow>(buildPo),
        fetchAll<NfRow>(buildNf),
        fetchAll<PayRow>(buildPay),
      ]);

      setExpenses(expRows);
      setHistory(histRows);
      setPos(poRows);
      setNfs(nfRows);
      setPays(payRows);

      // logs em segundo passo (só IDs relevantes)
      const ids = expRows.map((e) => e.id);
      if (ids.length) {
        // paginar em blocos para evitar URL gigante
        const chunkSize = 200;
        const all: ApprovalLogRow[] = [];
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const { data, error: le } = await supabase
            .from("expense_approval_log")
            .select("expense_id, decision, decided_at")
            .in("expense_id", chunk);
          if (le) throw le;
          all.push(...((data || []) as ApprovalLogRow[]));
        }
        setLogs(all);
      } else {
        setLogs([]);
      }
    } catch (e: any) {
      console.error("useTemporalAnalysis load error", e);
      setError(e?.message || "Falha ao carregar análise temporal");
    } finally {
      setLoading(false);
    }
  }, [companyDb, from?.getTime(), to?.getTime(), consolidated]);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo<TemporalMetrics>(() => {
    // ---- SAP nativo: por (company_db, doc_entry) do approval_history
    const histIdx = new Map<string, { first: number; lastY: number | null }>();
    for (const h of history) {
      if (!h.doc_entry || !h.decision_date) continue;
      const key = `${h.company_db}::${h.doc_entry}`;
      const t = new Date(h.decision_date).getTime();
      const cur = histIdx.get(key) || { first: t, lastY: null };
      cur.first = Math.min(cur.first, t);
      if (h.decision === "Y") cur.lastY = cur.lastY == null ? t : Math.max(cur.lastY, t);
      histIdx.set(key, cur);
    }
    const sapNativeDurations: number[] = [];
    for (const { first, lastY } of histIdx.values()) {
      if (lastY != null && lastY > first) sapNativeDurations.push((lastY - first) / HOUR_MS);
    }

    // ---- ERP Flow: created_at -> integrated (fallback: approved mais tardio)
    const logByExpense = new Map<string, ApprovalLogRow[]>();
    for (const l of logs) {
      const arr = logByExpense.get(l.expense_id) || [];
      arr.push(l);
      logByExpense.set(l.expense_id, arr);
    }
    const flowDurations: number[] = [];
    const flowApprovalDurations: number[] = [];
    for (const e of expenses) {
      const arr = logByExpense.get(e.id) || [];
      if (!arr.length) continue;
      const createdMs = new Date(e.created_at).getTime();
      const integrated = arr
        .filter((l) => l.decision === "integrated")
        .map((l) => new Date(l.decided_at).getTime())
        .sort((a, b) => b - a)[0];
      const approvedTimes = arr
        .filter((l) => l.decision === "approved")
        .map((l) => new Date(l.decided_at).getTime());
      const lastApproved = approvedTimes.length ? Math.max(...approvedTimes) : null;

      if (lastApproved && lastApproved > createdMs) {
        flowApprovalDurations.push((lastApproved - createdMs) / HOUR_MS);
      }
      const endMs = integrated || lastApproved;
      if (endMs && endMs > createdMs && e.sap_doc_entry) {
        flowDurations.push((endMs - createdMs) / HOUR_MS);
      }
    }

    // ---- PO -> NF (via base_po_doc_entry)
    const poIdx = new Map<string, PoRow>();
    for (const p of pos) poIdx.set(`${p.company_db}::${p.doc_entry}`, p);
    const nfIdx = new Map<string, NfRow>();
    for (const n of nfs) nfIdx.set(`${n.company_db}::${n.doc_entry}`, n);

    const poToNf: number[] = [];
    for (const n of nfs) {
      if (!n.base_po_doc_entry || !n.doc_date) continue;
      const po = poIdx.get(`${n.company_db}::${n.base_po_doc_entry}`);
      if (!po?.doc_date) continue;
      const days = (new Date(n.doc_date).getTime() - new Date(po.doc_date).getTime()) / DAY_MS;
      if (days >= 0 && days < 365) poToNf.push(days);
    }

    // ---- NF -> Payment (invoice_links: array de objetos {DocEntry, InvoiceType} ou ids)
    const nfToPay: number[] = [];
    for (const p of pays) {
      if (!p.doc_date) continue;
      const links = Array.isArray(p.invoice_links) ? p.invoice_links : [];
      for (const link of links) {
        const nfDocEntry =
          typeof link === "number"
            ? link
            : typeof link === "object" && link
              ? (link.DocEntry ?? link.doc_entry ?? link.docEntry)
              : null;
        if (!nfDocEntry) continue;
        const nf = nfIdx.get(`${p.company_db}::${nfDocEntry}`);
        if (!nf?.doc_date) continue;
        const days = (new Date(p.doc_date).getTime() - new Date(nf.doc_date).getTime()) / DAY_MS;
        if (days >= 0 && days < 365) nfToPay.push(days);
      }
    }

    const sapAvg = mean(sapNativeDurations);
    const flowAvg = mean(flowDurations);
    const reducao =
      sapAvg && sapAvg > 0 && flowAvg != null ? ((sapAvg - flowAvg) / sapAvg) * 100 : null;

    return {
      sapNativeAvgHours: sapAvg,
      sapNativeSamples: sapNativeDurations.length,
      sapNativeMedianHours: median(sapNativeDurations),
      flowAvgHours: flowAvg,
      flowSamples: flowDurations.length,
      flowMedianHours: median(flowDurations),
      flowApprovalAvgHours: mean(flowApprovalDurations),
      flowApprovalSamples: flowApprovalDurations.length,
      poToNfAvgDays: mean(poToNf),
      poToNfSamples: poToNf.length,
      nfToPayAvgDays: mean(nfToPay),
      nfToPaySamples: nfToPay.length,
      totalCycleFlowAvgDays:
        flowAvg != null && mean(poToNf) != null && mean(nfToPay) != null
          ? flowAvg / 24 + (mean(poToNf) || 0) + (mean(nfToPay) || 0)
          : null,
      reducaoAprovacaoPercent: reducao,
    };
  }, [expenses, logs, history, pos, nfs, pays]);

  return { metrics, loading, error, refresh: load };
}
