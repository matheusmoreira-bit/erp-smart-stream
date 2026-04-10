
ALTER TABLE public.synapse_integrations
  ADD COLUMN company_db text;

ALTER TABLE public.synapse_integrations
  DROP CONSTRAINT synapse_integrations_integration_key_key;

ALTER TABLE public.synapse_integrations
  ADD CONSTRAINT synapse_integrations_key_company UNIQUE (integration_key, company_db);

-- Clean existing seed data so it gets re-created with company_db
DELETE FROM public.synapse_integrations WHERE integration_key = 'jumpcloud_sap_sync';
