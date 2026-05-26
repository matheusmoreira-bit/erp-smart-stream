
-- approval_rule_levels
DROP POLICY IF EXISTS "Anon can delete approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can insert approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can read approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can update approval_rule_levels" ON public.approval_rule_levels;
REVOKE ALL ON public.approval_rule_levels FROM anon;

-- approval_rules
DROP POLICY IF EXISTS "Anon can delete approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can insert approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can read approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can update approval_rules" ON public.approval_rules;
REVOKE ALL ON public.approval_rules FROM anon;

-- audit_log
DROP POLICY IF EXISTS "Anon can insert audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Anon can read audit_log" ON public.audit_log;
REVOKE ALL ON public.audit_log FROM anon;
-- Restrict insert_audit_log execution
REVOKE EXECUTE ON FUNCTION public.insert_audit_log(text, text, text, text, text, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(text, text, text, text, text, jsonb) TO authenticated, service_role;

-- expense_attachments
DROP POLICY IF EXISTS "Anon can insert expense_attachments" ON public.expense_attachments;
DROP POLICY IF EXISTS "Anon can read expense_attachments" ON public.expense_attachments;
REVOKE ALL ON public.expense_attachments FROM anon;

-- expense_items
DROP POLICY IF EXISTS "Anon can delete expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can insert expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can read expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can update expense_items" ON public.expense_items;
REVOKE ALL ON public.expense_items FROM anon;

-- expenses
DROP POLICY IF EXISTS "Anon can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can update expenses" ON public.expenses;
REVOKE ALL ON public.expenses FROM anon;

-- idp_user_mapping
DROP POLICY IF EXISTS "Anon can read idp_user_mapping" ON public.idp_user_mapping;
REVOKE ALL ON public.idp_user_mapping FROM anon;

-- pagcorp_integration_log
DROP POLICY IF EXISTS "Anon can insert pagcorp_integration_log" ON public.pagcorp_integration_log;
DROP POLICY IF EXISTS "Anon can read pagcorp_integration_log" ON public.pagcorp_integration_log;
REVOKE ALL ON public.pagcorp_integration_log FROM anon;

-- pagcorp_supplier_links
DROP POLICY IF EXISTS "Anon can delete pagcorp_supplier_links" ON public.pagcorp_supplier_links;
DROP POLICY IF EXISTS "Anon can insert pagcorp_supplier_links" ON public.pagcorp_supplier_links;
DROP POLICY IF EXISTS "Anon can read pagcorp_supplier_links" ON public.pagcorp_supplier_links;
DROP POLICY IF EXISTS "Anon can update pagcorp_supplier_links" ON public.pagcorp_supplier_links;
REVOKE ALL ON public.pagcorp_supplier_links FROM anon;

-- suppliers
DROP POLICY IF EXISTS "Anon can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Anon can read suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Anon can update suppliers" ON public.suppliers;
REVOKE ALL ON public.suppliers FROM anon;

-- synapse_integrations
DROP POLICY IF EXISTS "Anon can insert synapse_integrations" ON public.synapse_integrations;
DROP POLICY IF EXISTS "Anon can read synapse_integrations" ON public.synapse_integrations;
DROP POLICY IF EXISTS "Anon can update synapse_integrations" ON public.synapse_integrations;
REVOKE ALL ON public.synapse_integrations FROM anon;

-- synapse_execution_log
DROP POLICY IF EXISTS "Anon can read synapse_execution_log" ON public.synapse_execution_log;
REVOKE ALL ON public.synapse_execution_log FROM anon;

-- pagcorp_account_mapping / item_mapping
DROP POLICY IF EXISTS "Anon can read pagcorp_account_mapping" ON public.pagcorp_account_mapping;
DROP POLICY IF EXISTS "Anon can read pagcorp_item_mapping" ON public.pagcorp_item_mapping;
REVOKE ALL ON public.pagcorp_account_mapping FROM anon;
REVOKE ALL ON public.pagcorp_item_mapping FROM anon;

-- notifications: remove anon insert, scope reads to owner
DROP POLICY IF EXISTS "Anon can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated can read notifications" ON public.notifications;
REVOKE ALL ON public.notifications FROM anon;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    user_identifier = (auth.jwt() ->> 'email')
    OR user_identifier = auth.uid()::text
  );

-- po_notification_sent: remove anon insert (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "Service role insert po_notification_sent" ON public.po_notification_sent;
REVOKE ALL ON public.po_notification_sent FROM anon;

-- notification_preferences: scope to owner
DROP POLICY IF EXISTS "Authenticated can manage own preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Authenticated can read notification_preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences"
  ON public.notification_preferences FOR ALL
  TO authenticated
  USING (
    user_identifier = (auth.jwt() ->> 'email')
    OR user_identifier = auth.uid()::text
  )
  WITH CHECK (
    user_identifier = (auth.jwt() ->> 'email')
    OR user_identifier = auth.uid()::text
  );

-- user_licenses: only admins can update
DROP POLICY IF EXISTS "Authenticated update user_licenses" ON public.user_licenses;

-- user_phones: scope to owner (by email match against idp_user_mapping)
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_phones'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_phones', pol.policyname);
  END LOOP;
END$$;

CREATE POLICY "Admins full access user_phones"
  ON public.user_phones FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users read own phone"
  ON public.user_phones FOR SELECT
  TO authenticated
  USING (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Users upsert own phone"
  ON public.user_phones FOR INSERT
  TO authenticated
  WITH CHECK (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Users update own phone"
  ON public.user_phones FOR UPDATE
  TO authenticated
  USING (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
  );
