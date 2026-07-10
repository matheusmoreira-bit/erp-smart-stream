
CREATE TABLE IF NOT EXISTS public.integration_pause (
  key text PRIMARY KEY,
  paused_until timestamptz NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.integration_pause TO authenticated;
GRANT ALL ON public.integration_pause TO service_role;
ALTER TABLE public.integration_pause ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read pause flags" ON public.integration_pause FOR SELECT TO authenticated USING (true);

INSERT INTO public.integration_pause (key, paused_until, reason)
VALUES ('sap_b1', '2026-07-10 09:00:00+00', 'Pausa manutenção SAP B1 até 10/07/2026 06:00 BRT')
ON CONFLICT (key) DO UPDATE
SET paused_until = EXCLUDED.paused_until,
    reason = EXCLUDED.reason,
    updated_at = now();
