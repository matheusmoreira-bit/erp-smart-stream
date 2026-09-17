CREATE POLICY "Admins leem arquivos do backup SAP"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sap-archive' AND public.has_role(auth.uid(), 'admin'));
