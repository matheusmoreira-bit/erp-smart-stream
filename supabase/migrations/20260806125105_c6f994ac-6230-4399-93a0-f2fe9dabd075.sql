UPDATE public.expenses
SET current_approver = 'Paula Mourão',
    approval_rule_id = '45b2f2c0-1fcc-4257-821b-620bd1f10458',
    current_level_order = 1,
    original_approver = COALESCE(original_approver, current_approver),
    cost_center = COALESCE(cost_center, '1.3.1.3'),
    project = COALESCE(project, 'ANA GAMING'),
    updated_at = now()
WHERE id = '124e8685-429c-4d11-9cba-644680a8269d'
  AND status = 'pendente_aprovacao';

INSERT INTO public.audit_log (actor_email, action, entity_type, entity_id, company_db, details)
VALUES ('system', 'approval_routing_reprocess', 'expense', '124e8685-429c-4d11-9cba-644680a8269d', 'SBO_ANAGAMING',
  jsonb_build_object('from_approver','Juliana Gavineli','to_approver','Paula Mourão','rule','1.3 Juridico | 1.3.1.3 | ANA | 0k-10k','reason','matriz não casou na criação: CC/projeto só existiam nos itens'));