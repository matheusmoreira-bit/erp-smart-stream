
-- Backfill de conectores lógicos em regras legadas de aprovação.
-- Regras antigas não têm os campos `group`, `logic` e `groupLogic` nos critérios.
-- Convenções (idênticas à normalização feita no front):
--   * Todo critério ganha `group` = 0 quando ausente.
--   * Critérios da 2ª posição em diante ganham `logic` = "and" quando ausente.
--   * `groupLogic` só existe no primeiro critério de um grupo diferente do inicial;
--     como as regras legadas ficam todas no grupo 0, não é necessário criar.
UPDATE public.approval_rules AS r
SET criteria = sub.new_criteria,
    updated_at = now()
FROM (
  SELECT
    r2.id,
    jsonb_agg(
      CASE
        WHEN t.ord = 1 THEN
          CASE WHEN t.elem ? 'group'
               THEN t.elem
               ELSE t.elem || jsonb_build_object('group', 0)
          END
        ELSE
          (CASE WHEN t.elem ? 'group'
                THEN t.elem
                ELSE t.elem || jsonb_build_object('group', 0)
           END)
          ||
          (CASE WHEN t.elem ? 'logic'
                THEN '{}'::jsonb
                ELSE jsonb_build_object('logic', 'and')
           END)
      END
      ORDER BY t.ord
    ) AS new_criteria
  FROM public.approval_rules r2,
       LATERAL jsonb_array_elements(r2.criteria) WITH ORDINALITY AS t(elem, ord)
  WHERE jsonb_typeof(r2.criteria) = 'array'
    AND jsonb_array_length(r2.criteria) > 0
    AND (
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(r2.criteria) e
        WHERE NOT (e ? 'group')
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(r2.criteria) WITH ORDINALITY AS e2(elem2, ord2)
        WHERE ord2 > 1 AND NOT (elem2 ? 'logic')
      )
    )
  GROUP BY r2.id
) AS sub
WHERE r.id = sub.id;
