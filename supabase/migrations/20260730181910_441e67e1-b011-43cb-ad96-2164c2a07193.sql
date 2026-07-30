ALTER TABLE public.registration_request_events DROP CONSTRAINT IF EXISTS registration_request_events_event_type_check;
ALTER TABLE public.registration_request_events ADD CONSTRAINT registration_request_events_event_type_check
  CHECK (event_type = ANY (ARRAY['comment','status','status_change','attachment','audit','system','email']));

ALTER TABLE public.registration_requests DROP CONSTRAINT IF EXISTS registration_requests_status_check;
ALTER TABLE public.registration_requests ADD CONSTRAINT registration_requests_status_check
  CHECK (status = ANY (ARRAY['aberto','em_andamento','aguardando_solicitante','pendente_solicitante','concluido','cancelado']));