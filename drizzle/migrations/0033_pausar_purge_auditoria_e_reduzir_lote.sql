-- Pausa a limpeza retroativa da trilha de auditoria: ela estava causando
-- timeouts nas aprovações (lock global do gatilho de auditoria + muitas linhas mortas).
DO $$
BEGIN
  PERFORM cron.unschedule('audit-trail-payload-purge');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;