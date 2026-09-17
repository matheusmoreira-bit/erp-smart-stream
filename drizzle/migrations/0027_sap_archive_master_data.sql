CREATE TABLE public.sap_archive_master_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  payload JSONB NOT NULL,
  update_date DATE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, entity_type, code)
);

CREATE INDEX idx_sap_archive_master_company_entity ON public.sap_archive_master_data (company_db, entity_type);

GRANT SELECT ON public.sap_archive_master_data TO authenticated;
GRANT ALL ON public.sap_archive_master_data TO service_role;
ALTER TABLE public.sap_archive_master_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem cadastros arquivados"
  ON public.sap_archive_master_data FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.sap_archive_master_cursors (
  company_db TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  last_offset INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  last_full_sync_at TIMESTAMPTZ,
  last_incremental_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_db, entity_type)
);

GRANT SELECT ON public.sap_archive_master_cursors TO authenticated;
GRANT ALL ON public.sap_archive_master_cursors TO service_role;
ALTER TABLE public.sap_archive_master_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem cursores de cadastros"
  ON public.sap_archive_master_cursors FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.sap_archive_master_restore_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_company_db TEXT NOT NULL,
  target_company_db TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'restored',
  error_message TEXT,
  restored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_company_db, target_company_db, entity_type, code)
);

GRANT SELECT ON public.sap_archive_master_restore_map TO authenticated;
GRANT ALL ON public.sap_archive_master_restore_map TO service_role;
ALTER TABLE public.sap_archive_master_restore_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem devolucao de cadastros"
  ON public.sap_archive_master_restore_map FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));