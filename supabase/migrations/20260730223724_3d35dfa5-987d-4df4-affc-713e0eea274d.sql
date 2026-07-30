CREATE TABLE public.access_review_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  period_label text NOT NULL,
  status text NOT NULL DEFAULT 'aberta',
  due_at timestamptz,
  opened_by text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_review_campaigns_status_chk CHECK (status IN ('aberta','concluida','cancelada'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_review_campaigns TO authenticated;
GRANT ALL ON public.access_review_campaigns TO service_role;
ALTER TABLE public.access_review_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read access_review_campaigns" ON public.access_review_campaigns
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert access_review_campaigns" ON public.access_review_campaigns
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update access_review_campaigns" ON public.access_review_campaigns
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete access_review_campaigns" ON public.access_review_campaigns
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.access_review_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.access_review_campaigns(id) ON DELETE CASCADE,
  user_key text NOT NULL,
  display_name text,
  sap_email text,
  access_type text NOT NULL,
  company_db text,
  access_ref_id uuid,
  access_label text NOT NULL,
  decision text NOT NULL DEFAULT 'pendente',
  justification text,
  decided_by text,
  decided_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_review_items_type_chk CHECK (access_type IN ('grupo','alcada')),
  CONSTRAINT access_review_items_decision_chk CHECK (decision IN ('pendente','manter','alterar','revogar'))
);

CREATE INDEX idx_access_review_items_campaign ON public.access_review_items (campaign_id);
CREATE INDEX idx_access_review_items_user ON public.access_review_items (user_key);
CREATE INDEX idx_access_review_items_decision ON public.access_review_items (campaign_id, decision);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_review_items TO authenticated;
GRANT ALL ON public.access_review_items TO service_role;
ALTER TABLE public.access_review_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read access_review_items" ON public.access_review_items
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert access_review_items" ON public.access_review_items
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update access_review_items" ON public.access_review_items
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete access_review_items" ON public.access_review_items
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_access_review_campaigns_updated
  BEFORE UPDATE ON public.access_review_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_access_review_items_updated
  BEFORE UPDATE ON public.access_review_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.open_access_review_campaign(
  _name text,
  _period_label text,
  _due_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _campaign_id uuid;
  _actor text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  _actor := current_auth_email();

  INSERT INTO public.access_review_campaigns (name, period_label, due_at, notes, opened_by)
  VALUES (_name, _period_label, _due_at, _notes, _actor)
  RETURNING id INTO _campaign_id;

  INSERT INTO public.access_review_items (
    campaign_id, user_key, display_name, sap_email, access_type,
    company_db, access_ref_id, access_label, evidence
  )
  SELECT
    _campaign_id,
    canonical_user_key(uga.sap_email),
    dir.display_name,
    uga.sap_email,
    'grupo',
    uga.company_db,
    uga.group_id,
    pg.name,
    jsonb_build_object(
      'snapshot_at', now(),
      'group_id', uga.group_id,
      'group_name', pg.name,
      'company_db', uga.company_db,
      'assigned_at', uga.created_at
    )
  FROM public.user_group_assignments uga
  JOIN public.permission_groups pg ON pg.id = uga.group_id
  LEFT JOIN public.sap_user_directory dir ON dir.user_key = canonical_user_key(uga.sap_email);

  INSERT INTO public.access_review_items (
    campaign_id, user_key, display_name, sap_email, access_type,
    company_db, access_ref_id, access_label, evidence
  )
  SELECT
    _campaign_id,
    canonical_user_key(acc.sap_email),
    dir.display_name,
    acc.sap_email,
    'alcada',
    acc.company_db,
    acc.id,
    acc.cost_center || COALESCE(' - ' || acc.cost_center_name, ''),
    jsonb_build_object(
      'snapshot_at', now(),
      'cost_center', acc.cost_center,
      'cost_center_name', acc.cost_center_name,
      'company_db', acc.company_db,
      'granted_at', acc.created_at
    )
  FROM public.approver_cost_centers acc
  LEFT JOIN public.sap_user_directory dir ON dir.user_key = canonical_user_key(acc.sap_email);

  RETURN _campaign_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_access_review_campaign(_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pending int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT count(*) INTO _pending
  FROM public.access_review_items
  WHERE campaign_id = _campaign_id AND decision = 'pendente';

  IF _pending > 0 THEN
    RAISE EXCEPTION 'campanha possui % item(ns) pendente(s)', _pending;
  END IF;

  UPDATE public.access_review_campaigns
  SET status = 'concluida', closed_at = now(), closed_by = current_auth_email()
  WHERE id = _campaign_id AND status = 'aberta';
END;
$$;

REVOKE ALL ON FUNCTION public.open_access_review_campaign(text, text, timestamptz, text) FROM public;
REVOKE ALL ON FUNCTION public.close_access_review_campaign(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.open_access_review_campaign(text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_access_review_campaign(uuid) TO authenticated;