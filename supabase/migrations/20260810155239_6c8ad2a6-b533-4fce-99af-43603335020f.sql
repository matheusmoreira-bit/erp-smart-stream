CREATE TABLE public.sap_total_reconciliation (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  doc_type text,
  sap_doc_entry integer,
  sap_doc_num integer,
  flow_total numeric NOT NULL DEFAULT 0,
  sap_total numeric NOT NULL DEFAULT 0,
  sap_net_total numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  abs_difference numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  cause text,
  cause_label text,
  cause_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamp with time zone,
  resolved_by text,
  checked_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sap_total_reconciliation_expense_unique UNIQUE (expense_id)
);

CREATE INDEX idx_sap_total_recon_company_status ON public.sap_total_reconciliation (company_db, status, checked_at DESC);
CREATE INDEX idx_sap_total_recon_cause ON public.sap_total_reconciliation (cause);

GRANT SELECT ON public.sap_total_reconciliation TO authenticated;
GRANT ALL ON public.sap_total_reconciliation TO service_role;

ALTER TABLE public.sap_total_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read reconciliation"
  ON public.sap_total_reconciliation FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages reconciliation"
  ON public.sap_total_reconciliation FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_sap_total_recon_updated_at
  BEFORE UPDATE ON public.sap_total_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();