
CREATE OR REPLACE FUNCTION public.check_applicable_approval_rules(
  _company_db text,
  _total_amount numeric,
  _cost_center text DEFAULT NULL
)
RETURNS TABLE(has_rule boolean, rule_count integer, sample_rule_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_sample uuid;
BEGIN
  SELECT COUNT(*), MIN(id)
  INTO v_count, v_sample
  FROM public.approval_rules ar
  WHERE ar.is_active = true
    AND (ar.company_db IS NULL OR ar.company_db = _company_db)
    AND (ar.min_value IS NULL OR _total_amount >= ar.min_value)
    AND (ar.max_value IS NULL OR _total_amount <= ar.max_value)
    AND (ar.cost_center IS NULL OR _cost_center IS NULL OR ar.cost_center = _cost_center);

  RETURN QUERY SELECT (v_count > 0), COALESCE(v_count, 0), v_sample;
END;
$$;
