
UPDATE public.overdue_reminder_settings
SET template = rtrim(template, E' \n\r\t') || E'\n\nAprove em: {{link}}'
WHERE template IS NOT NULL
  AND position('{{link}}' in template) = 0;
