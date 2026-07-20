
-- Feature flag: require IdP binding
INSERT INTO public.feature_flags (key, enabled, description)
VALUES ('require_idp_binding', false,
        'Quando ligado, bloqueia login de usuários sem vínculo em idp_user_mapping (JumpCloud/Google). Admins de backoffice sempre passam.')
ON CONFLICT (key) DO NOTHING;

-- Helper: is the given email currently linked to an IdP identity?
CREATE OR REPLACE FUNCTION public.is_idp_linked(_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.idp_user_mapping m
    WHERE lower(coalesce(m.idp_email, '')) = lower(coalesce(_email, ''))
      AND (
        (m.idp_provider = 'jumpcloud' AND m.status = 'linked')
        OR m.idp_provider = 'google'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_idp_linked(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_idp_linked(text) TO anon, authenticated, service_role;

-- Helper: is the enforcement flag on?
CREATE OR REPLACE FUNCTION public.require_idp_binding_enabled()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT enabled FROM public.feature_flags WHERE key = 'require_idp_binding' AND scope = 'global'),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.require_idp_binding_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_idp_binding_enabled() TO anon, authenticated, service_role;
