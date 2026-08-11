CREATE INDEX IF NOT EXISTS idx_audit_trail_actor_email_id ON public.audit_trail (actor_email, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_table_id ON public.audit_trail (table_name, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_op_id ON public.audit_trail (op, id DESC);

CREATE OR REPLACE FUNCTION public.audit_trail_filter_options()
RETURNS TABLE(tables text[], actors text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT coalesce(array_agg(t ORDER BY t), '{}') FROM (SELECT DISTINCT table_name AS t FROM public.audit_trail) s),
    (SELECT coalesce(array_agg(a ORDER BY a), '{}') FROM (SELECT DISTINCT actor_email AS a FROM public.audit_trail WHERE actor_email IS NOT NULL) s2);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_trail_filter_options() FROM public;
GRANT EXECUTE ON FUNCTION public.audit_trail_filter_options() TO authenticated;