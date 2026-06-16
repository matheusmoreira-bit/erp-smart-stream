GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
-- Allow inserts via RLS for any authenticated user (insert_audit_log is SECURITY DEFINER but direct inserts from edge funcs use service_role anyway)
CREATE POLICY "Authenticated can insert audit_log" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);