ALTER TABLE public.approver_substitutes
  ADD COLUMN IF NOT EXISTS cost_center_prefixes text[];

DROP FUNCTION IF EXISTS public.active_officials_for_substitute(text);
DROP FUNCTION IF EXISTS public.substitute_grants_for_me(text);

CREATE FUNCTION public.active_officials_for_substitute(_substitute_identifier text)
RETURNS TABLE (official_email text, official_name text, id uuid, ends_at timestamptz, company_db text, cost_center_prefixes text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.official_email, s.official_name, s.id, s.ends_at, s.company_db, s.cost_center_prefixes
  FROM public.approver_substitutes s
  WHERE s.revoked_at IS NULL
    AND s.starts_at <= now()
    AND s.ends_at   >  now()
    AND (
      lower(s.substitute_email) = lower(_substitute_identifier)
      OR lower(split_part(s.substitute_email, '@', 1)) = lower(_substitute_identifier)
    );
$$;

CREATE FUNCTION public.substitute_grants_for_me(_substitute_identifier text)
RETURNS TABLE (id uuid, official_email text, official_name text, starts_at timestamptz, ends_at timestamptz, company_db text, cost_center_prefixes text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.official_email, s.official_name, s.starts_at, s.ends_at, s.company_db, s.cost_center_prefixes
  FROM public.approver_substitutes s
  WHERE s.revoked_at IS NULL
    AND (
      lower(s.substitute_email) = lower(_substitute_identifier)
      OR lower(split_part(s.substitute_email, '@', 1)) = lower(_substitute_identifier)
    );
$$;

GRANT EXECUTE ON FUNCTION public.active_officials_for_substitute(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.substitute_grants_for_me(text) TO authenticated, anon, service_role;