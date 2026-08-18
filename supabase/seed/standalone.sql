-- ============================================================================
-- Seed standalone local: dados sintéticos, sem dump ou dependência de produção.
-- Aplicado depois das migrations via scripts/standalone-seed.sh.
-- ============================================================================

BEGIN;

INSERT INTO public.companies (company_db, display_name, erp_type, is_active)
VALUES
  ('SBO_ANAGAMING', 'ANA Gaming', 'sap', true),
  ('SBO_CACTUS', 'Cactus Tecnologia', 'sap', true),
  ('open_gaming_sa', 'Open Gaming SA', 'sap', true)
ON CONFLICT (company_db) DO UPDATE
SET display_name = EXCLUDED.display_name,
    erp_type = EXCLUDED.erp_type,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH credentials(system_name, company_db, credential_key, credential_value) AS (
VALUES
  ('sap', 'SBO_ANAGAMING', 'service_layer_url', 'http://sap-disabled.local/b1s/v2'),
  ('sap', 'SBO_ANAGAMING', 'company_db', 'SBO_ANAGAMING'),
  ('sap', 'SBO_ANAGAMING', 'username', 'Apiuser'),
  ('sap', 'SBO_ANAGAMING', 'password', 'standalone-disabled'),
  ('sap', 'SBO_ANAGAMING', 'use_hana_db', 'false'),
  ('sap', 'SBO_CACTUS', 'service_layer_url', 'http://sap-disabled.local/b1s/v2'),
  ('sap', 'SBO_CACTUS', 'company_db', 'SBO_CACTUS'),
  ('sap', 'SBO_CACTUS', 'username', 'Apiuser'),
  ('sap', 'SBO_CACTUS', 'password', 'standalone-disabled'),
  ('sap', 'SBO_CACTUS', 'use_hana_db', 'false'),
  ('sap', 'open_gaming_sa', 'service_layer_url', 'http://sap-disabled.local/b1s/v2'),
  ('sap', 'open_gaming_sa', 'company_db', 'open_gaming_sa'),
  ('sap', 'open_gaming_sa', 'username', 'Apiuser'),
  ('sap', 'open_gaming_sa', 'password', 'standalone-disabled'),
  ('sap', 'open_gaming_sa', 'use_hana_db', 'false')
)
SELECT public.upsert_system_credential(
  system_name,
  credential_key,
  credential_value,
  company_db
)
FROM credentials;

WITH local_user AS (
  SELECT id, email
  FROM auth.users
  WHERE lower(email) = 'matheus.moreira@anagaming.com.br'
  LIMIT 1
)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM local_user
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.idp_user_mapping (
  sap_user_code,
  sap_user_name,
  sap_email,
  idp_provider,
  idp_user_id,
  idp_email,
  idp_display_name,
  status,
  linked_at,
  company_name
)
VALUES (
  'matheus.moreira',
  'Matheus Moreira',
  'matheus.moreira@anagaming.com.br',
  'standalone',
  'standalone-matheus',
  'matheus.moreira@anagaming.com.br',
  'Matheus Moreira',
  'linked',
  now(),
  'ANA Gaming'
)
ON CONFLICT (sap_user_code, idp_provider)
DO UPDATE SET sap_email = EXCLUDED.sap_email,
              idp_email = EXCLUDED.idp_email,
              idp_display_name = EXCLUDED.idp_display_name,
              status = EXCLUDED.status,
              updated_at = now();

INSERT INTO public.user_profiles (company_db, user_code, display_name, email)
VALUES
  ('SBO_ANAGAMING', 'matheus.moreira', 'Matheus Moreira', 'matheus.moreira@anagaming.com.br'),
  ('SBO_CACTUS', 'matheus.moreira', 'Matheus Moreira', 'matheus.moreira@anagaming.com.br'),
  ('open_gaming_sa', 'matheus.moreira', 'Matheus Moreira', 'matheus.moreira@anagaming.com.br')
ON CONFLICT (company_db, user_code)
DO UPDATE SET display_name = EXCLUDED.display_name,
              email = EXCLUDED.email,
              updated_at = now();

INSERT INTO public.user_group_assignments (sap_email, group_id)
SELECT 'matheus.moreira@anagaming.com.br', id
FROM public.permission_groups
WHERE name = 'admin'
ON CONFLICT (sap_email, group_id) DO NOTHING;

INSERT INTO public.suppliers (company_db, card_code, card_name, federal_tax_id, sap_sync_status)
VALUES
  ('SBO_ANAGAMING', 'F0001', 'Fornecedor Local de Tecnologia Ltda', '11222333000181', 'synced'),
  ('SBO_ANAGAMING', 'F0002', 'Servicos Demo Brasil SA', '22333444000192', 'synced'),
  ('SBO_CACTUS', 'F0100', 'Cactus Local Fornecimentos Ltda', '33444555000103', 'synced')
ON CONFLICT DO NOTHING;

INSERT INTO public.expenses (
  id,
  company_db,
  supplier_code,
  supplier_name,
  total_amount,
  currency,
  cost_center,
  project,
  remarks,
  status,
  requester_name,
  requester_email,
  current_approver,
  sap_doc_entry,
  sap_doc_num,
  created_by_email,
  created_at,
  updated_at
)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'SBO_ANAGAMING',
    'F0001',
    'Fornecedor Local de Tecnologia Ltda',
    1250.90,
    'BRL',
    '1.6.1',
    'PROJ-LOCAL',
    'Compra local de equipamentos para demonstracao standalone.',
    'rascunho',
    'Matheus Moreira',
    'matheus.moreira@anagaming.com.br',
    'matheus.moreira@anagaming.com.br',
    null,
    null,
    'matheus.moreira@anagaming.com.br',
    now() - interval '2 days',
    now() - interval '2 days'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'SBO_ANAGAMING',
    'F0002',
    'Servicos Demo Brasil SA',
    4380.00,
    'BRL',
    '1.6.2',
    'OPS-LOCAL',
    'Servico mensal ficticio para validar o fluxo de compras.',
    'pendente_aprovacao',
    'Matheus Moreira',
    'matheus.moreira@anagaming.com.br',
    'matheus.moreira@anagaming.com.br',
    null,
    null,
    'matheus.moreira@anagaming.com.br',
    now() - interval '1 day',
    now() - interval '1 day'
  )
ON CONFLICT (id) DO UPDATE
SET total_amount = EXCLUDED.total_amount,
    status = EXCLUDED.status,
    updated_at = now();

INSERT INTO public.expense_items (
  expense_id,
  item_code,
  description,
  quantity,
  unit_price,
  line_total,
  cost_center,
  project
)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'ITEM-DEMO-01', 'Notebook demonstrativo', 1, 1250.90, 1250.90, '1.6.1', 'PROJ-LOCAL'),
  ('22222222-2222-4222-8222-222222222222', 'SERV-DEMO-01', 'Servico mensal demo', 1, 4380.00, 4380.00, '1.6.2', 'OPS-LOCAL')
ON CONFLICT DO NOTHING;

COMMIT;
