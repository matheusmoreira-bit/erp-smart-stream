
CREATE POLICY "audit_docs_storage_admin_all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'audit-console-docs' AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'audit-console-docs' AND public.has_role(auth.uid(), 'admin'::public.app_role));
