-- 1) Limpeza de chaves obsoletas (substituídas por can_create/can_edit)
DELETE FROM public.permission_group_modules WHERE module_key IN ('suppliers_write','items_write');

-- 2) Baseline: notificações + histórico de aprovações para todo grupo que já vê aprovações
INSERT INTO public.permission_group_modules (group_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_integrate, can_export)
SELECT g.id, 'notifications', true, false, false, false, false, false, false
FROM public.permission_groups g
ON CONFLICT (group_id, module_key) DO UPDATE SET can_view = true;

INSERT INTO public.permission_group_modules (group_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_integrate, can_export)
SELECT m.group_id, 'approval_history', true, false, false, false, false, false, true
FROM public.permission_group_modules m
WHERE m.module_key = 'approvals' AND m.can_view
ON CONFLICT (group_id, module_key) DO UPDATE SET can_view = true;

-- 3) Novas capabilities configuráveis no grupo, semeadas com o comportamento atual
--    (antes decidido por NOME do grupo no código).
WITH cap(name, keys) AS (
  VALUES
    ('Admin', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all','suppliers_register_direct','items_restricted_all','drafts_view_all','test_companies_view','view_all_default_on','expenses_cancel','approvals_delegate','approvals_transfer','approvals_override','suppliers_reactivate']),
    ('CFO', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all']),
    ('Contábil', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all']),
    ('Contas a Pagar', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all']),
    ('Facilities', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all','suppliers_register_direct','suppliers_reactivate']),
    ('Financeiro', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all']),
    ('Financeiro - Contas a Receber', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all']),
    ('Fiscal', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all']),
    ('PagCorp', ARRAY['expenses_view_all','approvals_view_all','cost_centers_view_all']),
    ('Usuário Administrativo', ARRAY['documents_view_directorate','cost_centers_view_all'])
)
INSERT INTO public.permission_group_modules (group_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_integrate, can_export)
SELECT g.id, k, true, false, false, false, false, false, false
FROM cap
JOIN public.permission_groups g ON g.name = cap.name
CROSS JOIN LATERAL unnest(cap.keys) AS k
ON CONFLICT (group_id, module_key) DO UPDATE SET can_view = true;

-- 4) Admin enxerga todas as telas do catálogo
INSERT INTO public.permission_group_modules (group_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_integrate, can_export)
SELECT g.id, k, true, true, true, true, true, true, true
FROM public.permission_groups g
CROSS JOIN unnest(ARRAY[
  'expenses','sales','approvals','approval_history','approval_rules','financial_review','nf_entrada',
  'suppliers','items','pagcorp','intercompany','synapse','credentials','users'
]) AS k
WHERE g.name = 'Admin'
ON CONFLICT (group_id, module_key) DO UPDATE
  SET can_view = true, can_create = true, can_edit = true, can_delete = true,
      can_approve = true, can_integrate = true, can_export = true;

INSERT INTO public.permission_group_modules (group_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_integrate, can_export)
SELECT g.id, k, true, false, false, false, false, false, true
FROM public.permission_groups g
CROSS JOIN unnest(ARRAY[
  'analytics','analytics_payments','users_productivity','notifications','integration_history',
  'employee_integration','audit_log','fiscal_audit','audit_console','kyp'
]) AS k
WHERE g.name = 'Admin'
ON CONFLICT (group_id, module_key) DO UPDATE SET can_view = true;

-- 5) Descrições padrão para grupos sem descrição
UPDATE public.permission_groups SET description = 'Diretoria financeira — visão consolidada de compras, aprovações e analytics.'
  WHERE name = 'CFO' AND coalesce(description,'') = '';
UPDATE public.permission_groups SET description = 'Financeiro — compras, aprovações, adiantamentos, cartões e cadastros.'
  WHERE name = 'Financeiro' AND coalesce(description,'') = '';
UPDATE public.permission_groups SET description = 'Operação de cartões corporativos (PagCorp) — conciliação e itens.'
  WHERE name = 'PagCorp' AND coalesce(description,'') = '';
UPDATE public.permission_groups SET description = 'Acesso total ao sistema e ao backoffice.'
  WHERE name = 'Admin';

-- 6) Remove grupos vazios (sem usuários e sem nenhuma permissão)
DELETE FROM public.permission_groups g
WHERE NOT EXISTS (SELECT 1 FROM public.user_group_assignments u WHERE u.group_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM public.permission_group_modules m WHERE m.group_id = g.id AND m.can_view);