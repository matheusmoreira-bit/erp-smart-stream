
-- 1. Create role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 2. Create security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 3. Create audit_log table
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 4. RLS for user_roles
CREATE POLICY "Admins can manage user_roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. RLS for audit_log
CREATE POLICY "Admins can view audit_log"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can insert audit_log"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 6. Drop all permissive policies and recreate restrictive ones

-- companies
DROP POLICY IF EXISTS "Allow all access to companies" ON public.companies;
CREATE POLICY "Admins full access to companies"
  ON public.companies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can read active companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (is_active = true);

-- system_credentials
DROP POLICY IF EXISTS "Allow all access to system_credentials" ON public.system_credentials;
CREATE POLICY "Admins full access to system_credentials"
  ON public.system_credentials FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- approval_rules
DROP POLICY IF EXISTS "Allow all access to approval_rules" ON public.approval_rules;
CREATE POLICY "Authenticated can read approval_rules"
  ON public.approval_rules FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Admins can manage approval_rules"
  ON public.approval_rules FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- approval_rule_levels
DROP POLICY IF EXISTS "Allow all access to approval_rule_levels" ON public.approval_rule_levels;
CREATE POLICY "Authenticated can read approval_rule_levels"
  ON public.approval_rule_levels FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Admins can manage approval_rule_levels"
  ON public.approval_rule_levels FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- expenses
DROP POLICY IF EXISTS "Allow all access to expenses" ON public.expenses;
CREATE POLICY "Authenticated full access to expenses"
  ON public.expenses FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- expense_items
DROP POLICY IF EXISTS "Allow all access to expense_items" ON public.expense_items;
CREATE POLICY "Authenticated full access to expense_items"
  ON public.expense_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- expense_attachments
DROP POLICY IF EXISTS "Allow all access to expense_attachments" ON public.expense_attachments;
CREATE POLICY "Authenticated full access to expense_attachments"
  ON public.expense_attachments FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- idp_user_mapping
DROP POLICY IF EXISTS "Allow all access to idp_user_mapping" ON public.idp_user_mapping;
CREATE POLICY "Admins full access to idp_user_mapping"
  ON public.idp_user_mapping FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- pagcorp_account_mapping
DROP POLICY IF EXISTS "Allow all access to pagcorp_account_mapping" ON public.pagcorp_account_mapping;
CREATE POLICY "Admins full access to pagcorp_account_mapping"
  ON public.pagcorp_account_mapping FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- pagcorp_integration_log
DROP POLICY IF EXISTS "Allow all access to pagcorp_integration_log" ON public.pagcorp_integration_log;
CREATE POLICY "Admins full access to pagcorp_integration_log"
  ON public.pagcorp_integration_log FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- sap_cache
DROP POLICY IF EXISTS "Allow all read access to sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Allow all write access to sap_cache" ON public.sap_cache;
CREATE POLICY "Authenticated full access to sap_cache"
  ON public.sap_cache FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- synapse_integrations
DROP POLICY IF EXISTS "Allow all access to synapse_integrations" ON public.synapse_integrations;
CREATE POLICY "Admins full access to synapse_integrations"
  ON public.synapse_integrations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- synapse_execution_log
DROP POLICY IF EXISTS "Allow all access to synapse_execution_log" ON public.synapse_execution_log;
CREATE POLICY "Admins full access to synapse_execution_log"
  ON public.synapse_execution_log FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. Add cascade delete: credentials deleted when company is deleted
-- We use a trigger since system_credentials references company_db (text), not a FK to companies
CREATE OR REPLACE FUNCTION public.cascade_delete_company_credentials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.system_credentials WHERE company_db = OLD.company_db;
  INSERT INTO public.audit_log (action, entity_type, entity_id, details)
  VALUES ('cascade_delete', 'system_credentials', OLD.company_db,
    jsonb_build_object('reason', 'company_deleted', 'company_name', OLD.display_name));
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_cascade_delete_company_credentials
  BEFORE DELETE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_delete_company_credentials();

-- 8. Enable realtime for audit_log
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
