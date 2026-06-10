GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_integration_log TO authenticated;
GRANT ALL ON public.pagcorp_integration_log TO service_role;
GRANT SELECT, INSERT ON public.pagcorp_integration_log TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

GRANT EXECUTE ON FUNCTION public.insert_audit_log(text, text, text, text, text, jsonb) TO authenticated, service_role;

DROP POLICY IF EXISTS "Anon can read pagcorp integration logs for SAP session flow" ON public.pagcorp_integration_log;
CREATE POLICY "Anon can read pagcorp integration logs for SAP session flow"
ON public.pagcorp_integration_log
FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Anon can insert pagcorp integration logs for SAP session flow" ON public.pagcorp_integration_log;
CREATE POLICY "Anon can insert pagcorp integration logs for SAP session flow"
ON public.pagcorp_integration_log
FOR INSERT
TO anon
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can insert pagcorp integration logs" ON public.pagcorp_integration_log;
CREATE POLICY "Authenticated can insert pagcorp integration logs"
ON public.pagcorp_integration_log
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read pagcorp integration logs" ON public.pagcorp_integration_log;
CREATE POLICY "Authenticated can read pagcorp integration logs"
ON public.pagcorp_integration_log
FOR SELECT
TO authenticated
USING (true);