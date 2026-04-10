
-- Permission groups (customizable by admin)
CREATE TABLE public.permission_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.permission_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access permission_groups" ON public.permission_groups FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read permission_groups" ON public.permission_groups FOR SELECT TO anon USING (true);

-- Modules assigned to each group
CREATE TABLE public.permission_group_modules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.permission_groups(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(group_id, module_key)
);

ALTER TABLE public.permission_group_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access permission_group_modules" ON public.permission_group_modules FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read permission_group_modules" ON public.permission_group_modules FOR SELECT TO anon USING (true);

-- User-to-group assignments (by SAP email)
CREATE TABLE public.user_group_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sap_email TEXT NOT NULL,
  group_id UUID NOT NULL REFERENCES public.permission_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sap_email, group_id)
);

ALTER TABLE public.user_group_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access user_group_assignments" ON public.user_group_assignments FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read user_group_assignments" ON public.user_group_assignments FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert user_group_assignments" ON public.user_group_assignments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update user_group_assignments" ON public.user_group_assignments FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete user_group_assignments" ON public.user_group_assignments FOR DELETE TO anon USING (true);

-- Also allow anon full CRUD on permission_groups and modules (SAP sessions use anon)
CREATE POLICY "Anon can insert permission_groups" ON public.permission_groups FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update permission_groups" ON public.permission_groups FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete permission_groups" ON public.permission_groups FOR DELETE TO anon USING (true);

CREATE POLICY "Anon can insert permission_group_modules" ON public.permission_group_modules FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update permission_group_modules" ON public.permission_group_modules FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete permission_group_modules" ON public.permission_group_modules FOR DELETE TO anon USING (true);

-- Seed default groups
INSERT INTO public.permission_groups (name, description) VALUES
  ('admin', 'Acesso total ao sistema incluindo gestão de usuários, credenciais e configurações'),
  ('financeiro', 'Acesso ao módulo de análise de pagamentos e funcionalidades financeiras'),
  ('pagcorp', 'Acesso ao módulo PagCorp para gestão de cartões corporativos');

-- Seed default module assignments
INSERT INTO public.permission_group_modules (group_id, module_key)
SELECT g.id, m.key FROM public.permission_groups g,
  (VALUES ('analytics'), ('analytics_payments'), ('expenses'), ('approvals'), ('approval_rules'), ('pagcorp'), ('users'), ('synapse'), ('credentials'), ('audit_log')) AS m(key)
WHERE g.name = 'admin';

INSERT INTO public.permission_group_modules (group_id, module_key)
SELECT g.id, m.key FROM public.permission_groups g,
  (VALUES ('analytics'), ('analytics_payments'), ('expenses')) AS m(key)
WHERE g.name = 'financeiro';

INSERT INTO public.permission_group_modules (group_id, module_key)
SELECT g.id, m.key FROM public.permission_groups g,
  (VALUES ('analytics'), ('expenses'), ('pagcorp')) AS m(key)
WHERE g.name = 'pagcorp';
