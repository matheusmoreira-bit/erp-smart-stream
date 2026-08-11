CREATE TABLE public.nf_entrada_write_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.nf_entrada_imports(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  erp_type text NOT NULL DEFAULT 'sap_b1',
  operation text NOT NULL CHECK (operation IN ('invoice_draft', 'purchase_order')),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'error')),
  erp_document_id text,
  erp_document_type text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  requested_by text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX nf_entrada_write_queue_idem_idx ON public.nf_entrada_write_queue (idempotency_key);
CREATE INDEX nf_entrada_write_queue_status_idx ON public.nf_entrada_write_queue (status, created_at DESC);
CREATE INDEX nf_entrada_write_queue_import_idx ON public.nf_entrada_write_queue (import_id);

GRANT SELECT ON public.nf_entrada_write_queue TO authenticated;
GRANT INSERT, UPDATE ON public.nf_entrada_write_queue TO authenticated;
GRANT ALL ON public.nf_entrada_write_queue TO service_role;

ALTER TABLE public.nf_entrada_write_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read nf_entrada_write_queue"
  ON public.nf_entrada_write_queue FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins insert nf_entrada_write_queue"
  ON public.nf_entrada_write_queue FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update nf_entrada_write_queue"
  ON public.nf_entrada_write_queue FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER nf_entrada_write_queue_updated_at
  BEFORE UPDATE ON public.nf_entrada_write_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.nf_entrada_imports
  ADD COLUMN IF NOT EXISTS erp_invoice_posted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS erp_invoice_doc_entry text,
  ADD COLUMN IF NOT EXISTS erp_invoice_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_candidates jsonb,
  ADD COLUMN IF NOT EXISTS match_resolved_by text,
  ADD COLUMN IF NOT EXISTS match_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS divergence_amount numeric,
  ADD COLUMN IF NOT EXISTS divergence_override_by text,
  ADD COLUMN IF NOT EXISTS divergence_override_reason text,
  ADD COLUMN IF NOT EXISTS divergence_override_at timestamptz;