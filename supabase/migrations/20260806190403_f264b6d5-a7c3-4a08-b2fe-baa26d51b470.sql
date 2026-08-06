UPDATE public.expenses
SET project = 'BET.BET',
    status = 'pendente_aprovacao',
    approval_rule_id = '1ee6138d-87d9-4b7c-9b9a-cb315fdefb79',
    current_level_order = 1,
    current_approver = 'Jose Victor',
    original_approver = COALESCE(original_approver, current_approver),
    updated_at = now()
WHERE id = '2d9d87cf-adb3-4830-be4e-078e4ee9b251';

UPDATE public.expense_items
SET project = 'BET.BET'
WHERE expense_id = '2d9d87cf-adb3-4830-be4e-078e4ee9b251';

INSERT INTO public.audit_log (actor_email, action, entity_type, entity_id, company_db, details)
VALUES ('sistema@erpflow', 'expense_return_to_approval', 'expense', '2d9d87cf-adb3-4830-be4e-078e4ee9b251', 'open_gaming_sa',
 jsonb_build_object('from_status','pc_lancado','to_status','pendente_aprovacao','project_from','OPEN GAMING','project_to','BET.BET','approver','Jose Victor','rule','1.8 Novos Negocios | 1.8.1.1,1.8.1.4,1.8.1.6 | 0-300k | BET.BET'));