
CREATE POLICY "nf_entrada read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'nf-entrada-files');

CREATE POLICY "nf_entrada admin write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'nf-entrada-files' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "nf_entrada admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'nf-entrada-files' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "nf_entrada admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'nf-entrada-files' AND public.has_role(auth.uid(), 'admin'));
