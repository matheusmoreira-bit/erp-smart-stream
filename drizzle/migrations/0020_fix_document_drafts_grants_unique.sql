-- Dedup before unique index
DELETE FROM public.document_drafts d
USING public.document_drafts k
WHERE d.user_id = k.user_id
  AND d.company_db = k.company_db
  AND d.doc_type = k.doc_type
  AND d.updated_at < k.updated_at;

CREATE UNIQUE INDEX IF NOT EXISTS document_drafts_user_company_doctype_key
  ON public.document_drafts (user_id, company_db, doc_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_drafts TO authenticated;
GRANT ALL ON public.document_drafts TO service_role;