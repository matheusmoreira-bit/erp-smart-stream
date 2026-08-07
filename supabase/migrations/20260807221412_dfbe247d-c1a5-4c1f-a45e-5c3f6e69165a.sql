WITH seg AS (
  SELECT s.id, s.expense_id, s.cost_center, s.project, s.amount, r.name AS rule_name,
         (SELECT bool_or(
             CASE WHEN lower(s.cost_center) = lower(c->>'value') THEN true
                  WHEN (c->>'value') LIKE '%\%%' AND lower(s.cost_center) LIKE lower(c->>'value') THEN true
                  ELSE false END)
          FROM jsonb_array_elements(COALESCE(r.criteria, '[]'::jsonb)) c
          WHERE c->>'field' = 'cost_center') AS covered
  FROM public.expense_approval_segments s
  JOIN public.approval_rules r ON r.id = s.rule_id
  WHERE s.resolution = 'direct' AND COALESCE(s.cost_center,'') <> ''
)
UPDATE public.expense_approval_segments t
SET resolution = 'branch_fallback',
    rule_name = seg.rule_name,
    fallback_branch = array_to_string((string_to_array(seg.cost_center, '.'))[1:2], '.'),
    resolution_note = 'O centro de custo ' || seg.cost_center ||
      ' não possui alçada própria cadastrada. Foi aplicada a alçada do ramo ' ||
      array_to_string((string_to_array(seg.cost_center, '.'))[1:2], '.') ||
      ' (regra "' || seg.rule_name || '"), compatível com o valor do segmento.'
FROM seg
WHERE t.id = seg.id AND COALESCE(seg.covered, false) = false;

UPDATE public.expense_approval_segments t
SET rule_name = r.name
FROM public.approval_rules r
WHERE r.id = t.rule_id AND t.rule_name IS NULL;

INSERT INTO public.expense_approval_log (expense_id, decision, approver_name, approver_email, remarks)
SELECT s.expense_id, 'routing_fallback', s.current_approver, s.current_approver_email,
       'Segmento ' || COALESCE(s.cost_center,'sem CC') || COALESCE(' | ' || s.project, '') || ' — ' || s.resolution_note
FROM public.expense_approval_segments s
WHERE s.resolution <> 'direct'
  AND s.resolution_note IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.expense_approval_log l
    WHERE l.expense_id = s.expense_id AND l.decision = 'routing_fallback'
      AND l.remarks LIKE '%' || COALESCE(s.cost_center,'sem CC') || '%'
  );