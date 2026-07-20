INSERT INTO public.system_credentials (system_name, company_db, credential_key, credential_value)
VALUES ('sap', 'open_gaming_sa', 'hana_api_url', 'http://201.48.79.205:8001')
ON CONFLICT (system_name, company_db, credential_key)
DO UPDATE SET credential_value = EXCLUDED.credential_value, updated_at = now();