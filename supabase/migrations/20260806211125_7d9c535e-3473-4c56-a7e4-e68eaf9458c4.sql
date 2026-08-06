CREATE OR REPLACE FUNCTION public.approvals_feed_bundle(_company_db text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pend AS (
    SELECT e.*
    FROM public.expenses e
    WHERE e.company_db = _company_db
      AND e.status = 'pendente_aprovacao'
    ORDER BY e.created_at DESC
    LIMIT 2000
  ),
  it AS (
    SELECT i.expense_id, jsonb_agg(to_jsonb(i)) AS items
    FROM public.expense_items i
    JOIN pend p ON p.id = i.expense_id
    GROUP BY i.expense_id
  ),
  att AS (
    SELECT a.expense_id,
           jsonb_agg(jsonb_build_object(
             'id', a.id, 'expense_id', a.expense_id, 'file_name', a.file_name,
             'file_path', a.file_path, 'file_size', a.file_size,
             'mime_type', a.mime_type, 'created_at', a.created_at)) AS attachments
    FROM public.expense_attachments a
    JOIN pend p ON p.id = a.expense_id
    GROUP BY a.expense_id
  ),
  lvl AS (
    SELECT p.id AS expense_id,
           jsonb_agg(jsonb_build_object('name', l.approver_name, 'email', l.approver_email)
                     ORDER BY l.level_order) AS level_approvers
    FROM pend p
    JOIN public.approval_rule_levels l
      ON l.rule_id = p.approval_rule_id
     AND l.level_order = COALESCE(p.current_level_order, 1)
    GROUP BY p.id
  )
  SELECT COALESCE(jsonb_agg(
           to_jsonb(p)
           || jsonb_build_object(
                'items', COALESCE(it.items, '[]'::jsonb),
                'attachments', COALESCE(att.attachments, '[]'::jsonb),
                'level_approvers', COALESCE(lvl.level_approvers, '[]'::jsonb))
         ), '[]'::jsonb)
  FROM pend p
  LEFT JOIN it ON it.expense_id = p.id
  LEFT JOIN att ON att.expense_id = p.id
  LEFT JOIN lvl ON lvl.expense_id = p.id;
$$;

REVOKE ALL ON FUNCTION public.approvals_feed_bundle(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approvals_feed_bundle(text) TO service_role;