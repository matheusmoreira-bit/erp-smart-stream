
ALTER TABLE public.system_credentials
  ADD COLUMN company_db text;

-- Drop old unique constraint and create new one scoped by company
ALTER TABLE public.system_credentials
  DROP CONSTRAINT IF EXISTS system_credentials_system_name_credential_key_key;

ALTER TABLE public.system_credentials
  ADD CONSTRAINT system_credentials_company_system_key UNIQUE (company_db, system_name, credential_key);
