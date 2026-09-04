INSERT INTO public.synapse_integrations (
  integration_key,
  display_name,
  description,
  is_active,
  interval_minutes,
  parameters,
  company_db
)
VALUES
  (
    'uber_trips',
    'Uber - viagens',
    'Busca viagens do Uber pela API/webhook configurada da empresa e monta despesas rateadas por centro de custo.',
    false,
    1440,
    jsonb_build_object(
      'url', 'https://anagaming.app.n8n.cloud/webhook/5a5ebc92-79ff-4c1b-a4df-18f4a41cc6c5',
      'x-api-key', ''
    ),
    'SBO_CACTUS'
  ),
  (
    'uber_trips',
    'Uber - viagens',
    'Busca viagens do Uber pela API/webhook configurada da empresa e monta despesas rateadas por centro de custo.',
    false,
    1440,
    jsonb_build_object(
      'url', 'https://anagaming.app.n8n.cloud/webhook/95c1e5e1-8d00-4b81-9a9f-f4ac345430de',
      'x-api-key', ''
    ),
    'SBO_ANAGAMING'
  )
ON CONFLICT (integration_key, company_db) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  parameters = EXCLUDED.parameters || public.synapse_integrations.parameters,
  updated_at = now();
