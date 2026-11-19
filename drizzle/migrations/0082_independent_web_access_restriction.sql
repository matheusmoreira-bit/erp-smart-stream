ALTER TABLE public.erp_access_control ADD COLUMN web_enabled boolean NOT NULL DEFAULT false, ADD COLUMN web_allowed_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[], ADD COLUMN web_required_emails text[] NOT NULL DEFAULT ARRAY['mauricio.farias@anagaming.com.br','juliana.gavineli@anagaming.com.br','artur.angelo@anagaming.com.br','hiller.brandao@growth.gg','hiller.brandao@cactuscorporation.com','douglas.vinicius@anagaming.com.br','fernanda.faria@anagaming.com.br','flavia.alves@growth.gg','bruna.padilha@cactusgaming.net'];
UPDATE public.erp_access_control c SET web_allowed_user_ids=ARRAY(SELECT DISTINCT uid FROM unnest(c.allowed_user_ids || ARRAY(SELECT u.id FROM auth.users u WHERE lower(u.email)=ANY(c.web_required_emails) AND u.email_confirmed_at IS NOT NULL)) uid) WHERE id=true;
COMMENT ON COLUMN public.erp_access_control.web_enabled IS 'Interface-only restriction. Does not revoke API credentials or change global ERP admission.';
CREATE FUNCTION public.erp_web_access_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.erp_access_control%ROWTYPE; m boolean; missing text[];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.erp_access_control WHERE id=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configuração web indisponível' USING ERRCODE='55000'; END IF;
 m:=public.erp_access_is_manager();
 IF NOT m THEN RETURN jsonb_build_object('enabled',c.web_enabled,'admitted',NOT c.web_enabled OR auth.uid()=ANY(c.web_allowed_user_ids),'manager',false,'version',c.version,'ready',false); END IF;
 SELECT coalesce(array_agg(e),'{}'::text[]) INTO missing FROM unnest(c.web_required_emails) e WHERE NOT EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=e AND u.email_confirmed_at IS NOT NULL AND u.id=ANY(c.web_allowed_user_ids));
 RETURN jsonb_build_object('enabled',c.web_enabled,'admitted',NOT c.web_enabled OR auth.uid()=ANY(c.web_allowed_user_ids),'manager',true,'version',c.version,'ready',cardinality(missing)=0 AND c.manager_user_ids <@ c.web_allowed_user_ids,'coverage_note',CASE WHEN cardinality(missing)>0 THEN 'Conta confirmada pendente: '||array_to_string(missing,', ') WHEN NOT c.manager_user_ids <@ c.web_allowed_user_ids THEN 'Administradores de recuperação ausentes.' ELSE 'Contas confirmadas; integrações e perfis preservados.' END,'updated_at',c.updated_at,'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'manager',u.id=ANY(c.manager_user_ids)) ORDER BY u.email) FROM auth.users u WHERE u.id=ANY(c.web_allowed_user_ids)),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.erp_web_access_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_web_access_status() TO authenticated;
CREATE FUNCTION public.manage_erp_web_access(_action text,_expected_version bigint,_email text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.erp_access_control%ROWTYPE; previous jsonb; target uuid; missing text[];
BEGIN
 IF NOT public.erp_access_is_manager() THEN RAISE EXCEPTION 'Gestão exige administrador autorizado com MFA' USING ERRCODE='42501'; END IF;
 IF public.is_impersonating(auth.uid()) THEN RAISE EXCEPTION 'Encerre a impersonação para gerir acessos' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.erp_access_control WHERE id=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configuração web indisponível' USING ERRCODE='55000'; END IF;
 IF _expected_version IS DISTINCT FROM c.version THEN RAISE EXCEPTION 'Configuração mudou. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
 IF _action IS NULL OR _action NOT IN ('enable','disable','allow','remove') THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE='22023'; END IF;
 previous:=jsonb_build_object('enabled',c.web_enabled,'allowed_user_ids',c.web_allowed_user_ids,'version',c.version);
 IF _action='enable' THEN
  IF c.enabled THEN RAISE EXCEPTION 'Bloqueio global deve permanecer desligado para preservar integrações' USING ERRCODE='42501'; END IF;
  IF NOT c.manager_user_ids <@ c.web_allowed_user_ids THEN RAISE EXCEPTION 'Recuperação administrativa ausente' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(e),'{}'::text[]) INTO missing FROM unnest(c.web_required_emails) e WHERE NOT EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=e AND u.email_confirmed_at IS NOT NULL AND u.id=ANY(c.web_allowed_user_ids));
  IF cardinality(missing)>0 THEN RAISE EXCEPTION 'Conta confirmada pendente: %',array_to_string(missing,', ') USING ERRCODE='42501'; END IF;
  c.web_enabled:=true;
 ELSIF _action='disable' THEN c.web_enabled:=false;
 ELSE
  IF _email IS NULL OR length(_email)>254 OR _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Informe e-mail completo válido' USING ERRCODE='22023'; END IF;
  SELECT u.id INTO target FROM auth.users u WHERE lower(u.email)=lower(trim(_email)) AND u.email_confirmed_at IS NOT NULL;
  IF target IS NULL THEN RAISE EXCEPTION 'Conta confirmada não encontrada' USING ERRCODE='22023'; END IF;
  IF _action='remove' AND target=ANY(c.manager_user_ids) THEN RAISE EXCEPTION 'Não é permitido remover os administradores de recuperação' USING ERRCODE='42501'; END IF;
  IF _action='allow' AND NOT target=ANY(c.web_allowed_user_ids) THEN c.web_allowed_user_ids:=array_append(c.web_allowed_user_ids,target); END IF;
  IF _action='remove' THEN c.web_allowed_user_ids:=array_remove(c.web_allowed_user_ids,target); END IF;
 END IF;
 UPDATE public.erp_access_control SET web_enabled=c.web_enabled,web_allowed_user_ids=c.web_allowed_user_ids,version=version+1,updated_at=now(),updated_by=auth.uid() WHERE id=true;
 INSERT INTO public.audit_log(actor_id,actor_email,action,entity_type,entity_id,details) VALUES(auth.uid(),public.current_auth_email(),'erp_web_access_'||_action,'erp_access_control','web',jsonb_build_object('before',previous,'after',jsonb_build_object('enabled',c.web_enabled,'allowed_user_ids',c.web_allowed_user_ids,'version',c.version+1),'target',target));
 RETURN public.erp_web_access_status();
END; $$;
REVOKE ALL ON FUNCTION public.manage_erp_web_access(text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_erp_web_access(text,bigint,text) TO authenticated;