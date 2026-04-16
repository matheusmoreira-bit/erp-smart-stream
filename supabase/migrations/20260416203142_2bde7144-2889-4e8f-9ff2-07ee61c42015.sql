CREATE POLICY "Authenticated can read idp_user_mapping"
ON public.idp_user_mapping
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Anon can read idp_user_mapping"
ON public.idp_user_mapping
FOR SELECT
TO anon
USING (true);