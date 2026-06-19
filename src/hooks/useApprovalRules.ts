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

export type RuleDocType = "purchase" | "sales" | "both";

export const DOC_TYPE_LABELS: Record<RuleDocType, string> = {
  purchase: "Compra",
  sales: "Venda",
  both: "Ambos",
};

export interface ApprovalRule {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  criteria: RuleCriterion[];
  doc_type: RuleDocType;
  created_by: string;
  created_at: string;
  updated_at: string;
  company_db: string | null;
  levels: ApprovalRuleLevel[];
}

export interface CreateRuleInput {
  name: string;
  priority?: number;
  doc_type?: RuleDocType;
  criteria: RuleCriterion[];
  levels: Omit<ApprovalRuleLevel, "id">[];
}

/**
 * Colapsa níveis consecutivos do mesmo aprovador em um único nível.
 * Match por e-mail (case-insensitive) quando presente; senão, pelo nome.
 * Reordena `level_order` para 1..N após o colapso.
 */
export function collapseConsecutiveApprovers(
  levels: Omit<ApprovalRuleLevel, "id">[],
): Omit<ApprovalRuleLevel, "id">[] {
  const sorted = [...levels].sort((a, b) => a.level_order - b.level_order);
  const key = (l: Omit<ApprovalRuleLevel, "id">) =>
    (l.approver_email || "").trim().toLowerCase() ||
    `name:${(l.approver_name || "").trim().toLowerCase()}`;
  const collapsed: Omit<ApprovalRuleLevel, "id">[] = [];
  let lastKey = "";
  for (const lvl of sorted) {
    const k = key(lvl);
    if (k && k === lastKey) continue;
    collapsed.push(lvl);
    lastKey = k;
  }
  return collapsed.map((lvl, i) => ({ ...lvl, level_order: i + 1 }));
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
          doc_type: (r.doc_type as RuleDocType) || "both",
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
          doc_type: input.doc_type || "both",
          created_by: createdBy,
          company_db: activeCompanyDb,
        })
        .select()
        .single();
      if (err) throw err;

      if (input.levels.length > 0) {
        const normalizedLevels = collapseConsecutiveApprovers(input.levels);
        const { error: lvlErr } = await supabase.from("approval_rule_levels").insert(
          normalizedLevels.map((lvl) => ({
            rule_id: (rule as any).id,
            level_order: lvl.level_order,
            approver_name: lvl.approver_name,
            approver_email: lvl.approver_email || null,
          }))
        );
        if (lvlErr) throw lvlErr;
      }

      await supabase.rpc("insert_audit_log", {
        p_action: "create_approval_rule",
        p_entity_type: "approval_rule",
        p_entity_id: (rule as any).id,
        p_actor_email: createdBy,
        p_company_db: activeCompanyDb,
        p_details: { name: input.name, doc_type: input.doc_type || "both" } as any,
      });

      await fetchRules();
      return rule;
    },
    [fetchRules, activeCompanyDb]
  );

  const updateRule = useCallback(
    async (id: string, input: CreateRuleInput, actor: string) => {
      const { error: err } = await supabase
        .from("approval_rules")
        .update({
          name: input.name,
          priority: input.priority || 0,
          criteria: input.criteria as any,
          doc_type: input.doc_type || "both",
        })
        .eq("id", id);
      if (err) throw err;

      // Replace levels
      const { error: delErr } = await supabase
        .from("approval_rule_levels")
        .delete()
        .eq("rule_id", id);
      if (delErr) throw delErr;

      if (input.levels.length > 0) {
        const { error: insErr } = await supabase.from("approval_rule_levels").insert(
          input.levels.map((lvl) => ({
            rule_id: id,
            level_order: lvl.level_order,
            approver_name: lvl.approver_name,
            approver_email: lvl.approver_email || null,
          }))
        );
        if (insErr) throw insErr;
      }

      await supabase.rpc("insert_audit_log", {
        p_action: "update_approval_rule",
        p_entity_type: "approval_rule",
        p_entity_id: id,
        p_actor_email: actor,
        p_company_db: activeCompanyDb,
        p_details: { name: input.name, doc_type: input.doc_type || "both" } as any,
      });

      await fetchRules();
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
      await supabase.rpc("insert_audit_log", {
        p_action: isActive ? "enable_approval_rule" : "disable_approval_rule",
        p_entity_type: "approval_rule",
        p_entity_id: id,
        p_company_db: activeCompanyDb,
        p_details: {} as any,
      });
      await fetchRules();
    },
    [fetchRules, activeCompanyDb]
  );

  const deleteRule = useCallback(
    async (id: string) => {
      const { error: err } = await supabase
        .from("approval_rules")
        .delete()
        .eq("id", id);
      if (err) throw err;
      await supabase.rpc("insert_audit_log", {
        p_action: "delete_approval_rule",
        p_entity_type: "approval_rule",
        p_entity_id: id,
        p_company_db: activeCompanyDb,
        p_details: {} as any,
      });
      await fetchRules();
    },
    [fetchRules, activeCompanyDb]
  );

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  return { rules, isLoading, error, refresh: fetchRules, createRule, updateRule, toggleRule, deleteRule };
}
