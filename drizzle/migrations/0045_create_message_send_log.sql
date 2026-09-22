CREATE TABLE IF NOT EXISTS public.message_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL CHECK (channel IN ('email','push','whatsapp','slack','in_app','sms')),
  recipient text NOT NULL,
  subject text,
  status text NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error_message text,
  source text,
  company_db text,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_message_send_log_created ON public.message_send_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_send_log_recipient ON public.message_send_log (lower(recipient), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_send_log_channel ON public.message_send_log (channel, created_at DESC);

GRANT SELECT ON public.message_send_log TO authenticated;
GRANT ALL ON public.message_send_log TO service_role;

ALTER TABLE public.message_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read message send log"
ON public.message_send_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages message send log"
ON public.message_send_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);