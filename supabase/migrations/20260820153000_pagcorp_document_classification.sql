CREATE TABLE IF NOT EXISTS public.pagcorp_document_classification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  pagcorp_expense_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  has_fiscal_document boolean,
  document_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric,
  error_message text,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, pagcorp_expense_id)
);

CREATE INDEX IF NOT EXISTS idx_pagcorp_document_classification_lookup
  ON public.pagcorp_document_classification (company_db, pagcorp_expense_id);

ALTER TABLE public.pagcorp_document_classification ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.pagcorp_document_classification TO service_role;

DROP TRIGGER IF EXISTS trg_pagcorp_document_classification_updated_at
  ON public.pagcorp_document_classification;
CREATE TRIGGER trg_pagcorp_document_classification_updated_at
  BEFORE UPDATE ON public.pagcorp_document_classification
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
