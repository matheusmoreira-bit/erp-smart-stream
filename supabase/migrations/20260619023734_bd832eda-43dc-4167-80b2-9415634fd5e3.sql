
-- Colapsa níveis consecutivos do mesmo aprovador em cada regra de aprovação,
-- e reordena level_order para 1..N por regra.
WITH ranked AS (
  SELECT
    id,
    rule_id,
    level_order,
    approver_name,
    approver_email,
    LAG(COALESCE(LOWER(NULLIF(TRIM(approver_email), '')), 'name:' || LOWER(TRIM(approver_name))))
      OVER (PARTITION BY rule_id ORDER BY level_order) AS prev_key,
    COALESCE(LOWER(NULLIF(TRIM(approver_email), '')), 'name:' || LOWER(TRIM(approver_name))) AS cur_key
  FROM public.approval_rule_levels
),
to_delete AS (
  SELECT id FROM ranked WHERE prev_key IS NOT NULL AND prev_key = cur_key
)
DELETE FROM public.approval_rule_levels
WHERE id IN (SELECT id FROM to_delete);

-- Renumera level_order para 1..N por regra mantendo a ordem original.
WITH renum AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY rule_id ORDER BY level_order, id) AS new_order
  FROM public.approval_rule_levels
)
UPDATE public.approval_rule_levels l
SET level_order = r.new_order
FROM renum r
WHERE l.id = r.id AND l.level_order <> r.new_order;
