INSERT INTO public.expense_attachments (expense_id, file_path, file_name, file_size, mime_type)
SELECT (split_part(o.name, '/', 1))::uuid,
       o.name,
       regexp_replace(split_part(o.name, '/', 2), '^[0-9]{10,}_', ''),
       COALESCE((o.metadata->>'size')::bigint, 0),
       COALESCE(o.metadata->>'mimetype', 'application/octet-stream')
FROM storage.objects o
JOIN public.expenses e ON e.id = (split_part(o.name, '/', 1))::uuid
WHERE o.bucket_id = 'expense-attachments'
  AND o.name NOT LIKE 'advances/%'
  AND split_part(o.name, '/', 1) ~ '^[0-9a-f-]{36}$'
  AND NOT EXISTS (
    SELECT 1 FROM public.expense_attachments a WHERE a.file_path = o.name
  );