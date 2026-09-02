CREATE TABLE public.expense_revisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  changed_by_name TEXT,
  changed_by_email TEXT,
  status_before TEXT,
  status_after TEXT,
  resubmitted BOOLEAN NOT NULL DEFAULT false,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_revisions_expense ON public.expense_revisions (expense_id, revision_number DESC);

GRANT SELECT ON public.expense_revisions TO authenticated;
GRANT ALL ON public.expense_revisions TO service_role;

ALTER TABLE public.expense_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read expense revisions"
ON public.expense_revisions
FOR SELECT
TO authenticated
USING (true);