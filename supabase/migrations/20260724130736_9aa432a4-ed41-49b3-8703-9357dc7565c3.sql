
CREATE TABLE public.sap_retry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL CHECK (doc_type IN ('expense','advance','baixa','pagcorp','synapse_pagcorp')),
  ref_id text NOT NULL,
  company_db text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  error_category text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_flight','succeeded','exhausted','cancelled')),
  notified_exhausted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sap_retry_queue TO authenticated;
GRANT ALL ON public.sap_retry_queue TO service_role;

ALTER TABLE public.sap_retry_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage retry queue"
  ON public.sap_retry_queue
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX sap_retry_queue_active_uidx
  ON public.sap_retry_queue (doc_type, ref_id)
  WHERE status IN ('pending','in_flight');

CREATE INDEX sap_retry_queue_due_idx
  ON public.sap_retry_queue (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX sap_retry_queue_status_idx
  ON public.sap_retry_queue (status, updated_at DESC);

CREATE TRIGGER sap_retry_queue_updated_at
  BEFORE UPDATE ON public.sap_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.sap_retry_queue;
