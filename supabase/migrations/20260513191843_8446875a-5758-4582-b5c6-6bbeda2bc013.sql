INSERT INTO public.system_credentials (system_name, company_db, credential_key, credential_value)
VALUES 
  ('sap', 'cactus_providers', 'use_hana_db', 'false'),
  ('sap', 'tst_cactus_providers', 'use_hana_db', 'false')
ON CONFLICT (system_name, company_db, credential_key) DO UPDATE SET credential_value = EXCLUDED.credential_value;