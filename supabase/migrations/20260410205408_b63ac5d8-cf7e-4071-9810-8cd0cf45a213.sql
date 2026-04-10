
-- New table for item mapping (independent of cost center mapping)
CREATE TABLE public.pagcorp_item_mapping (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_code text,
  account_name text,
  item_code text NOT NULL,
  is_fallback boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint: one mapping per account_code (nullable for fallback)
CREATE UNIQUE INDEX idx_pagcorp_item_mapping_account ON public.pagcorp_item_mapping (account_code) WHERE account_code IS NOT NULL;
-- Only one fallback row allowed
CREATE UNIQUE INDEX idx_pagcorp_item_mapping_fallback ON public.pagcorp_item_mapping (is_fallback) WHERE is_fallback = true;

ALTER TABLE public.pagcorp_item_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access pagcorp_item_mapping" ON public.pagcorp_item_mapping
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anon can read pagcorp_item_mapping" ON public.pagcorp_item_mapping
  FOR SELECT TO anon USING (true);

-- Remove item_code from account mapping table (now separate)
ALTER TABLE public.pagcorp_account_mapping DROP COLUMN IF EXISTS item_code;
