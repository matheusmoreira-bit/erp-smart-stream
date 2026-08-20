-- Restaura os privilégios do Data API no schema public.
-- Todas as tabelas/views do schema estavam sem GRANT algum (apenas o owner),
-- o que derrubava login (lista de empresas), papéis de admin e o backoffice.
-- O RLS continua sendo a camada de autorização; os GRANTs apenas devolvem o
-- acesso mínimo para as roles do PostgREST.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  LOOP
    IF r.relkind IN ('r','p') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', r.relname);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', r.relname);
    ELSE
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.relname);
      EXECUTE format('GRANT SELECT ON public.%I TO service_role', r.relname);
    END IF;
  END LOOP;
END $$;

-- Únicas leituras públicas (pré-login): empresas ativas e ERPs habilitados.
GRANT SELECT ON public.companies TO anon;
GRANT SELECT ON public.enabled_erp_types TO anon;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;