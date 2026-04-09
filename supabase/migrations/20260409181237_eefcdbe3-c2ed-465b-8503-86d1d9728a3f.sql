
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.system_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  system_name TEXT NOT NULL,
  credential_key TEXT NOT NULL,
  credential_value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(system_name, credential_key)
);

ALTER TABLE public.system_credentials ENABLE ROW LEVEL SECURITY;

-- No public RLS policies - only service role can access
-- This ensures credentials are only accessible from edge functions

CREATE TRIGGER update_system_credentials_updated_at
  BEFORE UPDATE ON public.system_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
