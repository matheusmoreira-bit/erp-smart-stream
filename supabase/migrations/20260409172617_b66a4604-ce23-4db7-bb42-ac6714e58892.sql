
ALTER TABLE public.approval_rules ADD COLUMN criteria JSONB DEFAULT '[]'::jsonb;
