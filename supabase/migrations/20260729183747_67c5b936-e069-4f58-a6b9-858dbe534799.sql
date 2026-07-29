ALTER TABLE public.nfse_email_recipients
  ADD COLUMN IF NOT EXISTS customer_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_name text;

ALTER TABLE public.nfse_email_recipients
  DROP CONSTRAINT IF EXISTS nfse_email_recipients_company_db_project_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS nfse_email_recipients_company_customer_project_key
  ON public.nfse_email_recipients (company_db, customer_code, project_code);

CREATE INDEX IF NOT EXISTS nfse_email_recipients_customer_idx
  ON public.nfse_email_recipients (company_db, customer_code);

CREATE OR REPLACE FUNCTION public.nfse_recipients_max_brands()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  qty integer;
BEGIN
  IF coalesce(NEW.customer_code, '') = '' OR NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO qty
  FROM public.nfse_email_recipients r
  WHERE r.company_db = NEW.company_db
    AND r.customer_code = NEW.customer_code
    AND r.is_active
    AND r.id <> NEW.id;
  IF qty >= 3 THEN
    RAISE EXCEPTION 'Cada cliente pode ter no máximo 3 marcas vinculadas (cliente %).', NEW.customer_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfse_recipients_max_brands ON public.nfse_email_recipients;
CREATE TRIGGER trg_nfse_recipients_max_brands
  BEFORE INSERT OR UPDATE ON public.nfse_email_recipients
  FOR EACH ROW EXECUTE FUNCTION public.nfse_recipients_max_brands();

CREATE OR REPLACE FUNCTION public.can_manage_nfse_recipients()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.user_group_assignments uga
      JOIN public.permission_groups pg ON pg.id = uga.group_id
      WHERE lower(uga.sap_email) = lower(coalesce(public.current_auth_email(), '@'))
        AND (
          lower(pg.name) LIKE '%contas a receber%'
          OR lower(pg.name) = 'admin'
        )
    );
$$;

DROP POLICY IF EXISTS "nfse_email_recipients_ar_write" ON public.nfse_email_recipients;
CREATE POLICY "nfse_email_recipients_ar_write"
  ON public.nfse_email_recipients
  FOR ALL
  TO authenticated
  USING (public.can_manage_nfse_recipients())
  WITH CHECK (public.can_manage_nfse_recipients());