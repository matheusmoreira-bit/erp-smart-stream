CREATE TABLE IF NOT EXISTS public.notification_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid,
  recipient_id uuid,
  event_key text,
  channel text NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  error_message text,
  recipient_address text,
  recipient_name text,
  company_db text,
  source_module text,
  source_entity_type text,
  source_entity_id text,
  duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nda_dispatch ON public.notification_delivery_attempts (dispatch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nda_created ON public.notification_delivery_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nda_status ON public.notification_delivery_attempts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nda_address ON public.notification_delivery_attempts (lower(recipient_address));

GRANT SELECT ON public.notification_delivery_attempts TO authenticated;
GRANT ALL ON public.notification_delivery_attempts TO service_role;

ALTER TABLE public.notification_delivery_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attempts_select_admin_or_own"
ON public.notification_delivery_attempts
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR lower(coalesce(recipient_address, '')) = lower(coalesce(public.current_auth_email(), ''))
);

CREATE OR REPLACE FUNCTION public.get_notification_delivery_attempts(p_dispatch_id uuid)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  attempt_no integer,
  channel text,
  status text,
  error_message text,
  recipient_address text,
  recipient_name text,
  duration_ms integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.created_at, a.attempt_no, a.channel, a.status, a.error_message,
         a.recipient_address, a.recipient_name, a.duration_ms
  FROM public.notification_delivery_attempts a
  WHERE a.dispatch_id = p_dispatch_id
    AND (
      public.has_role(auth.uid(), 'admin')
      OR lower(coalesce(a.recipient_address, '')) = lower(coalesce(public.current_auth_email(), ''))
    )
  ORDER BY a.created_at ASC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.get_notification_delivery_attempts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_delivery_attempts(uuid) TO authenticated;