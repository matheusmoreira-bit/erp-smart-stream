
CREATE OR REPLACE FUNCTION public.get_system_activity(_hours integer DEFAULT 24)
RETURNS TABLE(
  metric text,
  value bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since timestamptz := now() - make_interval(hours => _hours);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT 'expenses_created'::text, count(*)::bigint FROM public.expenses WHERE created_at >= _since
  UNION ALL
  SELECT 'expenses_integrated', count(*)::bigint FROM public.expenses WHERE sap_integrated_at >= _since
  UNION ALL
  SELECT 'approval_decisions', count(*)::bigint FROM public.expense_approval_log WHERE decided_at >= _since
  UNION ALL
  SELECT 'active_requesters', count(DISTINCT requester_email)::bigint FROM public.expenses WHERE created_at >= _since
  UNION ALL
  SELECT 'active_approvers', count(DISTINCT approver_email)::bigint FROM public.expense_approval_log WHERE decided_at >= _since
  UNION ALL
  SELECT 'sap_sync_runs', count(*)::bigint FROM public.expense_sap_sync_runs WHERE started_at >= _since
  UNION ALL
  SELECT 'sap_sync_errors', count(*)::bigint FROM public.expense_sap_sync_runs WHERE started_at >= _since AND status = 'error'
  UNION ALL
  SELECT 'pagcorp_integrations', count(*)::bigint FROM public.pagcorp_integration_log WHERE created_at >= _since
  UNION ALL
  SELECT 'nf_entrada_imports', count(*)::bigint FROM public.nf_entrada_imports WHERE created_at >= _since
  UNION ALL
  SELECT 'edge_calls', count(*)::bigint FROM public.edge_function_metrics WHERE occurred_at >= _since
  UNION ALL
  SELECT 'edge_errors', count(*)::bigint FROM public.edge_function_metrics WHERE occurred_at >= _since AND status >= 400
  UNION ALL
  SELECT 'retry_queue_pending', count(*)::bigint FROM public.sap_retry_queue WHERE status IN ('pending','retrying');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_system_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_system_activity(integer) TO authenticated, service_role;
