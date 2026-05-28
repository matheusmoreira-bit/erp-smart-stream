
CREATE TABLE public.approval_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id text NOT NULL,
  company_db text NOT NULL,
  decision text,
  decision_date timestamp with time zone,
  approver_code text,
  approver_name text,
  approver_email text,
  requester_code text,
  requester_name text,
  doc_object_type text,
  doc_type_name text,
  doc_entry integer,
  doc_num integer,
  doc_total numeric,
  currency text,
  card_code text,
  card_name text,
  remarks text,
  stage_name text,
  step integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT approval_history_external_uniq UNIQUE (company_db, external_id)
);

CREATE INDEX idx_approval_history_company_db ON public.approval_history (company_db);
CREATE INDEX idx_approval_history_approver_code ON public.approval_history (lower(approver_code));
CREATE INDEX idx_approval_history_approver_email ON public.approval_history (lower(approver_email));
CREATE INDEX idx_approval_history_requester ON public.approval_history (lower(requester_code));
CREATE INDEX idx_approval_history_decision_date ON public.approval_history (decision_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_history TO authenticated;
GRANT ALL ON public.approval_history TO service_role;

ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read approval_history"
ON public.approval_history FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage approval_history"
ON public.approval_history FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_approval_history_updated_at
BEFORE UPDATE ON public.approval_history
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.approval_history_sync_state (
  id integer PRIMARY KEY DEFAULT 1,
  last_sync_at timestamp with time zone,
  last_status text,
  last_message text,
  last_count integer DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT approval_history_sync_state_singleton CHECK (id = 1)
);

GRANT SELECT ON public.approval_history_sync_state TO authenticated;
GRANT ALL ON public.approval_history_sync_state TO service_role;

ALTER TABLE public.approval_history_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read approval_history_sync_state"
ON public.approval_history_sync_state FOR SELECT TO authenticated USING (true);

INSERT INTO public.approval_history_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING;
