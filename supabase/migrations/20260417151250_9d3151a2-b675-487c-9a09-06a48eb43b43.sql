-- Permitir uploads/leitura/delete do bucket expense-attachments para o role anon,
-- alinhando com as políticas das tabelas expenses/expense_attachments.
-- O app utiliza login customizado (SAP), portanto a sessão Supabase Auth não está presente
-- e usamos o role anon para todas as operações da camada cliente.

CREATE POLICY "Anon can upload expense attachments"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'expense-attachments');

CREATE POLICY "Anon can read expense attachments"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'expense-attachments');

CREATE POLICY "Anon can update expense attachments"
ON storage.objects
FOR UPDATE
TO anon
USING (bucket_id = 'expense-attachments');

CREATE POLICY "Anon can delete expense attachments"
ON storage.objects
FOR DELETE
TO anon
USING (bucket_id = 'expense-attachments');