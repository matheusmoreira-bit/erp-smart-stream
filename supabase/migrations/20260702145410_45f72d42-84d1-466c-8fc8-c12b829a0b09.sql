
-- 1) Permitir leitura anônima das regras (o app usa sessão SAP, não Supabase Auth)
GRANT SELECT ON public.approval_rules TO anon;
GRANT SELECT ON public.approval_rule_levels TO anon;

DROP POLICY IF EXISTS "Anon can read approval_rules" ON public.approval_rules;
CREATE POLICY "Anon can read approval_rules"
ON public.approval_rules FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Anon can read approval_rule_levels" ON public.approval_rule_levels;
CREATE POLICY "Anon can read approval_rule_levels"
ON public.approval_rule_levels FOR SELECT
TO anon
USING (true);

-- 2) Reprocessar despesas pendentes sem regra vinculada
WITH candidates AS (
  SELECT
    e.id            AS expense_id,
    ar.id           AS rule_id,
    ar.priority
  FROM public.expenses e
  JOIN public.approval_rules ar
    ON ar.company_db = e.company_db
   AND ar.is_active = true
   AND (ar.doc_type IS NULL OR ar.doc_type = 'both' OR ar.doc_type = e.doc_type::text)
  WHERE e.status = 'pendente_aprovacao'
    AND e.approval_rule_id IS NULL
    AND e.cost_center IS NOT NULL
    AND e.cost_center <> ''
    -- Todo critério da regra precisa bater (suportamos cost_center + total_amount)
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(ar.criteria) c
      WHERE (c->>'field') NOT IN ('cost_center','total_amount')
    )
    AND (
      SELECT bool_and(
        CASE
          WHEN c->>'field' = 'cost_center' AND c->>'operator' = 'equal'
            THEN e.cost_center = c->>'value'
          WHEN c->>'field' = 'total_amount' AND c->>'operator' = 'between'
            THEN e.total_amount >= (c->>'value')::numeric
             AND e.total_amount <= (c->>'value2')::numeric
          WHEN c->>'field' = 'total_amount' AND c->>'operator' = 'greater_than'
            THEN e.total_amount > (c->>'value')::numeric
          WHEN c->>'field' = 'total_amount' AND c->>'operator' = 'less_than'
            THEN e.total_amount < (c->>'value')::numeric
          WHEN c->>'field' = 'total_amount' AND c->>'operator' = 'equal'
            THEN e.total_amount = (c->>'value')::numeric
          ELSE false
        END
      )
      FROM jsonb_array_elements(ar.criteria) c
    )
),
best AS (
  SELECT DISTINCT ON (expense_id)
    expense_id, rule_id
  FROM candidates
  ORDER BY expense_id, priority DESC
),
first_lvl AS (
  SELECT DISTINCT ON (rule_id)
    rule_id, approver_name, approver_email
  FROM public.approval_rule_levels
  ORDER BY rule_id, level_order ASC
)
UPDATE public.expenses e
SET approval_rule_id = b.rule_id,
    current_approver = fl.approver_name
FROM best b
LEFT JOIN first_lvl fl ON fl.rule_id = b.rule_id
WHERE e.id = b.expense_id;
