CREATE POLICY "Anon can upload expense attachments"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'expense-attachments');

GRANT SELECT, INSERT ON public.expense_attachments TO anon;

CREATE POLICY "Anon can insert expense_attachments"
ON public.expense_attachments
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Anon can read expense_attachments"
ON public.expense_attachments
FOR SELECT
TO anon
USING (true);