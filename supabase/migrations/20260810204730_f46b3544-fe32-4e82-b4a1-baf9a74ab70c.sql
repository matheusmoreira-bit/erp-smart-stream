CREATE OR REPLACE FUNCTION public.get_flow_user_activity(
  _company_db text DEFAULT NULL,
  _days integer DEFAULT 30,
  _limit integer DEFAULT 1000
)
RETURNS TABLE (
  ts timestamptz,
  actor_email text,
  actor_name text,
  action text,
  entity_type text,
  entity_id text,
  company_db text,
  detail text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT lower(coalesce((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '')) AS email,
           public.has_role(auth.uid(), 'admin'::app_role) AS is_admin
  ),
  params AS (
    SELECT now() - (greatest(coalesce(_days, 30), 1) || ' days')::interval AS since,
           least(greatest(coalesce(_limit, 1000), 1), 5000) AS lim
  ),
  created AS (
    SELECT e.created_at AS ts,
           lower(coalesce(nullif(e.created_by_email, ''), e.requester_email, '')) AS actor_email,
           coalesce(e.requester_name, e.created_by_email, e.requester_email) AS actor_name,
           'flow_document_created'::text AS action,
           coalesce(e.doc_type, 'expense')::text AS entity_type,
           e.id::text AS entity_id,
           e.company_db,
           coalesce(e.supplier_name, '') || ' · ' || coalesce(e.currency, '') || ' ' || coalesce(e.total_amount, 0)::text AS detail
    FROM public.expenses e
    WHERE e.created_at >= (SELECT since FROM params)
      AND (_company_db IS NULL OR e.company_db = _company_db)
  ),
  decisions AS (
    SELECT l.decided_at AS ts,
           lower(coalesce(l.approver_email, '')) AS actor_email,
           coalesce(l.approver_name, l.approver_email) AS actor_name,
           ('flow_' || l.decision)::text AS action,
           coalesce(e.doc_type, 'expense')::text AS entity_type,
           l.expense_id::text AS entity_id,
           e.company_db,
           coalesce(l.remarks, '') AS detail
    FROM public.expense_approval_log l
    JOIN public.expenses e ON e.id = l.expense_id
    WHERE l.decided_at >= (SELECT since FROM params)
      AND (_company_db IS NULL OR e.company_db = _company_db)
  ),
  admin_actions AS (
    SELECT a.created_at AS ts,
           lower(coalesce(a.actor_email, '')) AS actor_email,
           a.actor_email AS actor_name,
           ('flow_' || a.action)::text AS action,
           a.entity_type,
           a.entity_id,
           a.company_db,
           coalesce(a.details::text, '') AS detail
    FROM public.audit_log a
    WHERE a.created_at >= (SELECT since FROM params)
      AND (_company_db IS NULL OR a.company_db IS NULL OR a.company_db = _company_db)
  ),
  unioned AS (
    SELECT * FROM created
    UNION ALL SELECT * FROM decisions
    UNION ALL SELECT * FROM admin_actions
  )
  SELECT u.ts, u.actor_email, u.actor_name, u.action, u.entity_type, u.entity_id, u.company_db, u.detail
  FROM unioned u, me
  WHERE u.actor_email <> ''
    AND (me.is_admin OR u.actor_email = me.email)
  ORDER BY u.ts DESC
  LIMIT (SELECT lim FROM params);
$$;

REVOKE ALL ON FUNCTION public.get_flow_user_activity(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_flow_user_activity(text, integer, integer) TO authenticated;