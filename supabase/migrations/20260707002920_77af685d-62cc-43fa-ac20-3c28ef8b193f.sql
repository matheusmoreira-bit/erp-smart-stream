CREATE TABLE IF NOT EXISTS public.submitted_document_hashes (
  file_hash text PRIMARY KEY,
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_db text,
  doc_type text,
  supplier_label text,
  file_name text,
  file_size bigint,
  expense_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submitted_document_hashes_user
  ON public.submitted_document_hashes (submitted_by);
CREATE INDEX IF NOT EXISTS idx_submitted_document_hashes_company
  ON public.submitted_document_hashes (company_db);

GRANT SELECT, INSERT ON public.submitted_document_hashes TO authenticated;
GRANT ALL ON public.submitted_document_hashes TO service_role;

ALTER TABLE public.submitted_document_hashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read all submitted hashes"
  ON public.submitted_document_hashes FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated can insert own submitted hashes"
  ON public.submitted_document_hashes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = submitted_by);