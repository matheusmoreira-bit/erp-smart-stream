-- Base de backup de documentos do SAP (cópia integral para o ERP Flow)

CREATE TABLE public.sap_archive_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_entry INTEGER NOT NULL,
  doc_num INTEGER,
  doc_date DATE,
  card_code TEXT,
  card_name TEXT,
  doc_total NUMERIC,
  doc_currency TEXT,
  doc_status TEXT,
  update_date DATE,
  attachment_entry INTEGER,
  attachments_total INTEGER NOT NULL DEFAULT 0,
  attachments_copied INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  last_error TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, doc_type, doc_entry)
);

CREATE INDEX idx_sap_archive_documents_company_type ON public.sap_archive_documents (company_db, doc_type, doc_entry);
CREATE INDEX idx_sap_archive_documents_pending_attach ON public.sap_archive_documents (company_db, doc_type)
  WHERE attachment_entry IS NOT NULL;

GRANT SELECT ON public.sap_archive_documents TO authenticated;
GRANT ALL ON public.sap_archive_documents TO service_role;
ALTER TABLE public.sap_archive_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem arquivo de documentos"
  ON public.sap_archive_documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


CREATE TABLE public.sap_archive_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_entry INTEGER NOT NULL,
  attachment_entry INTEGER NOT NULL,
  line_num INTEGER NOT NULL DEFAULT 0,
  file_name TEXT NOT NULL,
  file_extension TEXT,
  source_path TEXT,
  storage_path TEXT,
  byte_size BIGINT,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, attachment_entry, line_num)
);

CREATE INDEX idx_sap_archive_attachments_status ON public.sap_archive_attachments (company_db, status);

GRANT SELECT ON public.sap_archive_attachments TO authenticated;
GRANT ALL ON public.sap_archive_attachments TO service_role;
ALTER TABLE public.sap_archive_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem anexos arquivados"
  ON public.sap_archive_attachments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


CREATE TABLE public.sap_archive_cursors (
  company_db TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  last_doc_entry INTEGER NOT NULL DEFAULT 0,
  last_full_sync_at TIMESTAMPTZ,
  last_incremental_at TIMESTAMPTZ,
  completed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_db, doc_type)
);

GRANT SELECT ON public.sap_archive_cursors TO authenticated;
GRANT ALL ON public.sap_archive_cursors TO service_role;
ALTER TABLE public.sap_archive_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem cursores do arquivo"
  ON public.sap_archive_cursors FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


CREATE TABLE public.sap_archive_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db TEXT NOT NULL,
  kind TEXT NOT NULL,
  doc_type TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  documents_count INTEGER NOT NULL DEFAULT 0,
  attachments_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  triggered_by TEXT
);

CREATE INDEX idx_sap_archive_runs_company ON public.sap_archive_runs (company_db, started_at DESC);

GRANT SELECT ON public.sap_archive_runs TO authenticated;
GRANT ALL ON public.sap_archive_runs TO service_role;
ALTER TABLE public.sap_archive_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem execuções do arquivo"
  ON public.sap_archive_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


CREATE TABLE public.sap_archive_restore_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_company_db TEXT NOT NULL,
  target_company_db TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  source_doc_entry INTEGER NOT NULL,
  source_doc_num INTEGER,
  target_doc_entry INTEGER,
  target_doc_num INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_company_db, target_company_db, doc_type, source_doc_entry)
);

GRANT SELECT ON public.sap_archive_restore_map TO authenticated;
GRANT ALL ON public.sap_archive_restore_map TO service_role;
ALTER TABLE public.sap_archive_restore_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem mapa de restauração"
  ON public.sap_archive_restore_map FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
