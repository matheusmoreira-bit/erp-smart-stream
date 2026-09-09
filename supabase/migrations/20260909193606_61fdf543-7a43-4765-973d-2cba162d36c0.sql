ALTER TABLE public.user_sap_credentials
  ADD COLUMN IF NOT EXISTS invalid_at timestamptz,
  ADD COLUMN IF NOT EXISTS invalid_reason text;

-- Credencial pessoal do Leonardo Clemente está recusada pelo SAP desde 04/09,
-- causando bloqueios repetidos por senha incorreta.
UPDATE public.user_sap_credentials c
SET invalid_at = now(), invalid_reason = 'sap_login_failed'
FROM auth.users u
WHERE u.id = c.user_id AND lower(u.email) = 'leonardo.clemente@cactusgaming.net';