
CREATE OR REPLACE FUNCTION public.substitute_grants_for_me(_substitute_identifier text)
RETURNS TABLE(
  id uuid,
  official_email text,
  official_name text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  company_db text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id, s.official_email, s.official_name, s.starts_at, s.ends_at, s.company_db
  FROM public.approver_substitutes s
  WHERE s.revoked_at IS NULL
    AND (
      lower(s.substitute_email) = lower(_substitute_identifier)
      OR lower(split_part(s.substitute_email, '@', 1)) = lower(_substitute_identifier)
    );
$function$;

GRANT EXECUTE ON FUNCTION public.substitute_grants_for_me(text) TO authenticated, anon;
