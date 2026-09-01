ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS project_codes text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_api_keys_project_codes
  ON public.api_keys USING gin (project_codes);

COMMENT ON COLUMN public.api_keys.project_codes IS
  'Projetos que a credencial pode consultar em APIs com escopo por projeto.';
