-- One-shot: invoca a edge function pagcorp-backfill-attachments via net.http_post
-- usando o service role key armazenado no vault. Também garante uma versão SECURITY
-- DEFINER caso precise ser reexecutada por admin no futuro.

CREATE OR REPLACE FUNCTION public._run_pagcorp_attachment_backfill(_body jsonb DEFAULT '{"limit":500}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/pagcorp-backfill-attachments',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='email_queue_service_role_key')
    ),
    body := _body,
    timeout_milliseconds := 120000
  ) INTO v_req;
  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public._run_pagcorp_attachment_backfill(jsonb) FROM PUBLIC, anon, authenticated;

SELECT public._run_pagcorp_attachment_backfill('{"dry_run":true,"limit":200}'::jsonb);