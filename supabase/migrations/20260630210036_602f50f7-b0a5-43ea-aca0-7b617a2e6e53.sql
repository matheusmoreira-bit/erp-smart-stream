
-- Documents table for Phase 4
CREATE TABLE public.audit_console_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid REFERENCES public.audit_console_runs(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('nf','contract','other')),
  storage_path text NOT NULL,
  original_filename text,
  mime_type text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','analyzing','analyzed','failed')),
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  divergences_created integer NOT NULL DEFAULT 0,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_docs_run ON public.audit_console_documents(audit_run_id);
CREATE INDEX idx_audit_docs_company ON public.audit_console_documents(company_db);
CREATE INDEX idx_audit_docs_status ON public.audit_console_documents(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_documents TO authenticated;
GRANT ALL ON public.audit_console_documents TO service_role;

ALTER TABLE public.audit_console_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_docs_read" ON public.audit_console_documents
  FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));

CREATE POLICY "audit_docs_admin_write" ON public.audit_console_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_audit_docs_updated_at
  BEFORE UPDATE ON public.audit_console_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default rules (global, company_db NULL)
INSERT INTO public.audit_console_rules (company_db, name, divergence_type, default_severity, tolerance, config, is_active) VALUES
  (NULL, 'PI/GRPO sem PO de origem', 'missing_order', 'high', NULL, '{}'::jsonb, true),
  (NULL, 'PI sem GRPO correspondente', 'missing_grpo', 'medium', NULL, '{}'::jsonb, true),
  (NULL, 'GRPO sem PI após N dias', 'missing_ap', 'medium', NULL, '{"days":30}'::jsonb, true),
  (NULL, 'Divergência de valor PO vs PI', 'value_mismatch', 'high', 1.0, '{"mode":"percent"}'::jsonb, true),
  (NULL, 'Fornecedor da PI diferente do PO', 'vendor_mismatch', 'critical', NULL, '{}'::jsonb, true),
  (NULL, 'Condição de pagamento alterada', 'payment_terms_mismatch', 'medium', NULL, '{}'::jsonb, true),
  (NULL, 'Possível duplicidade de documento', 'duplicate_suspected', 'high', NULL, '{"window_days":3,"flag_fraud":true}'::jsonb, true),
  (NULL, 'Data anômala (PI antes do PO ou fim de semana)', 'date_anomaly', 'low', NULL, '{}'::jsonb, true),
  (NULL, 'PO acima do limite sem aprovação registrada', 'missing_approval', 'high', NULL, '{"min_amount":5000}'::jsonb, true),
  (NULL, 'PI vencida sem pagamento', 'missing_payment', 'medium', NULL, '{"days_overdue":30}'::jsonb, true);
