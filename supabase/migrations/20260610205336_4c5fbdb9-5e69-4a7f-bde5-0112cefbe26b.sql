REVOKE INSERT ON public.pagcorp_integration_log FROM anon;
DROP POLICY IF EXISTS "Anon can insert pagcorp integration logs for SAP session flow" ON public.pagcorp_integration_log;