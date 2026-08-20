-- Deprecated migration.
-- Do not version JumpCloud credentials in SQL migrations.
-- Configure jumpcloud.org_id and jumpcloud.api_key via the credentials UI
-- or Supabase secrets/Vault after rotating the exposed values.
SELECT 1;
