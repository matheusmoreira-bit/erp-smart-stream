
DO $$
DECLARE
  v_rule1 uuid;
  v_rule2 uuid;
BEGIN
  INSERT INTO public.approval_rules (name, is_active, priority, criteria, doc_type, created_by, company_db)
  VALUES (
    'Cactus Tec - Até 1.000.000',
    true,
    10,
    '[{"field":"total_amount","operator":"less_than","value":"1000000.01"}]'::jsonb,
    'both',
    'system',
    'SBO_CACTUS'
  ) RETURNING id INTO v_rule1;

  INSERT INTO public.approval_rule_levels (rule_id, level_order, approver_name, approver_email)
  VALUES (v_rule1, 1, 'Juliana Gavineli', 'juliana.gavineli@cactusgaming.net');

  INSERT INTO public.approval_rules (name, is_active, priority, criteria, doc_type, created_by, company_db)
  VALUES (
    'Cactus Tec - Acima de 1.000.000',
    true,
    20,
    '[{"field":"total_amount","operator":"greater_than","value":"1000000"}]'::jsonb,
    'both',
    'system',
    'SBO_CACTUS'
  ) RETURNING id INTO v_rule2;

  INSERT INTO public.approval_rule_levels (rule_id, level_order, approver_name, approver_email) VALUES
    (v_rule2, 1, 'Juliana Gavineli', 'juliana.gavineli@cactusgaming.net'),
    (v_rule2, 2, 'Marco Tulio', 'marco.tulio@cactusgaming.net');
END $$;
