
CREATE TABLE public.companies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to companies"
  ON public.companies FOR ALL
  USING (true)
  WITH CHECK (true);

-- Seed existing companies
INSERT INTO public.companies (company_db, display_name) VALUES
  ('SBO_ANAGAMING', 'ANA Gaming'),
  ('SBO_CACTUS', 'Cactus'),
  ('SBO_INSTITUTO_ANA', 'Instituto Cactus');
