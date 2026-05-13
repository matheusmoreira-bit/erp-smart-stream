
CREATE TABLE public.notification_send_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  recipients_count integer NOT NULL DEFAULT 0,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_send_runs_sent_at ON public.notification_send_runs (sent_at DESC);
CREATE INDEX idx_notification_send_runs_function ON public.notification_send_runs (function_name, sent_at DESC);

ALTER TABLE public.notification_send_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage notification_send_runs"
  ON public.notification_send_runs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read notification_send_runs"
  ON public.notification_send_runs
  FOR SELECT TO authenticated
  USING (true);
