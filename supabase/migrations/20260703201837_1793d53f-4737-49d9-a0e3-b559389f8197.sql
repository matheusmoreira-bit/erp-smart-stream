-- Close write policies on internal expense tables.
-- All mutations now go through edge functions with service_role:
--   - expense-mutation (create/update/submit/cancel/attachments/log)
--   - expense-approval-action (approve/reject)
-- SELECT policies are intentionally left untouched to preserve the existing
-- client-side read paths (the app authenticates users via SAP, not auth.uid,
-- so there is no meaningful auth.uid() gate for reads yet).

-- ── expenses ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can delete expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated can delete expenses" ON public.expenses;

-- ── expense_items ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon can insert expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can update expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can delete expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Authenticated can insert expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Authenticated can update expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Authenticated can delete expense_items" ON public.expense_items;

-- ── expense_attachments ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon can insert expense_attachments" ON public.expense_attachments;
DROP POLICY IF EXISTS "Authenticated can insert expense_attachments" ON public.expense_attachments;
-- (there are no anon UPDATE/DELETE policies on this table, but drop-if-exists
--  is safe idempotent)
DROP POLICY IF EXISTS "Anon can update expense_attachments" ON public.expense_attachments;
DROP POLICY IF EXISTS "Anon can delete expense_attachments" ON public.expense_attachments;
DROP POLICY IF EXISTS "Authenticated can update expense_attachments" ON public.expense_attachments;
DROP POLICY IF EXISTS "Authenticated can delete expense_attachments" ON public.expense_attachments;

-- Note: "Admins can manage <table>" policies remain in place so a Cloud
-- admin (via has_role) can still fix records directly if ever needed.
-- service_role bypasses RLS entirely, so edge functions keep working.

-- ── expense_approval_log ─────────────────────────────────────────────────
-- Existing INSERT policy already restricts to admin OR owner/approver via
-- auth.uid()/email — since SAP users have no auth.uid the effective path
-- was already through service_role. Nothing to change here; keep as-is.
