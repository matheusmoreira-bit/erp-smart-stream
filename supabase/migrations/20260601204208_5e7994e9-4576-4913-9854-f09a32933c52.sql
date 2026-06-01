DROP POLICY IF EXISTS "Authenticated can read idp_user_mapping" ON public.idp_user_mapping;

CREATE POLICY "Admins read idp_user_mapping"
ON public.idp_user_mapping
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));