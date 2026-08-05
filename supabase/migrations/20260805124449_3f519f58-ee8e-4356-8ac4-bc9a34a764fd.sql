CREATE TABLE public.notification_governance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text UNIQUE,
  exclude_test_companies boolean NOT NULL DEFAULT true,
  block_self_approval boolean NOT NULL DEFAULT true,
  notify_requester boolean NOT NULL DEFAULT false,
  extra_recipients text[] NOT NULL DEFAULT '{}',
  blocked_recipients text[] NOT NULL DEFAULT '{}',
  channels text[] NOT NULL DEFAULT ARRAY['in_app','email','whatsapp','slack'],
  enabled boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_governance TO authenticated;
GRANT ALL ON public.notification_governance TO service_role;

ALTER TABLE public.notification_governance ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_governance_select ON public.notification_governance
  FOR SELECT TO authenticated USING (true);
CREATE POLICY notification_governance_insert ON public.notification_governance
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY notification_governance_update ON public.notification_governance
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY notification_governance_delete ON public.notification_governance
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.notification_governance (company_db) VALUES (NULL);

ALTER TABLE public.notification_governance REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_governance;
ALTER TABLE public.notification_send_runs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_send_runs;