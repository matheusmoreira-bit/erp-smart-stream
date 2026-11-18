CREATE TABLE public.integration_machine_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
 api_key_id uuid NOT NULL REFERENCES public.api_keys(id),
 service text NOT NULL CHECK (service IN ('expense-tracking-api','pagcorp-status-api','external-approvals-api')),
 secret_env_name text NOT NULL CHECK (secret_env_name ~ '^INTEGRATION_MACHINE_[A-Z0-9_]{1,80}$'),
 company_dbs text[] NOT NULL CHECK (cardinality(company_dbs)>0),
 project_codes text[] NOT NULL DEFAULT '{}',
 operations text[] NOT NULL DEFAULT ARRAY['read'] CHECK (operations <@ ARRAY['read','list']::text[] AND cardinality(operations)>0),
 enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.integration_machine_grants TO authenticated;
GRANT ALL ON public.integration_machine_grants TO service_role;
ALTER TABLE public.integration_machine_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY machine_grants_select ON public.integration_machine_grants FOR SELECT TO authenticated USING (public.erp_access_is_manager());
CREATE POLICY machine_grants_insert ON public.integration_machine_grants FOR INSERT TO authenticated WITH CHECK (public.erp_access_is_manager());
CREATE POLICY machine_grants_update ON public.integration_machine_grants FOR UPDATE TO authenticated USING (public.erp_access_is_manager()) WITH CHECK (public.erp_access_is_manager());
CREATE POLICY machine_grants_delete ON public.integration_machine_grants FOR DELETE TO authenticated USING (public.erp_access_is_manager());
SELECT public.enable_audit_on('integration_machine_grants');
CREATE TABLE public.integration_machine_nonces (
 grant_id uuid NOT NULL REFERENCES public.integration_machine_grants(id) ON DELETE CASCADE,
 nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{16,128}$'),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(grant_id,nonce)
);
GRANT ALL ON public.integration_machine_nonces TO service_role;
ALTER TABLE public.integration_machine_nonces ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.consume_integration_machine_nonce(_grant_id uuid,_nonce text,_timestamp bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE accepted integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Somente verificador interno' USING ERRCODE='42501'; END IF;
 IF _nonce IS NULL OR _nonce !~ '^[A-Za-z0-9_-]{16,128}$' OR _timestamp IS NULL OR abs(extract(epoch from now())-_timestamp)>60 THEN RETURN false; END IF;
 PERFORM 1 FROM public.integration_machine_grants WHERE id=_grant_id AND enabled AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 DELETE FROM public.integration_machine_nonces WHERE (grant_id,nonce) IN (SELECT grant_id,nonce FROM public.integration_machine_nonces WHERE expires_at<now() LIMIT 100);
 INSERT INTO public.integration_machine_nonces(grant_id,nonce,expires_at) VALUES(_grant_id,_nonce,to_timestamp(_timestamp)+interval '120 seconds') ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS accepted=ROW_COUNT;
 RETURN accepted=1;
END $$;
REVOKE ALL ON FUNCTION public.consume_integration_machine_nonce(uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_integration_machine_nonce(uuid,text,bigint) TO service_role;