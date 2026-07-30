CREATE TABLE public.approval_matrix_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  label TEXT,
  description TEXT,
  rules_count INTEGER NOT NULL DEFAULT 0,
  levels_count INTEGER NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  restored_from_version INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (company_db, version_no)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_matrix_versions TO authenticated;
GRANT ALL ON public.approval_matrix_versions TO service_role;

ALTER TABLE public.approval_matrix_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read approval_matrix_versions"
  ON public.approval_matrix_versions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage approval_matrix_versions"
  ON public.approval_matrix_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_approval_matrix_versions_company ON public.approval_matrix_versions (company_db, version_no DESC);

CREATE TRIGGER update_approval_matrix_versions_updated_at
  BEFORE UPDATE ON public.approval_matrix_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();