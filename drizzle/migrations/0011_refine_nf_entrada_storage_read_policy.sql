DROP POLICY IF EXISTS "nf_entrada read" ON storage.objects;
CREATE POLICY "nf_entrada read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nf-entrada-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.nf_entrada_imports i
        WHERE (i.xml_storage_path = storage.objects.name OR i.pdf_storage_path = storage.objects.name)
          AND public.is_email_allowed_for_company(public.current_auth_email(), i.sap_company_db)
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_nf_entrada_imports_xml_path ON public.nf_entrada_imports (xml_storage_path);
CREATE INDEX IF NOT EXISTS idx_nf_entrada_imports_pdf_path ON public.nf_entrada_imports (pdf_storage_path);