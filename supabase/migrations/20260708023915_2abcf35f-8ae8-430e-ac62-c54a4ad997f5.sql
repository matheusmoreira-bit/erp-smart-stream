CREATE POLICY "Anyone can view expense audit_log" ON public.audit_log FOR SELECT TO anon, authenticated USING (entity_type = 'expense');
GRANT SELECT ON public.audit_log TO anon;