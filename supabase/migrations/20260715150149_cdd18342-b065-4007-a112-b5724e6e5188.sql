DROP POLICY IF EXISTS "SAP users module can read idp_user_mapping" ON public.idp_user_mapping;
REVOKE ALL ON public.idp_user_mapping FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.idp_user_mapping TO authenticated;
GRANT ALL ON public.idp_user_mapping TO service_role;