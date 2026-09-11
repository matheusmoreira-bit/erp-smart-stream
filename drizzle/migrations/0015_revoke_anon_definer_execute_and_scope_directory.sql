-- Revoga execução anônima de todas as funções SECURITY DEFINER do schema public
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, PUBLIC', r.sig);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- Funções de manutenção/diagnóstico não devem ser chamáveis por usuários comuns
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname IN (
        'prune_db_query_metrics','get_pg_slow_queries','get_db_slow_query_samples',
        'prune_edge_function_metrics','archive_audit_trail','move_to_dlq'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END $$;

-- Diretório SAP: leitura apenas para usuários corporativos vinculados
DROP POLICY IF EXISTS "directory readable by authenticated" ON public.sap_user_directory;
CREATE POLICY "directory readable by authenticated" ON public.sap_user_directory
  FOR SELECT TO authenticated
  USING (public.current_auth_email() <> '');