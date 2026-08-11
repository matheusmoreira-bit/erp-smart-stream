import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/lib/invoke-fn";
import { useSap } from "@/contexts/SapContext";
import type { Database } from "@/integrations/supabase/types";

export type PayQueueItem = Database["public"]["Tables"]["audit_pay_queue"]["Row"];
export type PayResult = Database["public"]["Tables"]["audit_pay_result"]["Row"];
export type PayFinding = Database["public"]["Tables"]["audit_pay_finding"]["Row"];
export type PayFraudSignal = Database["public"]["Tables"]["audit_pay_fraud_signal"]["Row"];
export type PayConfig = Database["public"]["Tables"]["audit_pay_config"]["Row"];
export type PaySeverity = Database["public"]["Enums"]["audit_pay_severity"];

export interface PayResultFilters {
  severity?: string;
  fornecedor?: string;
  solicitante?: string;
  projeto?: string;
  centroCusto?: string;
  dateFrom?: string;
  dateTo?: string;
  minValor?: number;
  maxValor?: number;
  findingType?: string;
  onlyFindings?: boolean;
}

function useCompanyDb() {
  const { session } = useSap();
  return session?.companyDB ?? "";
}

export function usePayResults(filters: PayResultFilters = {}, limit = 200) {
  const companyDB = useCompanyDb();
  return useQuery({
    queryKey: ["audit-pay", "results", companyDB, filters, limit],
    enabled: !!companyDB,
    staleTime: 15000,
    queryFn: async (): Promise<PayResult[]> => {
      let q = supabase
        .from("audit_pay_result")
        .select("*")
        .eq("company_db", companyDB)
        .order("audited_at", { ascending: false })
        .limit(limit);

      if (filters.severity) q = q.eq("overall_severity", filters.severity as PaySeverity);
      if (filters.onlyFindings) q = q.eq("has_findings", true);
      if (filters.fornecedor) q = q.or(`fornecedor_code.ilike.%${filters.fornecedor}%,fornecedor_name.ilike.%${filters.fornecedor}%`);
      if (filters.solicitante) q = q.ilike("solicitante", `%${filters.solicitante}%`);
      if (filters.projeto) q = q.ilike("projeto", `%${filters.projeto}%`);
      if (filters.centroCusto) q = q.ilike("centro_custo", `%${filters.centroCusto}%`);
      if (filters.dateFrom) q = q.gte("audited_at", filters.dateFrom);
      if (filters.dateTo) q = q.lte("audited_at", `${filters.dateTo}T23:59:59`);
      if (filters.minValor != null) q = q.gte("valor_pago", filters.minValor);
      if (filters.maxValor != null) q = q.lte("valor_pago", filters.maxValor);

      const { data, error } = await q;
      if (error) throw error;
      let rows = data ?? [];
      if (filters.findingType) {
        const { data: fs } = await supabase
          .from("audit_pay_finding")
          .select("audit_result_id")
          .eq("company_db", companyDB)
          .eq("finding_type", filters.findingType as PayFinding["finding_type"]);
        const ids = new Set((fs ?? []).map((f) => f.audit_result_id));
        rows = rows.filter((r) => ids.has(r.id));
      }
      return rows;
    },
  });
}

export function usePayResult(id: string | undefined) {
  const companyDB = useCompanyDb();
  return useQuery({
    queryKey: ["audit-pay", "result", id, companyDB],
    enabled: !!id && !!companyDB,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_pay_result")
        .select("*")
        .eq("id", id!)
        .eq("company_db", companyDB)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function usePayFindings(resultId: string | undefined) {
  const companyDB = useCompanyDb();
  return useQuery({
    queryKey: ["audit-pay", "findings", resultId, companyDB],
    enabled: !!resultId && !!companyDB,
    queryFn: async (): Promise<PayFinding[]> => {
      const { data, error } = await supabase
        .from("audit_pay_finding")
        .select("*")
        .eq("audit_result_id", resultId!)
        .eq("company_db", companyDB)
        .order("severity", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePayQueue(status?: string, limit = 200) {
  const companyDB = useCompanyDb();
  return useQuery({
    queryKey: ["audit-pay", "queue", companyDB, status, limit],
    enabled: !!companyDB,
    refetchInterval: 15000,
    queryFn: async (): Promise<PayQueueItem[]> => {
      let q = supabase
        .from("audit_pay_queue")
        .select("*")
        .eq("company_db", companyDB)
        .order("enqueued_at", { ascending: false })
        .limit(limit);
      if (status) q = q.eq("status", status as PayQueueItem["status"]);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePayFraudSignals(status?: string) {
  const companyDB = useCompanyDb();
  return useQuery({
    queryKey: ["audit-pay", "signals", companyDB, status],
    enabled: !!companyDB,
    queryFn: async (): Promise<PayFraudSignal[]> => {
      let q = supabase
        .from("audit_pay_fraud_signal")
        .select("*")
        .eq("company_db", companyDB)
        .order("detected_at", { ascending: false })
        .limit(300);
      if (status) q = q.eq("status", status as PayFraudSignal["status"]);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePayConfig() {
  const companyDB = useCompanyDb();
  return useQuery({
    queryKey: ["audit-pay", "config", companyDB],
    enabled: !!companyDB,
    queryFn: async (): Promise<PayConfig | null> => {
      const { data, error } = await supabase
        .from("audit_pay_config")
        .select("*")
        .eq("company_db", companyDB)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSavePayConfig() {
  const companyDB = useCompanyDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PayConfig>) => {
      const { error } = await supabase
        .from("audit_pay_config")
        .upsert({ ...patch, company_db: companyDB }, { onConflict: "company_db" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-pay", "config"] }),
  });
}

export function usePayDashboard(days = 30) {
  const companyDB = useCompanyDb();
  return useQuery({
    queryKey: ["audit-pay", "dashboard", companyDB, days],
    enabled: !!companyDB,
    staleTime: 30000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [{ data: results }, { data: signals }] = await Promise.all([
        supabase
          .from("audit_pay_result")
          .select("id, overall_severity, has_findings, valor_pago, valor_baseline, desvio_valor_abs, fornecedor_name, fornecedor_code, solicitante, projeto, centro_custo, audited_at")
          .eq("company_db", companyDB)
          .gte("audited_at", since)
          .limit(5000),
        supabase
          .from("audit_pay_fraud_signal")
          .select("id, severity, status")
          .eq("company_db", companyDB)
          .eq("status", "aberto"),
      ]);

      const rows = results ?? [];
      const bySeverity: Record<string, number> = {};
      const byVendor: Record<string, number> = {};
      const byRequester: Record<string, number> = {};
      const byProject: Record<string, number> = {};
      const byCostCenter: Record<string, number> = {};
      const byDay: Record<string, number> = {};
      let valorDivergente = 0;

      for (const r of rows) {
        bySeverity[r.overall_severity] = (bySeverity[r.overall_severity] ?? 0) + 1;
        if (r.has_findings) {
          const v = Math.abs(Number(r.desvio_valor_abs ?? 0));
          valorDivergente += v;
          const vendor = r.fornecedor_name || r.fornecedor_code || "—";
          byVendor[vendor] = (byVendor[vendor] ?? 0) + 1;
          byRequester[r.solicitante || "—"] = (byRequester[r.solicitante || "—"] ?? 0) + 1;
          byProject[r.projeto || "—"] = (byProject[r.projeto || "—"] ?? 0) + 1;
          byCostCenter[r.centro_custo || "—"] = (byCostCenter[r.centro_custo || "—"] ?? 0) + 1;
          const day = String(r.audited_at).slice(0, 10);
          byDay[day] = (byDay[day] ?? 0) + 1;
        }
      }

      const total = rows.length;
      const conformes = rows.filter((r) => !r.has_findings).length;
      return {
        total,
        conformes,
        pctConforme: total ? Math.round((conformes / total) * 100) : 0,
        bySeverity,
        byVendor,
        byRequester,
        byProject,
        byCostCenter,
        trend: Object.entries(byDay).sort().map(([date, count]) => ({ date, count })),
        valorDivergente,
        openSignals: (signals ?? []).length,
      };
    },
  });
}

export function useRunPayAudit() {
  const companyDB = useCompanyDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentRef: string; documentType?: string; baselineSource?: string }) => {
      const { data, error } = await invokeFn("audit-pay-worker", {
        body: {
          action: "run",
          company_db: companyDB,
          document_ref: input.documentRef,
          document_type: input.documentType ?? "ap_invoice",
          baseline_source: input.baselineSource ?? "erp_flow_approval",
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-pay"] }),
  });
}

export function useProcessPayQueue() {
  const companyDB = useCompanyDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (limit: number = 10) => {
      const { data, error } = await invokeFn("audit-pay-worker", {
        body: { action: "process_queue", company_db: companyDB, limit },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-pay"] }),
  });
}

export function useEnqueuePayAudit() {
  const companyDB = useCompanyDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (days: number = 30) => {
      const { data, error } = await invokeFn("audit-pay-enqueue", {
        body: { company_db: companyDB, days },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-pay", "queue"] }),
  });
}

export function useRunPayAgent() {
  const companyDB = useCompanyDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (days: number = 90) => {
      const { data, error } = await invokeFn("audit-pay-agent", {
        body: { company_db: companyDB, days },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-pay", "signals"] }),
  });
}

export function useRequeuePayItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("audit_pay_queue")
        .update({ status: "pending", error_message: null, started_at: null, finished_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-pay", "queue"] }),
  });
}

export function useUpdateSignalStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: PayFraudSignal["status"]; note?: string }) => {
      const { error } = await supabase
        .from("audit_pay_fraud_signal")
        .update({
          status: input.status,
          resolution_note: input.note ?? null,
          resolved_at: input.status === "aberto" ? null : new Date().toISOString(),
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-pay", "signals"] }),
  });
}
