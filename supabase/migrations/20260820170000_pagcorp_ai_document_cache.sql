CREATE TABLE IF NOT EXISTS public.pagcorp_ai_document_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  document_hash text NOT NULL,
  prompt_version text NOT NULL,
  pagcorp_expense_id bigint,
  file_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_result jsonb NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagcorp_ai_document_cache_identity_key
    UNIQUE (company_db, document_hash, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_pagcorp_ai_document_cache_expense
  ON public.pagcorp_ai_document_cache (company_db, pagcorp_expense_id)
  WHERE pagcorp_expense_id IS NOT NULL;

ALTER TABLE public.pagcorp_ai_document_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pagcorp_ai_document_cache FROM anon, authenticated;
GRANT ALL ON public.pagcorp_ai_document_cache TO service_role;

COMMENT ON TABLE public.pagcorp_ai_document_cache IS
  'Cache persistente das extrações de IA de documentos PagCorp, identificado pelo hash SHA-256 do conteúdo.';

COMMENT ON COLUMN public.pagcorp_ai_document_cache.document_hash IS
  'SHA-256 determinístico do conjunto ordenado de hashes dos arquivos enviados.';
