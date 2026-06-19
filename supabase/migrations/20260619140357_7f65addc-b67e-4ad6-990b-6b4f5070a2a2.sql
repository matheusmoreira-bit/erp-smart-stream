ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS items_group_code integer,
  ADD COLUMN IF NOT EXISTS items_group_name text;