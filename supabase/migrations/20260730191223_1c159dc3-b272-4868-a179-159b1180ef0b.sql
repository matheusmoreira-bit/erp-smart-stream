CREATE OR REPLACE FUNCTION public.release_cancelled_document_hashes(_hashes text[])
RETURNS TABLE(file_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF _hashes IS NULL OR array_length(_hashes, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  DELETE FROM public.submitted_document_hashes h
  WHERE h.file_hash = ANY(_hashes)
    AND (
      h.expense_id IS NULL AND FALSE
      OR EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE e.id = h.expense_id AND e.status = 'cancelado'::public.expense_status
      )
      OR (h.expense_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.expenses e WHERE e.id = h.expense_id
      ))
    )
  RETURNING h.file_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.release_cancelled_document_hashes(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_cancelled_document_hashes(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_cancelled_document_hashes(text[]) TO service_role;