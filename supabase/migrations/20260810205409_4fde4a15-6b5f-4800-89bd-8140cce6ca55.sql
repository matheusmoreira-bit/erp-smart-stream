CREATE OR REPLACE FUNCTION public.get_flow_user_productivity(
  _company_db text DEFAULT NULL,
  _days integer DEFAULT 180
)
RETURNS TABLE(
  user_email text,
  user_name text,
  department text,
  doc_type text,
  periodo text,
  docs_criados integer,
  valor_total numeric,
  docs_cancelados integer,
  edicoes_feitas integer,
  docs_editados_unicos integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH me AS (
    SELECT lower(coalesce((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '')) AS email,
           public.has_role(auth.uid(), 'admin'::app_role) AS is_admin
  ),
  params AS (
    SELECT now() - (greatest(coalesce(_days, 180), 1) || ' days')::interval AS since
  ),
  base AS (
    SELECT e.id,
           lower(coalesce(nullif(e.created_by_email, ''), e.requester_email, 'sem-usuario')) AS user_email,
           coalesce(nullif(e.requester_name, ''), e.created_by_email, e.requester_email, 'Sem usuário') AS user_name,
           coalesce(nullif(e.doc_type, ''), 'purchase') AS doc_type,
           to_char(coalesce(e.doc_date::timestamptz, e.created_at), 'YYYY-MM') AS periodo,
           coalesce(e.total_amount, 0) AS total_amount,
           (e.status = 'cancelado'::expense_status) AS cancelled
    FROM public.expenses e, me, params
    WHERE e.created_at >= params.since
      AND (_company_db IS NULL OR e.company_db = _company_db)
      AND (
        me.is_admin
        OR lower(coalesce(e.created_by_email, '')) = me.email
        OR lower(coalesce(e.requester_email, '')) = me.email
      )
  ),
  edits AS (
    SELECT a.expense_id, count(*)::int AS n
    FROM public.expense_audit_log a
    WHERE a.expense_id IN (SELECT id FROM base)
      AND a.action IN ('expense_updated', 'expense_patched', 'sap_pullback', 'expense_edit')
    GROUP BY a.expense_id
  ),
  joined AS (
    SELECT b.*, coalesce(ed.n, 0) AS edit_count
    FROM base b
    LEFT JOIN edits ed ON ed.expense_id = b.id
  ),
  grp AS (
    SELECT lower(uga.sap_email) AS email, min(pg.name) AS group_name
    FROM public.user_group_assignments uga
    JOIN public.permission_groups pg ON pg.id = uga.group_id
    GROUP BY lower(uga.sap_email)
  )
  SELECT j.user_email,
         min(j.user_name) AS user_name,
         coalesce(g.group_name, 'Sem grupo (Flow)') AS department,
         j.doc_type,
         j.periodo,
         count(*)::int AS docs_criados,
         sum(j.total_amount)::numeric AS valor_total,
         count(*) FILTER (WHERE j.cancelled)::int AS docs_cancelados,
         sum(j.edit_count)::int AS edicoes_feitas,
         count(*) FILTER (WHERE j.edit_count > 0)::int AS docs_editados_unicos
  FROM joined j
  LEFT JOIN grp g ON g.email = j.user_email
  GROUP BY j.user_email, coalesce(g.group_name, 'Sem grupo (Flow)'), j.doc_type, j.periodo
$function$;

REVOKE ALL ON FUNCTION public.get_flow_user_productivity(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_flow_user_productivity(text, integer) TO authenticated;