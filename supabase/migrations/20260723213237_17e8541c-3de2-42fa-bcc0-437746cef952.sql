-- Empurra bases de teste para trás da fila
UPDATE public.expenses
SET sap_integration_last_attempt_at = now() + interval '1 day'
WHERE status = 'aprovado'
  AND sap_doc_entry IS NULL
  AND company_db ILIKE 'TST%';

-- Reseta a despesa alvo para reprocessamento imediato
UPDATE public.expenses
SET sap_integration_last_attempt_at = NULL,
    sap_integration_error = NULL
WHERE id = '3e8f54dd-40a9-4c44-bd36-12925eeca6b3';