
UPDATE public.approval_rules SET is_active=false, updated_at=now()
WHERE id IN (
  '924270ba-5b1f-4205-8453-b5552efcffbc','dbfb7a20-3c72-415a-8e0c-34c2cc3054db',
  '5a30357d-15ef-41ca-95cf-80469e4b6eb5','abb43211-fcb4-4a3c-acea-2ad034311741',
  'e0a1d001-972e-46c1-9573-674800458c88','6adeeefa-04b2-4b80-8610-572ce3dd4558',
  '9ebaabac-a735-415e-8b6b-2530327e43ee'
);

DO $$
DECLARE
  v_prefixes text[] := ARRAY['1.80.%','1.81.%','1.90.%'];
  v_labels   text[] := ARRAY['1.80 INSTITUTO','1.81 TRANSITORIA','1.90 FIL LONDRINA'];
  v_creator  uuid := '787aa280-7b6a-4746-99b3-b973dd034a3b';
  v_prefix   text; v_label text; v_rule_id uuid; i int;
BEGIN
  FOR i IN 1..array_length(v_prefixes,1) LOOP
    v_prefix := v_prefixes[i]; v_label := v_labels[i];

    INSERT INTO public.approval_rules (name, is_active, priority, company_db, criteria, created_by)
    VALUES (v_label || ' - 0 a 10k', true, 200, 'SBO_CACTUS',
      jsonb_build_array(
        jsonb_build_object('field','cost_center','group',0,'operator','like','value',v_prefix),
        jsonb_build_object('field','total_amount','group',1,'groupLogic','and','operator','between','value',0,'value2',10000)
      ), v_creator)
    RETURNING id INTO v_rule_id;
    INSERT INTO public.approval_rule_levels (rule_id, level_order, approver_name, approver_email)
    VALUES (v_rule_id, 1, 'Daniela Camargos', 'daniela.camargos@cactusgaming.net');

    INSERT INTO public.approval_rules (name, is_active, priority, company_db, criteria, created_by)
    VALUES (v_label || ' - 10k a 100k', true, 200, 'SBO_CACTUS',
      jsonb_build_array(
        jsonb_build_object('field','cost_center','group',0,'operator','like','value',v_prefix),
        jsonb_build_object('field','total_amount','group',1,'groupLogic','and','operator','between','value',10000.01,'value2',100000)
      ), v_creator)
    RETURNING id INTO v_rule_id;
    INSERT INTO public.approval_rule_levels (rule_id, level_order, approver_name, approver_email) VALUES
      (v_rule_id, 1, 'Daniela Camargos', 'daniela.camargos@cactusgaming.net'),
      (v_rule_id, 2, 'Juliana Gavineli', 'juliana.gavineli@cactusgaming.net');

    INSERT INTO public.approval_rules (name, is_active, priority, company_db, criteria, created_by)
    VALUES (v_label || ' - 100k a 300k', true, 200, 'SBO_CACTUS',
      jsonb_build_array(
        jsonb_build_object('field','cost_center','group',0,'operator','like','value',v_prefix),
        jsonb_build_object('field','total_amount','group',1,'groupLogic','and','operator','between','value',100000.01,'value2',300000)
      ), v_creator)
    RETURNING id INTO v_rule_id;
    INSERT INTO public.approval_rule_levels (rule_id, level_order, approver_name, approver_email) VALUES
      (v_rule_id, 1, 'Daniela Camargos', 'daniela.camargos@cactusgaming.net'),
      (v_rule_id, 2, 'Juliana Gavineli', 'juliana.gavineli@cactusgaming.net');

    INSERT INTO public.approval_rules (name, is_active, priority, company_db, criteria, created_by)
    VALUES (v_label || ' - Acima de 300k', true, 200, 'SBO_CACTUS',
      jsonb_build_array(
        jsonb_build_object('field','cost_center','group',0,'operator','like','value',v_prefix),
        jsonb_build_object('field','total_amount','group',1,'groupLogic','and','operator','greater_than','value',300000)
      ), v_creator)
    RETURNING id INTO v_rule_id;
    INSERT INTO public.approval_rule_levels (rule_id, level_order, approver_name, approver_email) VALUES
      (v_rule_id, 1, 'Daniela Camargos', 'daniela.camargos@cactusgaming.net'),
      (v_rule_id, 2, 'Juliana Gavineli', 'juliana.gavineli@cactusgaming.net'),
      (v_rule_id, 3, 'Marco Tulio',      'marco.tulio@cactusgaming.net');
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD; v_rule_id uuid; v_prefix text;
BEGIN
  FOR r IN
    SELECT id, cost_center, total_amount FROM public.expenses
    WHERE company_db='SBO_CACTUS' AND status='pendente_aprovacao'
      AND (cost_center LIKE '1.80.%' OR cost_center LIKE '1.81.%' OR cost_center LIKE '1.90.%')
  LOOP
    v_prefix := CASE
      WHEN r.cost_center LIKE '1.80.%' THEN '1.80.%'
      WHEN r.cost_center LIKE '1.81.%' THEN '1.81.%'
      ELSE '1.90.%' END;
    SELECT id INTO v_rule_id FROM public.approval_rules
    WHERE company_db='SBO_CACTUS' AND is_active=true AND priority=200
      AND criteria @> jsonb_build_array(jsonb_build_object('field','cost_center','operator','like','value',v_prefix))
      AND (
        (r.total_amount <= 10000 AND name LIKE '%0 a 10k')
        OR (r.total_amount > 10000 AND r.total_amount <= 100000 AND name LIKE '%10k a 100k')
        OR (r.total_amount > 100000 AND r.total_amount <= 300000 AND name LIKE '%100k a 300k')
        OR (r.total_amount > 300000 AND name LIKE '%Acima de 300k')
      ) LIMIT 1;
    IF v_rule_id IS NOT NULL THEN
      PERFORM public.reassign_approval_rule_safe(r.id, v_rule_id);
    END IF;
  END LOOP;
END $$;
