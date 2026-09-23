ALTER TABLE public.pagcorp_document_classification
  ADD COLUMN IF NOT EXISTS documents_total numeric,
  ADD COLUMN IF NOT EXISTS documents_currency text,
  ADD COLUMN IF NOT EXISTS documents_count integer,
  ADD COLUMN IF NOT EXISTS is_international boolean;