CREATE OR REPLACE FUNCTION public.find_open_registration_duplicate(
  p_type text,
  p_tax_id text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_company_db text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  status text,
  requester_email text,
  requester_name text,
  due_at timestamptz,
  created_at timestamptz,
  already_linked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.title, r.status::text, r.requester_email, r.requester_name,
         r.due_at, r.created_at,
         (lower(r.requester_email) = current_auth_email()
          OR current_auth_email() = ANY (r.followers)) AS already_linked
  FROM public.registration_requests r
  WHERE r.request_type::text = p_type
    AND r.status::text NOT IN ('concluido', 'cancelado')
    AND (
      p_company_db IS NULL
      OR lower(coalesce(r.company_db, '')) = lower(p_company_db)
    )
    AND (
      (
        nullif(regexp_replace(coalesce(p_tax_id, ''), '\D', '', 'g'), '') IS NOT NULL
        AND regexp_replace(coalesce(r.federal_tax_id, ''), '\D', '', 'g')
            = regexp_replace(p_tax_id, '\D', '', 'g')
      )
      OR (
        nullif(btrim(coalesce(p_title, '')), '') IS NOT NULL
        AND lower(btrim(r.title)) = lower(btrim(p_title))
      )
    )
  ORDER BY r.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_open_registration_duplicate(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.find_open_registration_duplicate(text, text, text, text) TO authenticated;