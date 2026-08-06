CREATE TABLE public.expense_approval_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  segment_key text NOT NULL,
  cost_center text,
  project text,
  amount numeric NOT NULL DEFAULT 0,
  rule_id uuid,
  chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_level integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pendente',
  current_approver text,
  current_approver_email text,
  decided_by text,
  decided_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (expense_id, segment_key)
);

GRANT SELECT ON public.expense_approval_segments TO authenticated;
GRANT ALL ON public.expense_approval_segments TO service_role;

ALTER TABLE public.expense_approval_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read approval segments"
ON public.expense_approval_segments
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role manages approval segments"
ON public.expense_approval_segments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_expense_approval_segments_expense ON public.expense_approval_segments(expense_id);
CREATE INDEX idx_expense_approval_segments_status ON public.expense_approval_segments(status);

CREATE TRIGGER trg_expense_approval_segments_updated_at
BEFORE UPDATE ON public.expense_approval_segments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();