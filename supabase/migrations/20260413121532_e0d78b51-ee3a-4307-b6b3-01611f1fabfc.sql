
-- 1. Fix expenses: admin-only write, authenticated read
DROP POLICY IF EXISTS "Authenticated full access to expenses" ON public.expenses;
CREATE POLICY "Authenticated can read expenses" ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage expenses" ON public.expenses FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. Fix expense_items: admin-only write, authenticated read
DROP POLICY IF EXISTS "Authenticated full access to expense_items" ON public.expense_items;
CREATE POLICY "Authenticated can read expense_items" ON public.expense_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage expense_items" ON public.expense_items FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. Fix expense_attachments: admin-only write, authenticated read
DROP POLICY IF EXISTS "Authenticated full access to expense_attachments" ON public.expense_attachments;
CREATE POLICY "Authenticated can read expense_attachments" ON public.expense_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage expense_attachments" ON public.expense_attachments FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. Fix sap_cache: admin-only write, authenticated read only (remove anon)
DROP POLICY IF EXISTS "Authenticated full access to sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Anon can read sap_cache" ON public.sap_cache;
CREATE POLICY "Authenticated can read sap_cache" ON public.sap_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage sap_cache" ON public.sap_cache FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 5. Fix audit_log: replace open INSERT with security definer function
DROP POLICY IF EXISTS "Authenticated can insert audit_log" ON public.audit_log;

CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id text DEFAULT NULL,
  p_actor_email text DEFAULT NULL,
  p_company_db text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, actor_email, action, entity_type, entity_id, company_db, details)
  VALUES (auth.uid(), p_actor_email, p_action, p_entity_type, p_entity_id, p_company_db, p_details);
END;
$$;

-- 6. Remove sensitive tables from Realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.system_credentials;
ALTER PUBLICATION supabase_realtime DROP TABLE public.companies;
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_roles;
ALTER PUBLICATION supabase_realtime DROP TABLE public.audit_log;
