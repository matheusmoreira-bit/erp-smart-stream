-- Liga o motor v2 em modo shadow globalmente. Nenhum bloqueio real acontece
-- enquanto não houver empresa em `permissions_enforcement_scope` com mode='enforce'.
-- O objetivo é começar a coletar telemetria em permission_shadow_log.
UPDATE public.feature_flags SET enabled = true, updated_at = now() WHERE key = 'permissions_v2';
UPDATE public.feature_flags SET enabled = false, updated_at = now() WHERE key = 'permissions_v2_kill';

-- Realtime: garantir que o front recebe mudanças em flags/escopo em tempo real
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_flags;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.permissions_enforcement_scope;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;