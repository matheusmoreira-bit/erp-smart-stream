-- Approved by Hiller and applied in 0078_erp_access_storage_restriction.sql.
-- Restrictive policies never grant access;
-- existing bucket, company, ownership and MFA permissions remain mandatory.
-- Covers all seven currently private ERP buckets, including SAP archive.
CREATE POLICY erp_access_storage_select
ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (public.erp_access_admitted());

CREATE POLICY erp_access_storage_insert
ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
WITH CHECK (public.erp_access_admitted());

CREATE POLICY erp_access_storage_update
ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
USING (public.erp_access_admitted())
WITH CHECK (public.erp_access_admitted());

CREATE POLICY erp_access_storage_delete
ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
USING (public.erp_access_admitted());