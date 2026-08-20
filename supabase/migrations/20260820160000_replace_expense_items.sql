-- Atualiza cabeçalho e substitui todas as linhas em uma única transação. Se
-- qualquer linha falhar, o pedido anterior permanece integralmente intacto.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revision_note text;

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_revision_number_positive;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_revision_number_positive CHECK (revision_number >= 1);

CREATE OR REPLACE FUNCTION public.update_expense_with_items(
  _expense_id uuid,
  _updates jsonb,
  _items jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.expenses%ROWTYPE;
BEGIN
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'O pedido precisa ter ao menos um item';
  END IF;

  SELECT * INTO current_row
  FROM public.expenses
  WHERE id = _expense_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  current_row := jsonb_populate_record(current_row, COALESCE(_updates, '{}'::jsonb));

  UPDATE public.expenses SET
    supplier_name = current_row.supplier_name,
    supplier_code = current_row.supplier_code,
    remarks = current_row.remarks,
    doc_date = current_row.doc_date,
    due_date = current_row.due_date,
    rateio_type = current_row.rateio_type,
    total_amount = current_row.total_amount,
    cost_center = current_row.cost_center,
    project = current_row.project,
    approval_rule_id = current_row.approval_rule_id,
    current_level_order = current_row.current_level_order,
    current_approver = current_row.current_approver,
    status = current_row.status,
    sap_integration_error = current_row.sap_integration_error,
    sap_purchase_order_status = current_row.sap_purchase_order_status,
    revision_number = current_row.revision_number,
    revision_note = current_row.revision_note
  WHERE id = _expense_id;

  DELETE FROM public.expense_items WHERE expense_id = _expense_id;

  INSERT INTO public.expense_items (
    expense_id, item_code, description, quantity, unit_price, line_total,
    cost_center, project, items_group_code, items_group_name
  )
  SELECT
    _expense_id,
    NULLIF(BTRIM(item->>'item_code'), ''),
    BTRIM(item->>'description'),
    (item->>'quantity')::numeric,
    (item->>'unit_price')::numeric,
    (item->>'line_total')::numeric,
    NULLIF(BTRIM(item->>'cost_center'), ''),
    NULLIF(BTRIM(item->>'project'), ''),
    NULLIF(item->>'items_group_code', '')::integer,
    NULLIF(BTRIM(item->>'items_group_name'), '')
  FROM jsonb_array_elements(_items) AS item;
END;
$$;

REVOKE ALL ON FUNCTION public.update_expense_with_items(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_expense_with_items(uuid, jsonb, jsonb) TO service_role;
