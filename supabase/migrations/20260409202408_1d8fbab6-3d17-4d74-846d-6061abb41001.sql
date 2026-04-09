
CREATE TABLE public.pagcorp_account_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL UNIQUE,
  account_name text,
  cost_center text,
  project text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pagcorp_account_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pagcorp_account_mapping"
  ON public.pagcorp_account_mapping
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_pagcorp_account_mapping_updated_at
  BEFORE UPDATE ON public.pagcorp_account_mapping
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
