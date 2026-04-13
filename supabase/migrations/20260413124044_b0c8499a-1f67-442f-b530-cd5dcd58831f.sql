
-- 1. Make expense-attachments bucket private
UPDATE storage.buckets SET public = false WHERE id = 'expense-attachments';

-- 2. Drop the overly permissive public policy
DROP POLICY IF EXISTS "Allow all access to expense attachments storage" ON storage.objects;

-- 3. Authenticated users can read expense attachments
CREATE POLICY "Authenticated can read expense attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'expense-attachments');

-- 4. Authenticated users can upload expense attachments
CREATE POLICY "Authenticated can upload expense attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'expense-attachments');

-- 5. Admins can update/delete expense attachments
CREATE POLICY "Admins can update expense attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'expense-attachments' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete expense attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'expense-attachments' AND public.has_role(auth.uid(), 'admin'::public.app_role));
