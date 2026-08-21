GRANT INSERT, UPDATE ON public.sap_cache TO authenticated;

CREATE POLICY "Authenticated can insert sap_cache for allowed company"
ON public.sap_cache
FOR INSERT
TO authenticated
WITH CHECK (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

CREATE POLICY "Authenticated can update sap_cache for allowed company"
ON public.sap_cache
FOR UPDATE
TO authenticated
USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db))
WITH CHECK (public.is_email_allowed_for_company(public.current_auth_email(), company_db));