-- A revogação da Onda 1 tirou também o acesso do usuário logado à tabela
-- companies, deixando o seletor de empresas vazio. Restaura o SELECT por
-- coluna (campos sensíveis seguem só via admin_list_companies()).
GRANT SELECT (
  id, company_db, display_name, is_active, created_at, updated_at, targets,
  erp_type, default_currency, timezone, logo_url, trade_name, is_foreign, is_test
) ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;