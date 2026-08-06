UPDATE public.sap_retry_queue
SET status = 'pending', attempts = 0, next_attempt_at = now(), notified_exhausted_at = NULL
WHERE last_error ILIKE '%permissible range%';