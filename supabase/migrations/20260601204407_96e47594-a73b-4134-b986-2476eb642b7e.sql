-- 1. Admin-only reads on sensitive log/alert tables
DROP POLICY IF EXISTS "Authenticated read license_idle_alerts" ON public.license_idle_alerts;
DROP POLICY IF EXISTS "Authenticated read po_notification_sent" ON public.po_notification_sent;
DROP POLICY IF EXISTS "Authenticated can read pagcorp_integration_log" ON public.pagcorp_integration_log;
DROP POLICY IF EXISTS "Authenticated read user_licenses" ON public.user_licenses;

-- whatsapp_approval_alerts / whatsapp_login_alerts policy names unknown but typically "Authenticated read ..."
DROP POLICY IF EXISTS "Authenticated read whatsapp_approval_alerts" ON public.whatsapp_approval_alerts;
DROP POLICY IF EXISTS "Authenticated can read whatsapp_approval_alerts" ON public.whatsapp_approval_alerts;
DROP POLICY IF EXISTS "Authenticated read whatsapp_login_alerts" ON public.whatsapp_login_alerts;
DROP POLICY IF EXISTS "Authenticated can read whatsapp_login_alerts" ON public.whatsapp_login_alerts;

-- (Admin "manage" policies already exist and cover SELECT for admins)

-- 2. approval_rules / approval_rule_levels: lock writes to admins only
DROP POLICY IF EXISTS "Authenticated can insert approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Authenticated can update approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Authenticated can delete approval_rules" ON public.approval_rules;

DROP POLICY IF EXISTS "Authenticated can insert approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can update approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can delete approval_rule_levels" ON public.approval_rule_levels;

-- 3. approval_history: scope reads to participant or admin
DROP POLICY IF EXISTS "Authenticated can read approval_history" ON public.approval_history;

CREATE POLICY "Participants read approval_history"
ON public.approval_history
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR lower(coalesce(approver_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  OR lower(coalesce(requester_name, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  OR approver_code IN (
    SELECT sap_user_code FROM public.idp_user_mapping
    WHERE lower(idp_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       OR lower(sap_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  OR requester_code IN (
    SELECT sap_user_code FROM public.idp_user_mapping
    WHERE lower(idp_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       OR lower(sap_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);