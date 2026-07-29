-- Helper: e-mail do usuário autenticado
CREATE OR REPLACE FUNCTION public.current_auth_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- Helper: usuário é atendente das solicitações (Facilities ou admin)
CREATE OR REPLACE FUNCTION public.is_registration_agent()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := public.current_auth_email();
  v_local text := split_part(public.current_auth_email(), '@', 1);
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN true;
  END IF;
  IF v_email = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.user_group_assignments a
    JOIN public.permission_groups g ON g.id = a.group_id
    WHERE lower(btrim(g.name)) IN ('facilities', 'admin')
      AND (lower(a.sap_email) = v_email OR lower(a.sap_email) = v_local)
  );
END;
$$;

-- Helper: prazo de 48 horas úteis (2 dias úteis, pulando sábado/domingo)
CREATE OR REPLACE FUNCTION public.business_hours_deadline(_start timestamptz, _hours integer DEFAULT 48)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_days integer := GREATEST(1, ceil(_hours::numeric / 24)::int);
  v_cur timestamptz := _start;
  i integer := 0;
BEGIN
  WHILE i < v_days LOOP
    v_cur := v_cur + interval '1 day';
    IF extract(isodow FROM v_cur) < 6 THEN
      i := i + 1;
    END IF;
  END LOOP;
  RETURN v_cur;
END;
$$;

CREATE TABLE public.registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL DEFAULT 'supplier' CHECK (request_type IN ('supplier', 'item')),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_andamento', 'aguardando_solicitante', 'concluido', 'cancelado')),
  title text NOT NULL,
  federal_tax_id text,
  contact_email text,
  phone1 text,
  phone2 text,
  currency text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('pix', 'ted', 'doc', 'boleto', 'outro')),
  bank_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  registration_mode text NOT NULL DEFAULT 'erpflow' CHECK (registration_mode IN ('erpflow', 'sap_manual')),
  context text,
  transaction jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  company_db text,
  requester_email text NOT NULL,
  requester_name text,
  assignee_email text,
  sap_card_code text,
  resolution_note text,
  due_at timestamptz NOT NULL DEFAULT public.business_hours_deadline(now(), 48),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_registration_requests_requester ON public.registration_requests (lower(requester_email), created_at DESC);
CREATE INDEX idx_registration_requests_status ON public.registration_requests (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.registration_requests TO authenticated;
GRANT ALL ON public.registration_requests TO service_role;

ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requester or agent can read requests"
  ON public.registration_requests FOR SELECT TO authenticated
  USING (lower(requester_email) = public.current_auth_email() OR public.is_registration_agent());

CREATE POLICY "Users create own requests"
  ON public.registration_requests FOR INSERT TO authenticated
  WITH CHECK (lower(requester_email) = public.current_auth_email());

CREATE POLICY "Agents update requests"
  ON public.registration_requests FOR UPDATE TO authenticated
  USING (public.is_registration_agent())
  WITH CHECK (public.is_registration_agent());

CREATE POLICY "Requester cancels own request"
  ON public.registration_requests FOR UPDATE TO authenticated
  USING (lower(requester_email) = public.current_auth_email())
  WITH CHECK (lower(requester_email) = public.current_auth_email());

CREATE TRIGGER update_registration_requests_updated_at
  BEFORE UPDATE ON public.registration_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.registration_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.registration_requests(id) ON DELETE CASCADE,
  author_email text NOT NULL,
  author_name text,
  event_type text NOT NULL DEFAULT 'comment' CHECK (event_type IN ('comment', 'status_change', 'system')),
  message text,
  from_status text,
  to_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_registration_request_events_request ON public.registration_request_events (request_id, created_at);

GRANT SELECT, INSERT ON public.registration_request_events TO authenticated;
GRANT ALL ON public.registration_request_events TO service_role;

ALTER TABLE public.registration_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requester or agent can read events"
  ON public.registration_request_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.registration_requests r
      WHERE r.id = request_id
        AND (lower(r.requester_email) = public.current_auth_email() OR public.is_registration_agent())
    )
  );

CREATE POLICY "Requester or agent can comment"
  ON public.registration_request_events FOR INSERT TO authenticated
  WITH CHECK (
    lower(author_email) = public.current_auth_email()
    AND EXISTS (
      SELECT 1 FROM public.registration_requests r
      WHERE r.id = request_id
        AND (lower(r.requester_email) = public.current_auth_email() OR public.is_registration_agent())
    )
  );