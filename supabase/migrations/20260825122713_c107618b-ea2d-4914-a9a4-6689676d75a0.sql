CREATE TABLE IF NOT EXISTS public.pagcorp_document_classification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  pagcorp_expense_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  has_fiscal_document boolean,
  document_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric,
  error_message text,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagcorp_document_classification_unique UNIQUE (company_db, pagcorp_expense_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_document_classification TO authenticated;
GRANT ALL ON public.pagcorp_document_classification TO service_role;

ALTER TABLE public.pagcorp_document_classification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pagcorp classification"
ON public.pagcorp_document_classification FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert pagcorp classification"
ON public.pagcorp_document_classification FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update pagcorp classification"
ON public.pagcorp_document_classification FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins can delete pagcorp classification"
ON public.pagcorp_document_classification FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_pagcorp_classification_company
ON public.pagcorp_document_classification (company_db, status);

CREATE TRIGGER update_pagcorp_document_classification_updated_at
BEFORE UPDATE ON public.pagcorp_document_classification
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();