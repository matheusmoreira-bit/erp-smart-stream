-- Invalida credenciais que ja foram versionadas. Novos valores devem ser
-- cadastrados pela gestao de credenciais e armazenados fora do Git.
UPDATE public.system_credentials
SET credential_value = '', updated_at = now()
WHERE system_name = 'jumpcloud'
  AND credential_key = 'api_key'
  AND credential_value LIKE 'jca_%';
