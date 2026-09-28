-- Executar por operador autorizado, em sessão administrativa somente leitura.
-- Não exporta valores de credenciais, emails, JWTs ou comandos do cron.
-- Não foi executado nesta revisão. Guardar saída com data, ambiente e versão.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT current_database() AS database, version() AS engine;
SELECT count(*) AS tables, count(*) FILTER (WHERE rowsecurity) AS with_rls
  FROM pg_tables WHERE schemaname='public';
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
  FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY tablename, policyname;
SELECT id, public FROM storage.buckets ORDER BY id;
SELECT count(*) AS admins,
 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=r.user_id AND f.status='verified')) AS with_verified_factor
 FROM public.user_roles r WHERE r.role='admin';
SELECT credential_key, count(*) AS total,
 count(*) FILTER (WHERE credential_value LIKE 'enc:v1:%') AS prefixed,
 count(*) FILTER (WHERE coalesce(credential_value,'')='' ) AS empty
 FROM public.system_credentials WHERE public.is_secret_credential_key(credential_key)
 GROUP BY credential_key ORDER BY credential_key;
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
 p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS user_execute,
 has_function_privilege('copilot_reader',p.oid,'EXECUTE') AS copilot_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','copilot_ro') AND p.prosecdef ORDER BY n.nspname,p.proname;
SELECT n.nspname,p.proname,pg_get_functiondef(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('has_role','has_module_action','user_can_access_company','insert_audit_log','copilot_read_query','is_impersonating');
SELECT tablename, count(*) AS impersonation_policies FROM pg_policies
 WHERE schemaname='public' AND policyname LIKE 'f12_ro_impersonation_%' GROUP BY tablename;
SELECT kind,status,count(*) FROM public.infra_backup_log
 WHERE created_at >= now()-interval '7 days' GROUP BY kind,status;
SELECT to_regclass('public.hr_payroll_data') AS alleged_payroll,
 EXISTS(SELECT 1 FROM pg_roles WHERE rolname='role_contractor') AS alleged_role,
 EXISTS(SELECT 1 FROM pg_policies WHERE policyname='PrestadorAccess') AS alleged_policy;
ROLLBACK;
-- Separadamente: GET /auth/v1/settings; versão/config de cada Edge Function;
-- registros de deploy/migrações; logs de restore e políticas do bucket S3.
-- Fator cadastrado não demonstra que cada endpoint exige aal2.
