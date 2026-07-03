DROP POLICY IF EXISTS "Anon can upload expense attachments"          ON storage.objects;
DROP POLICY IF EXISTS "Anon can read expense attachments"            ON storage.objects;
DROP POLICY IF EXISTS "Anon can update expense attachments"          ON storage.objects;
DROP POLICY IF EXISTS "Anon can delete expense attachments"          ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read expense attachments"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload expense attachments" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update expense attachments"        ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete expense attachments"        ON storage.objects;
DROP POLICY IF EXISTS "Allow all access to expense attachments storage" ON storage.objects;
