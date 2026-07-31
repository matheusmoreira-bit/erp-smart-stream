ALTER TABLE public.registration_requests
  ADD COLUMN IF NOT EXISTS followers text[] NOT NULL DEFAULT '{}';

DROP POLICY IF EXISTS "Requester or agent can read requests" ON public.registration_requests;
CREATE POLICY "Requester or agent can read requests"
ON public.registration_requests
FOR SELECT
USING (
  lower(requester_email) = current_auth_email()
  OR current_auth_email() = ANY (followers)
  OR is_registration_agent()
);

DROP POLICY IF EXISTS "Requester or agent can read events" ON public.registration_request_events;
CREATE POLICY "Requester or agent can read events"
ON public.registration_request_events
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.registration_requests r
  WHERE r.id = registration_request_events.request_id
    AND (
      lower(r.requester_email) = current_auth_email()
      OR current_auth_email() = ANY (r.followers)
      OR is_registration_agent()
    )
));

DROP POLICY IF EXISTS "Requester or agent can comment" ON public.registration_request_events;
CREATE POLICY "Requester or agent can comment"
ON public.registration_request_events
FOR INSERT
WITH CHECK (
  lower(author_email) = current_auth_email()
  AND EXISTS (
    SELECT 1 FROM public.registration_requests r
    WHERE r.id = registration_request_events.request_id
      AND (
        lower(r.requester_email) = current_auth_email()
        OR current_auth_email() = ANY (r.followers)
        OR is_registration_agent()
      )
  )
);

-- Localiza chamado em aberto do mesmo fornecedor/item e vincula o usuário atual
CREATE OR REPLACE FUNCTION public.find_open_registration_duplicate(
  p_type text,
  p_tax_id text DEFAULT NULL,
  p_title text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  status text,
  requester_email text,
  requester_name text,
  due_at timestamptz,
  created_at timestamptz,
  already_linked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.title, r.status::text, r.requester_email, r.requester_name,
         r.due_at, r.created_at,
         (lower(r.requester_email) = current_auth_email()
          OR current_auth_email() = ANY (r.followers)) AS already_linked
  FROM public.registration_requests r
  WHERE r.request_type::text = p_type
    AND r.status::text NOT IN ('concluido', 'cancelado')
    AND (
      (
        nullif(regexp_replace(coalesce(p_tax_id, ''), '\D', '', 'g'), '') IS NOT NULL
        AND regexp_replace(coalesce(r.federal_tax_id, ''), '\D', '', 'g')
            = regexp_replace(p_tax_id, '\D', '', 'g')
      )
      OR (
        nullif(btrim(coalesce(p_title, '')), '') IS NOT NULL
        AND lower(btrim(r.title)) = lower(btrim(p_title))
      )
    )
  ORDER BY r.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.join_registration_request(
  p_request_id uuid,
  p_note text DEFAULT NULL,
  p_author_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := current_auth_email();
  v_req public.registration_requests%ROWTYPE;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;

  SELECT * INTO v_req FROM public.registration_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado';
  END IF;
  IF v_req.status::text IN ('concluido', 'cancelado') THEN
    RAISE EXCEPTION 'Chamado já encerrado';
  END IF;

  IF lower(v_req.requester_email) <> v_email AND NOT (v_email = ANY (v_req.followers)) THEN
    UPDATE public.registration_requests
       SET followers = array_append(followers, v_email)
     WHERE id = p_request_id;

    INSERT INTO public.registration_request_events
      (request_id, event_type, message, author_email, author_name)
    VALUES (
      p_request_id,
      'follower',
      coalesce(nullif(btrim(p_note), ''), 'Solicitante vinculado a este chamado (solicitação duplicada).'),
      v_email,
      p_author_name
    );
  ELSIF nullif(btrim(p_note), '') IS NOT NULL THEN
    INSERT INTO public.registration_request_events
      (request_id, event_type, message, author_email, author_name)
    VALUES (p_request_id, 'comment', btrim(p_note), v_email, p_author_name);
  END IF;

  RETURN p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_open_registration_duplicate(text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.join_registration_request(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.find_open_registration_duplicate(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_registration_request(uuid, text, text) TO authenticated;