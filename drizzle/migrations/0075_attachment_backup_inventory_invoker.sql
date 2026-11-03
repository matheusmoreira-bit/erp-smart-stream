CREATE FUNCTION public.attachment_backup_inventory(p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
SET statement_timeout = '20s'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrador com MFA obrigatório' USING ERRCODE = '42501';
  END IF;
  IF p_bucket IS NULL OR p_bucket NOT IN ('expense-attachments', 'sap-archive', 'registration-attachments', 'nf-entrada-files', 'nfse-pdfs', 'nfse-xmls') THEN
    RAISE EXCEPTION 'Bucket inválido' USING ERRCODE = '22023';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', o.name,
      'bytes', o.metadata ->> 'size',
      'version', o.updated_at
    ) ORDER BY o.name), '[]'::jsonb)
    FROM storage.objects AS o
    WHERE o.bucket_id = p_bucket
  );
END;
$$;
REVOKE ALL ON FUNCTION public.attachment_backup_inventory(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attachment_backup_inventory(text) TO authenticated;
COMMENT ON FUNCTION public.attachment_backup_inventory(text) IS 'Read-only inventory through caller privileges and existing Storage RLS; no elevated access or download URLs.';