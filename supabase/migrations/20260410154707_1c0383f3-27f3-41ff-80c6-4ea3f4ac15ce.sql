CREATE TABLE public.idp_user_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sap_user_code text NOT NULL,
  sap_user_name text,
  sap_email text,
  idp_provider text NOT NULL DEFAULT 'jumpcloud',
  idp_user_id text,
  idp_email text,
  idp_display_name text,
  status text NOT NULL DEFAULT 'pending',
  linked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(sap_user_code, idp_provider)
);

ALTER TABLE public.idp_user_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to idp_user_mapping"
  ON public.idp_user_mapping FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);