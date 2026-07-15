
-- Revert security migration: app relies on anon role (users authenticate via SAP session, not Supabase Auth)

-- pagcorp_integration_log: restore anon read
CREATE POLICY "Anon can read pagcorp integration logs for SAP session flow"
  ON public.pagcorp_integration_log FOR SELECT TO anon USING (true);

-- expenses & children
CREATE POLICY "Anon can read expenses" ON public.expenses FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read expense_items" ON public.expense_items FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read expense_attachments" ON public.expense_attachments FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read approval log" ON public.expense_approval_log FOR SELECT TO anon USING (true);

-- audit_log: recreate broad read (anon+authenticated) for expense entities
DROP POLICY IF EXISTS "Authenticated can view expense audit_log" ON public.audit_log;
CREATE POLICY "Anyone can view expense audit_log"
  ON public.audit_log FOR SELECT TO anon, authenticated
  USING (entity_type = 'expense');

-- nf_entrada
CREATE POLICY "Anon read nf_entrada_logs" ON public.nf_entrada_logs FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read nf_entrada_imports" ON public.nf_entrada_imports FOR SELECT TO anon USING (true);

-- approval_rules — restore full anon/auth CRUD (used by admin UI on client)
CREATE POLICY "Anon can read approval_rules" ON public.approval_rules FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert approval_rules" ON public.approval_rules FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update approval_rules" ON public.approval_rules FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete approval_rules" ON public.approval_rules FOR DELETE TO anon USING (true);
CREATE POLICY "Authenticated can insert approval_rules" ON public.approval_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update approval_rules" ON public.approval_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete approval_rules" ON public.approval_rules FOR DELETE TO authenticated USING (true);

CREATE POLICY "Anon can read approval_rule_levels" ON public.approval_rule_levels FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert approval_rule_levels" ON public.approval_rule_levels FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update approval_rule_levels" ON public.approval_rule_levels FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete approval_rule_levels" ON public.approval_rule_levels FOR DELETE TO anon USING (true);
CREATE POLICY "Authenticated can insert approval_rule_levels" ON public.approval_rule_levels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update approval_rule_levels" ON public.approval_rule_levels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete approval_rule_levels" ON public.approval_rule_levels FOR DELETE TO authenticated USING (true);

-- sap_cache
CREATE POLICY "Anon can read sap_cache" ON public.sap_cache FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert sap_cache" ON public.sap_cache FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update sap_cache" ON public.sap_cache FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete sap_cache" ON public.sap_cache FOR DELETE TO anon USING (true);
CREATE POLICY "Authenticated can insert sap_cache" ON public.sap_cache FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update sap_cache" ON public.sap_cache FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete sap_cache" ON public.sap_cache FOR DELETE TO authenticated USING (true);

-- pagcorp_settlement_accounts
DROP POLICY IF EXISTS "Authenticated can read pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
CREATE POLICY "App can read pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "App can insert pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "App can update pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "App can delete pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts FOR DELETE TO anon, authenticated USING (true);

-- Synapse
CREATE POLICY "Anon can read synapse_execution_log" ON public.synapse_execution_log FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read synapse_integrations" ON public.synapse_integrations FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read synapse_global_settings" ON public.synapse_global_settings FOR SELECT TO anon USING (true);

-- Nondeductible cards
DROP POLICY IF EXISTS "Authenticated can read nondeductible cards" ON public.pagcorp_nondeductible_cards;
CREATE POLICY "Anyone can read nondeductible cards" ON public.pagcorp_nondeductible_cards FOR SELECT TO anon, authenticated USING (true);

-- user_profiles: revert to broad access (needed by non-admin client screens)
DROP POLICY IF EXISTS "Users read own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.user_profiles;
CREATE POLICY "Authenticated read user_profiles" ON public.user_profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Authenticated insert user_profiles" ON public.user_profiles FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update user_profiles" ON public.user_profiles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Storage buckets: revert restrictive policies
DROP POLICY IF EXISTS "auth can read own expense files" ON storage.objects;
DROP POLICY IF EXISTS "auth can upload own expense files" ON storage.objects;
DROP POLICY IF EXISTS "auth can delete own expense files" ON storage.objects;
DROP POLICY IF EXISTS "nf_entrada read admin" ON storage.objects;
CREATE POLICY "nf_entrada read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'nf-entrada-files');
