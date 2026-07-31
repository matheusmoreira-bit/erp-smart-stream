UPDATE public.expenses e
SET current_approver = 'Juliana Gavineli',
    approval_rule_id = 'fb1b4aad-31a1-4a30-8612-c99abf25d033',
    current_level_order = 1,
    original_approver = COALESCE(e.original_approver, e.current_approver),
    updated_at = now()
WHERE e.id = '166fdccb-0029-4b91-bd2a-996197c7e08c'
  AND e.status = 'pendente_aprovacao';

INSERT INTO public.audit_log (actor_email, action, entity_type, entity_id, company_db, details)
SELECT 'system:approval-routing-fix',
       'approval_routing_reprocess',
       'expense',
       '166fdccb-0029-4b91-bd2a-996197c7e08c',
       'SBO_ANAGAMING',
       jsonb_build_object(
         'from_approver', 'matheus.moreira',
         'to_approver', 'Juliana Gavineli',
         'cost_center', '1.80.1.3',
         'reason', 'CC sem regra na matriz; roteado pelo ramo 1.80 (regra 1.80.1.1 INSTITUTO ANA GAMING - AP4)'
       );