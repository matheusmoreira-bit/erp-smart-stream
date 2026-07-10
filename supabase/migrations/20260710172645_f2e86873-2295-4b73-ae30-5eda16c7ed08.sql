-- Habilita Realtime para a tabela suppliers (INSERT/UPDATE/DELETE)
ALTER TABLE public.suppliers REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'suppliers'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.suppliers';
  END IF;
END $$;