import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";

export interface EmployeeIntegrationConfig {
  id: string;
  name: string;
  company_db: string;
  jumpcloud_organization_id: string | null;
  schedule_type: "manual" | "hourly" | "every_6h" | "every_12h" | "daily";
  preferred_hour: number | null;
  is_active: boolean;
  sync_inactive_users: boolean;
  sync_managers: boolean;
  default_department_code: string | null;
  default_branch_code: string | null;
  last_execution_at: string | null;
  last_execution_status: string | null;
  last_execution_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeSyncExecution {
  id: string;
  integration_config_id: string;
  company_db: string;
  execution_type: "manual" | "scheduled" | "simulate";
  status: "running" | "success" | "partial" | "error" | "cancelled";
  triggered_by_email: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  total_source: number;
  total_matched: number;
  total_created: number;
  total_updated: number;
  total_unchanged: number;
  total_inactivated: number;
  total_pending: number;
  total_errors: number;
  error_message: string | null;
}

export interface EmployeeSyncItem {
  id: string;
  execution_id: string;
  jumpcloud_user_id: string | null;
  sap_employee_id: number | null;
  employee_name: string | null;
  employee_email: string | null;
  department_source: string | null;
  department_target: string | null;
  result: string;
  message: string | null;
  changed_fields: string[];
  created_at: string;
}

export function isTstCompanyDb(db: string | null | undefined): boolean {
  return !!db && /^TST/i.test(db);
}

export function useEmployeeIntegrationConfigs() {
  return useQuery({
    queryKey: ["employee-integration-configs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_integration_config")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as EmployeeIntegrationConfig[];
    },
  });
}

export function useEmployeeSyncExecutions(configId: string | null) {
  return useQuery({
    queryKey: ["employee-sync-executions", configId],
    enabled: !!configId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_sync_execution")
        .select("*")
        .eq("integration_config_id", configId!)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as EmployeeSyncExecution[];
    },
  });
}

export function useEmployeeSyncItems(executionId: string | null) {
  return useQuery({
    queryKey: ["employee-sync-items", executionId],
    enabled: !!executionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_sync_item")
        .select("*")
        .eq("execution_id", executionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmployeeSyncItem[];
    },
  });
}

export function useSaveEmployeeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<EmployeeIntegrationConfig> & { id?: string }) => {
      const { id, ...rest } = input;
      if (id) {
        const { data, error } = await supabase
          .from("employee_integration_config")
          .update(rest)
          .eq("id", id)
          .select("*")
          .single();
        if (error) throw error;
        return data as EmployeeIntegrationConfig;
      }
      const { data, error } = await supabase
        .from("employee_integration_config")
        .insert(rest as never)
        .select("*")
        .single();
      if (error) throw error;
      return data as EmployeeIntegrationConfig;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employee-integration-configs"] }),
  });
}

export function useDeleteEmployeeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_integration_config").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employee-integration-configs"] }),
  });
}

export async function testJumpCloud(companyDb: string) {
  const r = await sapFunctionFetch("employees-sync-test-jumpcloud", {
    method: "POST",
    body: JSON.stringify({ company_db: companyDb }),
  });
  return await r.json();
}

export async function testSap(companyDb: string) {
  const r = await sapFunctionFetch("employees-sync-test-sap", {
    method: "POST",
    body: JSON.stringify({ company_db: companyDb }),
  });
  return await r.json();
}

export async function runEmployeeSync(input: {
  integration_config_id: string;
  mode: "execute" | "simulate";
}) {
  const r = await sapFunctionFetch("employees-sync-run", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return await r.json();
}
