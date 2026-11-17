CREATE TABLE public.erp_access_control (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1,
 allowed_user_ids uuid[] NOT NULL DEFAULT ARRAY['28dc95ee-92b4-4c0d-8310-eba68a3ad0c8'::uuid,'f64dbcd6-bd23-47de-939d-91d386f85b77'::uuid,'8a229285-c36c-489f-ba1b-0cc03b779d7c'::uuid,'d8da2168-b339-46f0-84a4-6c674e6f8f77'::uuid,'1783d855-cc24-40de-920d-f087e356a9c8'::uuid,'92305a29-1893-4a9a-8ddf-e1dc98ececc2'::uuid],
 manager_user_ids uuid[] NOT NULL DEFAULT ARRAY['d8da2168-b339-46f0-84a4-6c674e6f8f77'::uuid,'1783d855-cc24-40de-920d-f087e356a9c8'::uuid,'92305a29-1893-4a9a-8ddf-e1dc98ececc2'::uuid],
 coverage_verified boolean NOT NULL DEFAULT false,
 coverage_note text NOT NULL DEFAULT 'Anexos, RPCs privilegiadas e entradas alternativas aguardam validação.',
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid
);
GRANT SELECT ON public.erp_access_control TO authenticated;
GRANT ALL ON public.erp_access_control TO service_role;
ALTER TABLE public.erp_access_control ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.erp_access_admitted(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.erp_access_control%ROWTYPE;
BEGIN
 IF auth.role() IN ('anon','authenticated') AND _user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
 SELECT * INTO c FROM public.erp_access_control WHERE id=true;
 IF NOT FOUND OR NOT c.enabled THEN RETURN true; END IF;
 IF _user_id IS NULL THEN RETURN false; END IF;
 RETURN _user_id=ANY(c.allowed_user_ids);
END; $$;
REVOKE ALL ON FUNCTION public.erp_access_admitted(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_access_admitted(uuid) TO anon,authenticated,service_role;

CREATE FUNCTION public.erp_access_is_manager() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'aal','')='aal2'
 AND public.has_role(auth.uid(),'admin')
 AND EXISTS(SELECT 1 FROM public.erp_access_control c WHERE c.id=true AND auth.uid()=ANY(c.manager_user_ids));
$$;
REVOKE ALL ON FUNCTION public.erp_access_is_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_access_is_manager() TO authenticated,service_role;
CREATE POLICY erp_access_managers_select ON public.erp_access_control FOR SELECT TO authenticated USING (public.erp_access_is_manager());

CREATE FUNCTION public.erp_access_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.erp_access_control%ROWTYPE; m boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.erp_access_control WHERE id=true;
 IF NOT FOUND THEN RETURN jsonb_build_object('enabled',false,'admitted',true,'manager',false,'version',0,'ready',false); END IF;
 m:=public.erp_access_is_manager();
 IF NOT m THEN RETURN jsonb_build_object('enabled',c.enabled,'admitted',public.erp_access_admitted(),'manager',false,'version',c.version,'ready',false); END IF;
 RETURN jsonb_build_object('enabled',c.enabled,'admitted',public.erp_access_admitted(),'manager',true,'version',c.version,'ready',c.coverage_verified,'coverage_note',c.coverage_note,'updated_at',c.updated_at,'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'manager',u.id=ANY(c.manager_user_ids)) ORDER BY u.email) FROM auth.users u WHERE u.id=ANY(c.allowed_user_ids)),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.erp_access_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_access_status() TO authenticated;

CREATE FUNCTION public.manage_erp_access(_action text,_expected_version bigint,_email text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.erp_access_control%ROWTYPE; previous jsonb; target uuid;
BEGIN
 IF NOT public.erp_access_is_manager() THEN RAISE EXCEPTION 'Gestão exige administrador autorizado com MFA' USING ERRCODE='42501'; END IF;
 IF public.is_impersonating(auth.uid()) THEN RAISE EXCEPTION 'Encerre a impersonação para gerir acessos' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.erp_access_control WHERE id=true FOR UPDATE;
 IF _expected_version IS DISTINCT FROM c.version THEN RAISE EXCEPTION 'Configuração mudou. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
 IF _action NOT IN ('enable','disable','allow','remove') OR _action IS NULL THEN RAISE EXCEPTION 'Ação inválida'; END IF;
 previous:=to_jsonb(c);
 IF _action='enable' THEN
  IF NOT c.coverage_verified THEN RAISE EXCEPTION 'Ativação bloqueada: cobertura de segurança ainda não verificada' USING ERRCODE='42501'; END IF;
  IF NOT c.manager_user_ids <@ c.allowed_user_ids THEN RAISE EXCEPTION 'Recuperação administrativa ausente'; END IF;
  c.enabled:=true;
 ELSIF _action='disable' THEN c.enabled:=false;
 ELSE
  IF _email IS NULL OR length(_email)>254 OR _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Informe e-mail completo válido'; END IF;
  SELECT u.id INTO target FROM auth.users u WHERE lower(u.email)=lower(trim(_email)) AND u.email_confirmed_at IS NOT NULL;
  IF target IS NULL THEN RAISE EXCEPTION 'Conta confirmada não encontrada'; END IF;
  IF _action='remove' AND target=ANY(c.manager_user_ids) THEN RAISE EXCEPTION 'Não é permitido remover os administradores de recuperação'; END IF;
  IF _action='allow' AND NOT target=ANY(c.allowed_user_ids) THEN c.allowed_user_ids:=array_append(c.allowed_user_ids,target); END IF;
  IF _action='remove' THEN c.allowed_user_ids:=array_remove(c.allowed_user_ids,target); END IF;
 END IF;
 UPDATE public.erp_access_control SET enabled=c.enabled,allowed_user_ids=c.allowed_user_ids,version=version+1,updated_at=now(),updated_by=auth.uid() WHERE id=true;
 INSERT INTO public.audit_log(actor_id,actor_email,action,entity_type,entity_id,details) VALUES(auth.uid(),public.current_auth_email(),'erp_access_'||_action,'erp_access_control','global',jsonb_build_object('before',previous,'after',to_jsonb(c),'target',target));
 RETURN public.erp_access_status();
END; $$;
REVOKE ALL ON FUNCTION public.manage_erp_access(text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_erp_access(text,bigint,text) TO authenticated;

CREATE FUNCTION public.erp_access_actor_admitted(_email text DEFAULT NULL,_sap_user text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.erp_access_control%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Somente verificador interno' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.erp_access_control WHERE id=true;
 IF NOT FOUND OR NOT c.enabled THEN RETURN true; END IF;
 IF _email IS NOT NULL THEN RETURN EXISTS(SELECT 1 FROM auth.users u WHERE u.id=ANY(c.allowed_user_ids) AND lower(u.email)=lower(_email)); END IF;
 IF _sap_user IS NULL THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.sap_user_emails e JOIN auth.users u ON lower(u.email)=lower(e.email) WHERE e.user_key=public.canonical_user_key(_sap_user) AND u.id=ANY(c.allowed_user_ids) AND NOT u.id=ANY(c.manager_user_ids));
END; $$;
REVOKE ALL ON FUNCTION public.erp_access_actor_admitted(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_access_actor_admitted(text,text) TO service_role;

DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'erp_access_control' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('CREATE POLICY erp_access_select ON public.%I AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.erp_access_admitted())',t.tablename);
  EXECUTE format('CREATE POLICY erp_access_insert ON public.%I AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (public.erp_access_admitted())',t.tablename);
  EXECUTE format('CREATE POLICY erp_access_update ON public.%I AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (public.erp_access_admitted()) WITH CHECK (public.erp_access_admitted())',t.tablename);
  EXECUTE format('CREATE POLICY erp_access_delete ON public.%I AS RESTRICTIVE FOR DELETE TO anon,authenticated USING (public.erp_access_admitted())',t.tablename);
 END LOOP;
END; $$;
COMMENT ON TABLE public.erp_access_control IS 'Admission-only global access restriction. Activate only after coverage verification; never replace resource permissions.';