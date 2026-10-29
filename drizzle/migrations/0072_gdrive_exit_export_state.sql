CREATE TABLE public.gdrive_export_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 cycle_started_at timestamptz NOT NULL DEFAULT now(),
 state jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.gdrive_export_state TO service_role;
REVOKE ALL ON public.gdrive_export_state FROM anon, authenticated;
ALTER TABLE public.gdrive_export_state ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gdrive_export_chunks (
 path text NOT NULL,
 chunk_no integer NOT NULL,
 content text NOT NULL,
 PRIMARY KEY(path, chunk_no)
);
GRANT ALL ON public.gdrive_export_chunks TO service_role;
REVOKE ALL ON public.gdrive_export_chunks FROM anon, authenticated;
ALTER TABLE public.gdrive_export_chunks ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.gdrive_export_state IS 'Server-only export cursors; no auth accounts or credentials exported. Upload sessions are encrypted.';
COMMENT ON TABLE public.gdrive_export_chunks IS 'Server-only bounded sanitized business export staging, removed after verified Drive upload.';