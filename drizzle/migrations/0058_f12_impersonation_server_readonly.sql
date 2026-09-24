CREATE TABLE public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  admin_email text,
  target_user text NOT NULL,
  company_db text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '4 hours',
  ended_at timestamptz,
  end_reason text
);
GRANT ALL ON public.impersonation_sessions TO service_role;
GRANT SELECT ON public.impersonation_sessions TO authenticated;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own impersonation sessions readable" ON public.impersonation_sessions
  FOR SELECT TO authenticated USING (admin_user_id = auth.uid());
CREATE INDEX impersonation_sessions_active_idx ON public.impersonation_sessions(admin_user_id) WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.is_impersonating(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.impersonation_sessions
    WHERE admin_user_id = _user_id AND ended_at IS NULL AND expires_at > now()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_impersonating(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_impersonating(uuid) TO authenticated, service_role;

-- Trava no banco: durante a impersonação, nenhuma escrita direta do navegador passa.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity LOOP
    EXECUTE format('DROP POLICY IF EXISTS "f12_ro_impersonation_ins" ON public.%I', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS "f12_ro_impersonation_upd" ON public.%I', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS "f12_ro_impersonation_del" ON public.%I', r.relname);
    EXECUTE format('CREATE POLICY "f12_ro_impersonation_ins" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_impersonating()))', r.relname);
    EXECUTE format('CREATE POLICY "f12_ro_impersonation_upd" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (SELECT public.is_impersonating()))', r.relname);
    EXECUTE format('CREATE POLICY "f12_ro_impersonation_del" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (SELECT public.is_impersonating()))', r.relname);
  END LOOP;
END $$;