ALTER TABLE public.document_drafts
  ALTER COLUMN expires_at SET DEFAULT '9999-12-31 23:59:59.999+00'::timestamptz;

UPDATE public.document_drafts
SET expires_at = '9999-12-31 23:59:59.999+00'::timestamptz
WHERE expires_at < '9999-12-31 23:59:59.999+00'::timestamptz;
