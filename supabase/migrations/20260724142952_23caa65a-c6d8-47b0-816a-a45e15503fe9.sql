-- Fase S2.2 — remover políticas USING(true)/WITH CHECK(true) de escrita
-- em tabelas onde nenhuma escrita legítima vem da SPA anon.
-- Edge functions usam service_role (bypass de RLS) e Backoffice usa
-- has_role('admin'), portanto nada quebra.

------------------------------------------------------------------
-- suppliers
------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Authenticated can update suppliers" ON public.suppliers;

------------------------------------------------------------------
-- user_profiles
------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated insert user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Authenticated update user_profiles" ON public.user_profiles;

------------------------------------------------------------------
-- sap_cache — mantém SELECT anon + DELETE anon (invalidação client)
------------------------------------------------------------------
DROP POLICY IF EXISTS "Anon can insert sap_cache"          ON public.sap_cache;
DROP POLICY IF EXISTS "Anon can update sap_cache"          ON public.sap_cache;
DROP POLICY IF EXISTS "Authenticated can insert sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Authenticated can update sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Authenticated can delete sap_cache" ON public.sap_cache;

------------------------------------------------------------------
-- pagcorp_settlement_accounts — Backoffice admin only
------------------------------------------------------------------
DROP POLICY IF EXISTS "App can insert pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "App can update pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "App can delete pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
-- Mantém "App can read" (anon+authenticated SELECT true) e admin ALL.

------------------------------------------------------------------
-- pagcorp_supplier_links
------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can insert pagcorp_supplier_links" ON public.pagcorp_supplier_links;
DROP POLICY IF EXISTS "Authenticated can update pagcorp_supplier_links" ON public.pagcorp_supplier_links;
DROP POLICY IF EXISTS "Authenticated can delete pagcorp_supplier_links" ON public.pagcorp_supplier_links;

------------------------------------------------------------------
-- pagcorp_card_mapping
------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can insert pagcorp_card_mapping" ON public.pagcorp_card_mapping;
DROP POLICY IF EXISTS "Authenticated can update pagcorp_card_mapping" ON public.pagcorp_card_mapping;
DROP POLICY IF EXISTS "Authenticated can delete pagcorp_card_mapping" ON public.pagcorp_card_mapping;

------------------------------------------------------------------
-- pagcorp_cards
------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can upsert pagcorp_cards" ON public.pagcorp_cards;
DROP POLICY IF EXISTS "Authenticated can update pagcorp_cards" ON public.pagcorp_cards;

------------------------------------------------------------------
-- pagcorp_nondeductible_expenses
------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can insert nondeductible expenses" ON public.pagcorp_nondeductible_expenses;
DROP POLICY IF EXISTS "Authenticated can update nondeductible expenses" ON public.pagcorp_nondeductible_expenses;
DROP POLICY IF EXISTS "Authenticated can delete nondeductible expenses" ON public.pagcorp_nondeductible_expenses;

------------------------------------------------------------------
-- pagcorp_integration_log — write só via admin ou service_role
------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can insert pagcorp integration logs" ON public.pagcorp_integration_log;