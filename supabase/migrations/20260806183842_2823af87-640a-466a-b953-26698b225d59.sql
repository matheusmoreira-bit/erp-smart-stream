CREATE TABLE public.user_management_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key text NOT NULL,
  company_db text NOT NULL,
  segment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_key, company_db)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_management_segments TO authenticated;
GRANT ALL ON public.user_management_segments TO service_role;

ALTER TABLE public.user_management_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth can read segments" ON public.user_management_segments
FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins insert segments" ON public.user_management_segments
FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update segments" ON public.user_management_segments
FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete segments" ON public.user_management_segments
FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_user_management_segments_updated_at
BEFORE UPDATE ON public.user_management_segments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();