import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import type { Database } from "@/integrations/supabase/types";

export type AuditRun = Database["public"]["Tables"]["audit_console_runs"]["Row"];
export type AuditDivergence = Database["public"]["Tables"]["audit_console_divergences"]["Row"];
export type AuditInsight = Database["public"]["Tables"]["audit_console_insights"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_console_logs"]["Row"];
export type AuditRule = Database["public"]["Tables"]["audit_console_rules"]["Row"];
export type AuditDocument = Database["public"]["Tables"]["audit_console_documents"]["Row"];

export function useAuditRuns(limit = 50) {
  const { session } = useSap();
  const companyDB = session?.companyDB ?? "";
  return useQuery({
    queryKey: ["audit-console", "runs", companyDB, limit],
    enabled: !!companyDB,
    refetchInterval: 5000,
    queryFn: async (): Promise<AuditRun[]> => {
      const { data, error } = await supabase
        .from("audit_console_runs")
        .select("*")
        .eq("company_db", companyDB)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAuditRun(id: string | undefined) {
  const { session } = useSap();
  const companyDB = session?.companyDB ?? "";
  return useQuery({
    queryKey: ["audit-console", "run", id],
    enabled: !!id && !!companyDB,
    refetchInterval: (q) => {
      const status = (q.state.data as AuditRun | null | undefined)?.status;
      return status === "pending" || status === "running" ? 2500 : false;
    },
    queryFn: async (): Promise<AuditRun | null> => {
      const { data, error } = await supabase
        .from("audit_console_runs")
        .select("*")
        .eq("id", id!)
        .eq("company_db", companyDB)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export interface DivergenceFilters {
  runId?: string;
  severity?: AuditDivergence["severity"];
  type?: AuditDivergence["divergence_type"];
  cardCode?: string;
  fraudOnly?: boolean;
  limit?: number;
}

export function useAuditDivergences(filters: DivergenceFilters = {}) {
  const { session } = useSap();
  const companyDB = session?.companyDB ?? "";
  return useQuery({
    queryKey: ["audit-console", "divergences", companyDB, filters],
    enabled: !!companyDB,
    queryFn: async (): Promise<AuditDivergence[]> => {
      let q = supabase
        .from("audit_console_divergences")
        .select("*")
        .eq("company_db", companyDB)
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 200);
      if (filters.runId) q = q.eq("audit_run_id", filters.runId);
      if (filters.severity) q = q.eq("severity", filters.severity);
      if (filters.type) q = q.eq("divergence_type", filters.type);
      if (filters.cardCode) q = q.ilike("card_code", `%${filters.cardCode}%`);
      if (filters.fraudOnly) q = q.eq("is_fraud_flag", true);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAuditInsights(runId?: string, limit = 20) {
  const { session } = useSap();
  const companyDB = session?.companyDB ?? "";
  return useQuery({
    queryKey: ["audit-console", "insights", companyDB, runId, limit],
    enabled: !!companyDB,
    queryFn: async (): Promise<AuditInsight[]> => {
      let q = supabase
        .from("audit_console_insights")
        .select("*")
        .eq("company_db", companyDB)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (runId) q = q.eq("audit_run_id", runId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAuditLogs(runId?: string, limit = 200) {
  const { session } = useSap();
  const companyDB = session?.companyDB ?? "";
  return useQuery({
    queryKey: ["audit-console", "logs", companyDB, runId, limit],
    enabled: !!companyDB,
    queryFn: async (): Promise<AuditLog[]> => {
      let q = supabase
        .from("audit_console_logs")
        .select("*")
        .eq("company_db", companyDB)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (runId) q = q.eq("audit_run_id", runId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAuditRules() {
  const { session } = useSap();
  const companyDB = session?.companyDB ?? "";
  return useQuery({
    queryKey: ["audit-console", "rules", companyDB],
    enabled: !!companyDB,
    queryFn: async (): Promise<AuditRule[]> => {
      const { data, error } = await supabase
        .from("audit_console_rules")
        .select("*")
        .or(`company_db.eq.${companyDB},company_db.is.null`)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface DashboardMetrics {
  totalRuns: number;
  runsLast30d: number;
  runningCount: number;
  totalDivergences: number;
  openDivergences: number;
  fraudFlags: number;
  criticalCount: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  trend: { date: string; count: number }[];
}

export function useAuditDashboard() {
  const { session } = useSap();
  const companyDB = session?.companyDB ?? "";
  return useQuery({
    queryKey: ["audit-console", "dashboard", companyDB],
    enabled: !!companyDB,
    queryFn: async (): Promise<DashboardMetrics> => {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 30);
      const sinceIso = sinceDate.toISOString();

      const [runsRes, divsRes] = await Promise.all([
        supabase
          .from("audit_console_runs")
          .select("id,status,started_at,total_divergences,total_fraud_flags")
          .eq("company_db", companyDB)
          .order("started_at", { ascending: false })
          .limit(500),
        supabase
          .from("audit_console_divergences")
          .select("id,severity,divergence_type,is_fraud_flag,is_reviewed,created_at")
          .eq("company_db", companyDB)
          .gte("created_at", sinceIso)
          .limit(2000),
      ]);
      if (runsRes.error) throw runsRes.error;
      if (divsRes.error) throw divsRes.error;

      const runs = runsRes.data ?? [];
      const divs = divsRes.data ?? [];

      const bySeverity: Record<string, number> = {};
      const byType: Record<string, number> = {};
      const trendMap = new Map<string, number>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendMap.set(d.toISOString().slice(0, 10), 0);
      }
      for (const d of divs) {
        bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
        byType[d.divergence_type] = (byType[d.divergence_type] ?? 0) + 1;
        const day = d.created_at.slice(0, 10);
        if (trendMap.has(day)) trendMap.set(day, (trendMap.get(day) ?? 0) + 1);
      }

      return {
        totalRuns: runs.length,
        runsLast30d: runs.filter((r) => r.started_at >= sinceIso).length,
        runningCount: runs.filter((r) => r.status === "pending").length,
        totalDivergences: divs.length,
        openDivergences: divs.filter((d) => !d.is_reviewed).length,
        fraudFlags: divs.filter((d) => d.is_fraud_flag).length,
        criticalCount: divs.filter((d) => d.severity === "critical").length,
        bySeverity,
        byType,
        trend: Array.from(trendMap.entries()).map(([date, count]) => ({ date, count })),
      };
    },
  });
}
