-- 1) Fornecedores: escrita apenas para administradores ou agentes de cadastro
DROP POLICY IF EXISTS "auth insert fornecedores" ON public.fornecedores;
CREATE POLICY "auth insert fornecedores" ON public.fornecedores
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent());

DROP POLICY IF EXISTS "auth update fornecedores" ON public.fornecedores;
CREATE POLICY "auth update fornecedores" ON public.fornecedores
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent());

-- 2) Catálogo de itens: escrita apenas para administradores ou agentes de cadastro
DROP POLICY IF EXISTS "auth insert item_base" ON public.item_base;
CREATE POLICY "auth insert item_base" ON public.item_base
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent());

DROP POLICY IF EXISTS "auth update item_base" ON public.item_base;
CREATE POLICY "auth update item_base" ON public.item_base
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent());

DROP POLICY IF EXISTS "auth insert item_variante" ON public.item_variante;
CREATE POLICY "auth insert item_variante" ON public.item_variante
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent());

DROP POLICY IF EXISTS "auth update item_variante" ON public.item_variante;
CREATE POLICY "auth update item_variante" ON public.item_variante
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_registration_agent());

-- 3) Diretório SAP: e-mails restritos a admins, ao próprio usuário e a quem
-- participa de uma substituição de aprovador vigente.
DROP POLICY IF EXISTS "user emails readable by authenticated" ON public.sap_user_emails;
CREATE POLICY "user emails readable by authenticated" ON public.sap_user_emails
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      public.current_auth_email() <> ''
      AND (
        lower(coalesce(email, '')) = public.current_auth_email()
        OR lower(coalesce(user_key, '')) = public.canonical_user_key(public.current_auth_email())
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.approver_substitutes s
      WHERE public.current_auth_email() <> ''
        AND (
          lower(coalesce(s.official_email, '')) = public.current_auth_email()
          OR lower(coalesce(s.substitute_email, '')) = public.current_auth_email()
        )
        AND (
          public.canonical_user_key(coalesce(s.official_email, '')) = lower(coalesce(sap_user_emails.user_key, ''))
          OR public.canonical_user_key(coalesce(s.substitute_email, '')) = lower(coalesce(sap_user_emails.user_key, ''))
        )
    )
  );

-- 4) PDFs de NFSe: acesso restrito à empresa dona do arquivo
DROP POLICY IF EXISTS nfse_pdfs_read ON storage.objects;
CREATE POLICY nfse_pdfs_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nfse-pdfs'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_email_allowed_for_company(public.current_auth_email(), split_part(name, '/', 1))
    )
  );

DROP POLICY IF EXISTS nfse_pdfs_insert ON storage.objects;
CREATE POLICY nfse_pdfs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nfse-pdfs'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_email_allowed_for_company(public.current_auth_email(), split_part(name, '/', 1))
    )
  );

DROP POLICY IF EXISTS nfse_pdfs_update ON storage.objects;
CREATE POLICY nfse_pdfs_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'nfse-pdfs'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_email_allowed_for_company(public.current_auth_email(), split_part(name, '/', 1))
    )
  )
  WITH CHECK (
    bucket_id = 'nfse-pdfs'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_email_allowed_for_company(public.current_auth_email(), split_part(name, '/', 1))
    )
  );

-- 5) system_credentials: segredos deixam de ser legíveis pelo cliente.
DROP POLICY IF EXISTS "Admins full access to system_credentials" ON public.system_credentials;

CREATE POLICY system_credentials_select_nonsecret ON public.system_credentials
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND credential_key !~* '(password|secret|token|api_key|apikey|private|certificate|pfx|passphrase|senha|chave)'
  );

CREATE POLICY system_credentials_insert ON public.system_credentials
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY system_credentials_update ON public.system_credentials
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY system_credentials_delete ON public.system_credentials
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.system_credentials FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_credentials TO authenticated;
GRANT ALL ON public.system_credentials TO service_role;