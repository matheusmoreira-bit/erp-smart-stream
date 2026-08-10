UPDATE public.integration_health_alert_settings
SET recipient_emails = (
  SELECT COALESCE(array_agg(e), '{}')
  FROM unnest(recipient_emails) AS e
  WHERE lower(split_part(e, '@', 1)) <> 'juliana.gavineli'
)
WHERE recipient_emails IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(recipient_emails) AS e
    WHERE lower(split_part(e, '@', 1)) = 'juliana.gavineli'
  );