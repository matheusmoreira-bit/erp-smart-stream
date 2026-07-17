ALTER TABLE public.auditoria_cruzamento_config
  ADD COLUMN IF NOT EXISTS source_company_dbs text[] NOT NULL DEFAULT '{}';