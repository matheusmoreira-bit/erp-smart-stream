CREATE POLICY "attachment_backup_admin_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id IN ('expense-attachments', 'nfse-xmls')
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);