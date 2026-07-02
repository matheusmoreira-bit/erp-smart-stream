
CREATE TABLE public.document_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  company_db text NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('purchase','sales')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 days')
);

CREATE UNIQUE INDEX document_drafts_owner_type_idx
  ON public.document_drafts (user_id, company_db, doc_type);
CREATE INDEX document_drafts_expires_at_idx
  ON public.document_drafts (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_drafts TO authenticated;
GRANT ALL ON public.document_drafts TO service_role;

ALTER TABLE public.document_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own drafts"
  ON public.document_drafts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own drafts"
  ON public.document_drafts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own drafts"
  ON public.document_drafts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own drafts"
  ON public.document_drafts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER document_drafts_updated_at
  BEFORE UPDATE ON public.document_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
