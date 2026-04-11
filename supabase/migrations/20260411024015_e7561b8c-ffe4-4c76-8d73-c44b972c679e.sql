
-- =====================================================
-- P0: Remove excessive anon write policies
-- =====================================================

-- pagcorp_account_mapping: remove anon write
DROP POLICY IF EXISTS "Anon can delete pagcorp_account_mapping" ON public.pagcorp_account_mapping;
DROP POLICY IF EXISTS "Anon can insert pagcorp_account_mapping" ON public.pagcorp_account_mapping;
DROP POLICY IF EXISTS "Anon can update pagcorp_account_mapping" ON public.pagcorp_account_mapping;
DROP POLICY IF EXISTS "Anon can read pagcorp_account_mapping" ON public.pagcorp_account_mapping;

-- pagcorp_item_mapping: remove anon write
DROP POLICY IF EXISTS "Anon can delete pagcorp_item_mapping" ON public.pagcorp_item_mapping;
DROP POLICY IF EXISTS "Anon can insert pagcorp_item_mapping" ON public.pagcorp_item_mapping;
DROP POLICY IF EXISTS "Anon can update pagcorp_item_mapping" ON public.pagcorp_item_mapping;
DROP POLICY IF EXISTS "Anon can read pagcorp_item_mapping" ON public.pagcorp_item_mapping;

-- pagcorp_integration_log: remove anon write (keep read for monitoring)
DROP POLICY IF EXISTS "Anon can insert pagcorp_integration_log" ON public.pagcorp_integration_log;
DROP POLICY IF EXISTS "Anon can update pagcorp_integration_log" ON public.pagcorp_integration_log;
DROP POLICY IF EXISTS "Anon can read pagcorp_integration_log" ON public.pagcorp_integration_log;

-- permission_groups: remove anon write
DROP POLICY IF EXISTS "Anon can delete permission_groups" ON public.permission_groups;
DROP POLICY IF EXISTS "Anon can insert permission_groups" ON public.permission_groups;
DROP POLICY IF EXISTS "Anon can update permission_groups" ON public.permission_groups;
DROP POLICY IF EXISTS "Anon can read permission_groups" ON public.permission_groups;

-- permission_group_modules: remove anon write
DROP POLICY IF EXISTS "Anon can delete permission_group_modules" ON public.permission_group_modules;
DROP POLICY IF EXISTS "Anon can insert permission_group_modules" ON public.permission_group_modules;
DROP POLICY IF EXISTS "Anon can update permission_group_modules" ON public.permission_group_modules;
DROP POLICY IF EXISTS "Anon can read permission_group_modules" ON public.permission_group_modules;

-- user_group_assignments: remove anon write
DROP POLICY IF EXISTS "Anon can delete user_group_assignments" ON public.user_group_assignments;
DROP POLICY IF EXISTS "Anon can insert user_group_assignments" ON public.user_group_assignments;
DROP POLICY IF EXISTS "Anon can update user_group_assignments" ON public.user_group_assignments;
DROP POLICY IF EXISTS "Anon can read user_group_assignments" ON public.user_group_assignments;

-- synapse_integrations: remove anon write
DROP POLICY IF EXISTS "Anon can insert synapse_integrations" ON public.synapse_integrations;
DROP POLICY IF EXISTS "Anon can update synapse_integrations" ON public.synapse_integrations;
DROP POLICY IF EXISTS "Anon can read synapse_integrations" ON public.synapse_integrations;

-- audit_log: remove anon insert (keep read for now, will be restricted later)
DROP POLICY IF EXISTS "Anon can insert audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Anon can read audit_log" ON public.audit_log;

-- =====================================================
-- Add authenticated read policies where needed
-- =====================================================

CREATE POLICY "Authenticated can read pagcorp_account_mapping"
ON public.pagcorp_account_mapping FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated can read pagcorp_item_mapping"
ON public.pagcorp_item_mapping FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated can read pagcorp_integration_log"
ON public.pagcorp_integration_log FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated can read permission_groups"
ON public.permission_groups FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated can read permission_group_modules"
ON public.permission_group_modules FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated can read user_group_assignments"
ON public.user_group_assignments FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated can read synapse_integrations"
ON public.synapse_integrations FOR SELECT TO authenticated
USING (true);

-- synapse_execution_log: remove anon read (admin only + authenticated read)
DROP POLICY IF EXISTS "Anon can read synapse_execution_log" ON public.synapse_execution_log;

CREATE POLICY "Authenticated can read synapse_execution_log"
ON public.synapse_execution_log FOR SELECT TO authenticated
USING (true);

-- =====================================================
-- P2: Database indexes for performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_audit_log_company_created
ON public.audit_log (company_db, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_credentials_system_company
ON public.system_credentials (system_name, company_db);

CREATE INDEX IF NOT EXISTS idx_sap_cache_company_key
ON public.sap_cache (company_db, cache_key);

CREATE INDEX IF NOT EXISTS idx_pagcorp_integration_log_company_created
ON public.pagcorp_integration_log (company_db, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sap_cache_expires
ON public.sap_cache (expires_at);
