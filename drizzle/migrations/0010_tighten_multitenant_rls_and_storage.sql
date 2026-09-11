-- 1) Arquivos fiscais: remover leitura anônima do bucket nf-entrada-files
DROP POLICY IF EXISTS "nf_entrada read" ON storage.objects;
CREATE POLICY "nf_entrada read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nf-entrada-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.nf_entrada_imports i
        WHERE public.is_email_allowed_for_company(public.current_auth_email(), i.sap_company_db)
          AND (
            storage.objects.name LIKE '%' || i.id::text || '%'
            OR (i.chave_acesso IS NOT NULL AND storage.objects.name LIKE '%' || i.chave_acesso || '%')
          )
      )
    )
  );

-- 2) sap_cache: leitura e exclusão restritas à empresa do usuário
DROP POLICY IF EXISTS "Authenticated can read sap_cache" ON public.sap_cache;
CREATE POLICY "Authenticated can read sap_cache" ON public.sap_cache
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

DROP POLICY IF EXISTS "Authenticated can delete sap_cache" ON public.sap_cache;
CREATE POLICY "Authenticated can delete sap_cache" ON public.sap_cache
  FOR DELETE TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

-- 3) Caches e cadastros multiempresa: leitura escopada por empresa
DROP POLICY IF EXISTS "Authenticated can read suppliers" ON public.suppliers;
CREATE POLICY "Authenticated can read suppliers" ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

DROP POLICY IF EXISTS "Authenticated read nf_entrada_imports" ON public.nf_entrada_imports;
CREATE POLICY "Authenticated read nf_entrada_imports" ON public.nf_entrada_imports
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), sap_company_db));

DROP POLICY IF EXISTS "Authenticated can read PO cache" ON public.sap_purchase_order_cache;
CREATE POLICY "Authenticated can read PO cache" ON public.sap_purchase_order_cache
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

DROP POLICY IF EXISTS "Authenticated can read vendor payment cache" ON public.sap_vendor_payment_cache;
CREATE POLICY "Authenticated can read vendor payment cache" ON public.sap_vendor_payment_cache
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

DROP POLICY IF EXISTS "authenticated read sap_fluxo_analise_cache" ON public.sap_fluxo_analise_cache;
CREATE POLICY "authenticated read sap_fluxo_analise_cache" ON public.sap_fluxo_analise_cache
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

DROP POLICY IF EXISTS "authenticated read sap_po_nf_cp_cache" ON public.sap_po_nf_cp_cache;
CREATE POLICY "authenticated read sap_po_nf_cp_cache" ON public.sap_po_nf_cp_cache
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

DROP POLICY IF EXISTS "Authenticated can read reconciliation" ON public.sap_total_reconciliation;
CREATE POLICY "Authenticated can read reconciliation" ON public.sap_total_reconciliation
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

DROP POLICY IF EXISTS "authenticated can read nf_ap links" ON public.nf_entrada_contas_pagar;
CREATE POLICY "authenticated can read nf_ap links" ON public.nf_entrada_contas_pagar
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

-- revisões de despesa seguem a empresa da despesa de origem
DROP POLICY IF EXISTS "Authenticated can read expense revisions" ON public.expense_revisions;
CREATE POLICY "Authenticated can read expense revisions" ON public.expense_revisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_revisions.expense_id
        AND public.is_email_allowed_for_company(public.current_auth_email(), e.company_db)
    )
  );

-- 4) Classificação PagCorp: escrita apenas por admin/serviço, leitura por empresa
DROP POLICY IF EXISTS "Authenticated can insert pagcorp classification" ON public.pagcorp_document_classification;
DROP POLICY IF EXISTS "Authenticated can update pagcorp classification" ON public.pagcorp_document_classification;
DROP POLICY IF EXISTS "Authenticated can read pagcorp classification" ON public.pagcorp_document_classification;

CREATE POLICY "Admins can insert pagcorp classification" ON public.pagcorp_document_classification
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update pagcorp classification" ON public.pagcorp_document_classification
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read pagcorp classification" ON public.pagcorp_document_classification
  FOR SELECT TO authenticated
  USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));

CREATE POLICY "service_role manages pagcorp classification" ON public.pagcorp_document_classification
  FOR ALL TO service_role USING (true) WITH CHECK (true);