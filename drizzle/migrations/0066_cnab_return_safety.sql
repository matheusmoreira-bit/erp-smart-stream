-- F05/B19: an expired worker is not proof that a remote payment failed.
CREATE OR REPLACE FUNCTION public.claim_accounts_payable_item(p_item_id uuid)
RETURNS SETOF public.accounts_payable_batch_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.accounts_payable_batch_items AS item
  SET status = 'sap_processing', sap_error = NULL, updated_at = now()
  WHERE item.id = p_item_id
    AND item.sap_payment_doc_entry IS NULL
    AND item.status IN ('remitted', 'scheduled', 'paid', 'sap_error')
    AND EXISTS (
      SELECT 1 FROM public.accounts_payable_batches AS batch
      WHERE batch.id = item.batch_id AND batch.company_db = item.company_db
        AND batch.approved_by IS NOT NULL AND batch.approved_at IS NOT NULL
        AND batch.status = 'processing'
    )
  RETURNING item.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_accounts_payable_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_accounts_payable_item(uuid) TO service_role;

-- Keep the document that was approved stable, including during concurrent edits.
CREATE OR REPLACE FUNCTION public.guard_approved_cnab_batch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF OLD.approved_by IS NOT NULL AND (
    NEW.company_db IS DISTINCT FROM OLD.company_db OR
    NEW.generated_by IS DISTINCT FROM OLD.generated_by OR
    NEW.content IS DISTINCT FROM OLD.content OR
    NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR
    NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
    NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
    NEW.file_sequence IS DISTINCT FROM OLD.file_sequence OR
    NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id OR
    NEW.payment_date IS DISTINCT FROM OLD.payment_date
  ) THEN RAISE EXCEPTION 'approved CNAB document is immutable' USING ERRCODE = '23514'; END IF;
  IF NEW.approved_by IS NOT NULL AND (
    NULLIF(btrim(NEW.generated_by), '') IS NULL OR
    NULLIF(btrim(NEW.approved_by), '') IS NULL OR
    lower(btrim(NEW.generated_by)) = lower(btrim(NEW.approved_by)) OR
    NEW.approved_at IS NULL OR NULLIF(NEW.content, '') IS NULL OR
    NEW.content_sha256 IS NULL OR NEW.content_sha256 !~ '^[a-f0-9]{64}$'
  ) THEN RAISE EXCEPTION 'CNAB approval requires independent actor and document integrity' USING ERRCODE = '23514'; END IF;
  IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL AND
    encode(sha256(convert_to(NEW.content, 'UTF8')), 'hex') IS DISTINCT FROM NEW.content_sha256 THEN
    RAISE EXCEPTION 'CNAB content does not match approved hash' USING ERRCODE = '23514';
  END IF;
  IF OLD.return_sha256 IS NOT NULL AND NEW.return_sha256 IS DISTINCT FROM OLD.return_sha256 THEN
    RAISE EXCEPTION 'CNAB return identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_approved_cnab_batch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_approved_cnab_batch BEFORE UPDATE ON public.accounts_payable_batches
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_cnab_batch();

-- Approval binds the individual titles as well as the remittance file.
CREATE OR REPLACE FUNCTION public.guard_approved_cnab_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  batch_approved text;
  operational_fields text[] := ARRAY['status','return_occurrences','bank_protocol','paid_date','paid_amount',
    'sap_payment_doc_entry','sap_payment_doc_num','sap_error','updated_at'];
BEGIN
  SELECT approved_by INTO batch_approved FROM public.accounts_payable_batches
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.batch_id ELSE OLD.batch_id END FOR UPDATE;
  IF batch_approved IS NOT NULL THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'cannot add/remove approved CNAB titles' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - operational_fields) IS DISTINCT FROM (to_jsonb(OLD) - operational_fields) THEN
      RAISE EXCEPTION 'approved CNAB title is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Moving a title from an unapproved batch into an approved one is also forbidden.
  IF TG_OP = 'UPDATE' AND NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    SELECT approved_by INTO batch_approved FROM public.accounts_payable_batches WHERE id = NEW.batch_id FOR UPDATE;
    IF batch_approved IS NOT NULL THEN RAISE EXCEPTION 'cannot move title into approved CNAB batch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_approved_cnab_item() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_approved_cnab_item BEFORE INSERT OR UPDATE OR DELETE ON public.accounts_payable_batch_items
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_cnab_item();
