CREATE TABLE IF NOT EXISTS public.registration_sla_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.registration_requests(id) ON DELETE CASCADE,
  kind text NOT NULL,
  recipients text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'sent',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_registration_sla_reminder
  ON public.registration_sla_reminder_log (request_id, kind);

GRANT SELECT ON public.registration_sla_reminder_log TO authenticated;
GRANT ALL ON public.registration_sla_reminder_log TO service_role;

ALTER TABLE public.registration_sla_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents read sla reminder log"
ON public.registration_sla_reminder_log
FOR SELECT
TO authenticated
USING (public.is_registration_agent());