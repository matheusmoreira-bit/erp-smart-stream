
ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'BRL',
ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
ADD COLUMN IF NOT EXISTS logo_url text;
