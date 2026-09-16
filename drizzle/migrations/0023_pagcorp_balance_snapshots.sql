CREATE TABLE IF NOT EXISTS public.pagcorp_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  account text NOT NULL,
  alias text,
  account_type text,
  parent_account text,
  cost_center text,
  available numeric NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pagcorp_balance_snapshots_uniq
  ON public.pagcorp_balance_snapshots (company_db, account, snapshot_date);
CREATE INDEX IF NOT EXISTS pagcorp_balance_snapshots_company_date
  ON public.pagcorp_balance_snapshots (company_db, snapshot_date DESC);

GRANT SELECT ON public.pagcorp_balance_snapshots TO authenticated;
GRANT ALL ON public.pagcorp_balance_snapshots TO service_role;

ALTER TABLE public.pagcorp_balance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pagcorp balances readable by company members" ON public.pagcorp_balance_snapshots;
CREATE POLICY "pagcorp balances readable by company members"
ON public.pagcorp_balance_snapshots
FOR SELECT
TO authenticated
USING (public.is_email_allowed_for_company(public.current_auth_email(), company_db));
