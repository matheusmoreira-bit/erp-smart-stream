update public.sap_retry_queue
set status='pending', attempts=0, notified_exhausted_at=null,
    next_attempt_at = now() - interval '1 minute',
    last_error='Reprocessamento manual (nome do anexo corrigido)'
where id='3e733965-73ac-484f-a964-cf74c103cd8e';