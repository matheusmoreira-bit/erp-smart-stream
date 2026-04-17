import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export type CriterionOperator =
  | "greater_than"
  | "less_than"
  | "between"
  | "equal"
  | "not_equal"
  | "contains"
  | "not_contains"
  | "like";

export const OPERATOR_LABELS: Record<CriterionOperator, string> = {
  greater_than: "Maior que",
  less_than: "Menor que",
  between: "No intervalo",
  equal: "Igual a",
  not_equal: "Diferente de",
  contains: "Contém",
  not_contains: "Não contém",
  like: "LIKE (wildcard)",
};

export const FIELD_OPTIONS = [
  { value: "total_amount", label: "Valor Total" },
  { value: "cost_center", label: "Centro de Custo" },
  { value: "project", label: "Projeto" },
  { value: "requester_name", label: "Solicitante" },
  { value: "supplier_name", label: "Fornecedor" },
  { value: "doc_type", label: "Tipo de Documento" },
  { value: "currency", label: "Moeda" },
];

export interface RuleCriterion {
  field: string;
  operator: CriterionOperator;
  value: string;
  value2?: string; // for "between"
}

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
  criteria: RuleCriterion[];
  created_by: string;
  created_at: string;
  updated_at: string;
  company_db: string | null;
  levels: ApprovalRuleLevel[];
}

export interface CreateRuleInput {
  name: string;
  priority?: number;
  criteria: RuleCriterion[];
  levels: Omit<ApprovalRuleLevel, "id">[];
}

export function useApprovalRules() {
  const { session } = useSap();
  const activeCompanyDb = session?.companyDB || null;
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Scope rules to the active company. If there is no session, return nothing
      // instead of leaking other companies' rules.
      if (!activeCompanyDb) {
        setRules([]);
        return;
      }

      const { data, error: err } = await supabase
        .from("approval_rules")
        .select("*")
        .eq("company_db", activeCompanyDb)
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
          criteria: Array.isArray(r.criteria) ? r.criteria : [],
          levels: levelsMap[r.id] || [],
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar regras");
    } finally {
      setIsLoading(false);
    }
  }, [activeCompanyDb]);

  const createRule = useCallback(
    async (input: CreateRuleInput, createdBy: string) => {
      if (!activeCompanyDb) {
        throw new Error("Selecione uma empresa antes de criar uma regra");
      }
      const { data: rule, error: err } = await supabase
        .from("approval_rules")
        .insert({
          name: input.name,
          priority: input.priority || 0,
          criteria: input.criteria as any,
          created_by: createdBy,
          company_db: activeCompanyDb,
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
    [fetchRules, activeCompanyDb]
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
