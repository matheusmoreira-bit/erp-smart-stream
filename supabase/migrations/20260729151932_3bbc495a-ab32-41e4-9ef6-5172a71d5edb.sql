CREATE POLICY "nfse_pdfs_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'nfse-pdfs' AND auth.uid() IS NOT NULL);
CREATE POLICY "nfse_pdfs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nfse-pdfs' AND auth.uid() IS NOT NULL);
CREATE POLICY "nfse_pdfs_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'nfse-pdfs' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'nfse-pdfs' AND auth.uid() IS NOT NULL);
CREATE POLICY "nfse_pdfs_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'nfse-pdfs' AND public.has_role(auth.uid(), 'admin'));