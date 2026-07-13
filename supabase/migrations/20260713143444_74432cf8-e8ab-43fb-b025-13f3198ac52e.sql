
DROP POLICY IF EXISTS "Authenticated can read pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "Authenticated can insert pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "Authenticated can update pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "Authenticated can delete pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;

CREATE POLICY "App can read pagcorp_settlement_accounts"
ON public.pagcorp_settlement_accounts FOR SELECT
TO anon, authenticated USING (true);

CREATE POLICY "App can insert pagcorp_settlement_accounts"
ON public.pagcorp_settlement_accounts FOR INSERT
TO anon, authenticated WITH CHECK (true);

CREATE POLICY "App can update pagcorp_settlement_accounts"
ON public.pagcorp_settlement_accounts FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "App can delete pagcorp_settlement_accounts"
ON public.pagcorp_settlement_accounts FOR DELETE
TO anon, authenticated USING (true);
