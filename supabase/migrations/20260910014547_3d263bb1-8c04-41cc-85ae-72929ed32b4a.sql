CREATE TABLE public.ai_document_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  input_hash text NOT NULL,
  model text,
  entity_type text,
  entity_id text,
  company_db text,
  result jsonb NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_document_analyses_scope_hash_key UNIQUE (scope, input_hash)
);

CREATE INDEX idx_ai_document_analyses_entity ON public.ai_document_analyses (entity_type, entity_id);
CREATE INDEX idx_ai_document_analyses_last_used ON public.ai_document_analyses (last_used_at DESC);

GRANT ALL ON public.ai_document_analyses TO service_role;
GRANT SELECT ON public.ai_document_analyses TO authenticated;

ALTER TABLE public.ai_document_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view ai document analyses"
  ON public.ai_document_analyses
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_ai_document_analyses_updated_at
  BEFORE UPDATE ON public.ai_document_analyses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();