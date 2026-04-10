CREATE TABLE public.pagcorp_integration_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pagcorp_expense_id BIGINT NOT NULL,
  pagcorp_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  sap_doc_entry INTEGER,
  sap_doc_num INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  integration_type TEXT NOT NULL DEFAULT 'generic',
  integrated_by TEXT,
  company_db TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pagcorp_integration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pagcorp_integration_log"
  ON public.pagcorp_integration_log
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_pagcorp_log_expense_id ON public.pagcorp_integration_log (pagcorp_expense_id);
CREATE INDEX idx_pagcorp_log_status ON public.pagcorp_integration_log (status);