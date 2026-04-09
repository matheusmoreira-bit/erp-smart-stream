import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ApprovalRuleLevel {
  id?: string;
  level_order: number;
  approver_name: string;
  approver_email?: string;
}

export interface ApprovalRule {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  min_value?: number | null;
  max_value?: number | null;
  cost_center?: string | null;
  project?: string | null;
  requester_pattern?: string | null;
  doc_type?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  levels: ApprovalRuleLevel[];
}

export interface CreateRuleInput {
  name: string;
  priority?: number;
  min_value?: number | null;
  max_value?: number | null;
  cost_center?: string | null;
  project?: string | null;
  requester_pattern?: string | null;
  doc_type?: string | null;
  levels: Omit<ApprovalRuleLevel, "id">[];
}

export function useApprovalRules() {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("approval_rules")
        .select("*")
        .order("priority", { ascending: false });
      if (err) throw err;

      const ruleIds = (data || []).map((r: any) => r.id);
      let levelsMap: Record<string, ApprovalRuleLevel[]> = {};
      if (ruleIds.length > 0) {
        const { data: levels } = await supabase
          .from("approval_rule_levels")
          .select("*")
          .in("rule_id", ruleIds)
          .order("level_order", { ascending: true });
        if (levels) {
          for (const lvl of levels as any[]) {
            if (!levelsMap[lvl.rule_id]) levelsMap[lvl.rule_id] = [];
            levelsMap[lvl.rule_id].push(lvl);
          }
        }
      }

      setRules(
        (data || []).map((r: any) => ({
          ...r,
          levels: levelsMap[r.id] || [],
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar regras");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createRule = useCallback(
    async (input: CreateRuleInput, createdBy: string) => {
      const { data: rule, error: err } = await supabase
        .from("approval_rules")
        .insert({
          name: input.name,
          priority: input.priority || 0,
          min_value: input.min_value ?? null,
          max_value: input.max_value ?? null,
          cost_center: input.cost_center || null,
          project: input.project || null,
          requester_pattern: input.requester_pattern || null,
          doc_type: input.doc_type || null,
          created_by: createdBy,
        })
        .select()
        .single();
      if (err) throw err;

      if (input.levels.length > 0) {
        const { error: lvlErr } = await supabase.from("approval_rule_levels").insert(
          input.levels.map((lvl) => ({
            rule_id: (rule as any).id,
            level_order: lvl.level_order,
            approver_name: lvl.approver_name,
            approver_email: lvl.approver_email || null,
          }))
        );
        if (lvlErr) throw lvlErr;
      }

      await fetchRules();
      return rule;
    },
    [fetchRules]
  );

  const toggleRule = useCallback(
    async (id: string, isActive: boolean) => {
      const { error: err } = await supabase
        .from("approval_rules")
        .update({ is_active: isActive })
        .eq("id", id);
      if (err) throw err;
      await fetchRules();
    },
    [fetchRules]
  );

  const deleteRule = useCallback(
    async (id: string) => {
      const { error: err } = await supabase
        .from("approval_rules")
        .delete()
        .eq("id", id);
      if (err) throw err;
      await fetchRules();
    },
    [fetchRules]
  );

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  return { rules, isLoading, error, refresh: fetchRules, createRule, toggleRule, deleteRule };
}
