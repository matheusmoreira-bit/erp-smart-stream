-- 1) Reparar os 2 documentos OPEN GAMING revertidos hoje: Leonardo já havia aprovado o nível 1 em 07/07,
--    a reavaliação de regra de hoje resetou para nível 1. Voltar para o estado correto: nível 2 (Santiago).

UPDATE public.expenses
SET current_level_order = 2,
    current_approver    = 'Santiago Macedo',
    updated_at          = now()
WHERE id IN (
  'd4d60c52-eb1a-4fa6-b0f1-ae1e3fbf9ed9',
  'c39ba504-d33d-46da-b6f7-654ac9bb39f4'
)
  AND status = 'pendente_aprovacao';

INSERT INTO public.expense_approval_log
  (expense_id, decision, approver_name, approver_email, level_order, remarks)
VALUES
  ('d4d60c52-eb1a-4fa6-b0f1-ae1e3fbf9ed9', 'submitted', 'Sistema', 'system@lovable', 2,
   'Correção: aprovação do nível 1 por Leonardo Rossini (07/07 21:09) foi preservada. A reavaliação de matriz de 08/07 13:34 resetara para o nível 1; documento restaurado para o nível 2 (Santiago Macedo).'),
  ('c39ba504-d33d-46da-b6f7-654ac9bb39f4', 'submitted', 'Sistema', 'system@lovable', 2,
   'Correção: aprovação do nível 1 por Leonardo Rossini (07/07 21:10) foi preservada. A reavaliação de matriz de 08/07 13:34 resetara para o nível 1; documento restaurado para o nível 2 (Santiago Macedo).');

INSERT INTO public.audit_log (action, entity_type, entity_id, actor_email, company_db, details)
VALUES
  ('restore_approval_level_after_rule_reeval', 'expense', 'd4d60c52-eb1a-4fa6-b0f1-ae1e3fbf9ed9', 'system@lovable', 'open_gaming_sa',
   jsonb_build_object('from_level',1,'to_level',2,'reason','Leonardo Rossini já havia aprovado nível 1 em 07/07; reavaliação de regra havia revertido incorretamente.')),
  ('restore_approval_level_after_rule_reeval', 'expense', 'c39ba504-d33d-46da-b6f7-654ac9bb39f4', 'system@lovable', 'open_gaming_sa',
   jsonb_build_object('from_level',1,'to_level',2,'reason','Leonardo Rossini já havia aprovado nível 1 em 07/07; reavaliação de regra havia revertido incorretamente.'));

-- 2) Função utilitária que troca a regra de aprovação de uma despesa RESPEITANDO
--    aprovações já registradas. Uso: SELECT public.reassign_approval_rule_safe(exp_id, new_rule_id, 'actor@x').
--    Regra: o `current_level_order` da despesa avança para o menor nível da NOVA regra
--    cujo aprovador NÃO foi ainda aprovado no expense_approval_log. Se todos os níveis já foram
--    aprovados por seus aprovadores designados → status='aprovado'.

CREATE OR REPLACE FUNCTION public.reassign_approval_rule_safe(
  _expense_id uuid,
  _new_rule_id uuid,
  _actor text DEFAULT 'system@lovable'
) RETURNS TABLE(new_level_order integer, new_approver text, finalized boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_rule uuid;
  v_prev_level integer;
  v_prev_approver text;
  v_company text;
  v_target_level integer;
  v_target_approver text;
  v_target_email text;
  v_all_covered boolean := true;
  lvl RECORD;
BEGIN
  SELECT approval_rule_id, current_level_order, current_approver, company_db
    INTO v_prev_rule, v_prev_level, v_prev_approver, v_company
  FROM public.expenses WHERE id = _expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense not found: %', _expense_id;
  END IF;

  -- Percorre os níveis da NOVA regra em ordem; se um nível foi previamente aprovado
  -- por alguém que corresponde ao aprovador designado (nome OU e-mail OU prefixo),
  -- consideramos coberto e avançamos.
  FOR lvl IN
    SELECT level_order, approver_name, approver_email
    FROM public.approval_rule_levels
    WHERE rule_id = _new_rule_id
    ORDER BY level_order
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.expense_approval_log l
      WHERE l.expense_id = _expense_id
        AND l.decision = 'approved'
        AND (
          lower(coalesce(l.approver_name,'')) = lower(coalesce(lvl.approver_name,''))
          OR lower(coalesce(l.approver_email,'')) = lower(coalesce(lvl.approver_email,''))
          OR (lvl.approver_email IS NOT NULL
              AND lower(split_part(coalesce(l.approver_email, l.approver_name, ''), '@', 1))
                = lower(split_part(lvl.approver_email, '@', 1)))
          OR (lvl.approver_email IS NOT NULL
              AND lower(coalesce(l.approver_name,''))
                = lower(split_part(lvl.approver_email, '@', 1)))
        )
    ) THEN
      v_target_level := lvl.level_order;
      v_target_approver := lvl.approver_name;
      v_target_email := lvl.approver_email;
      v_all_covered := false;
      EXIT;
    END IF;
  END LOOP;

  IF v_all_covered THEN
    UPDATE public.expenses
       SET approval_rule_id = _new_rule_id,
           status = 'aprovado',
           updated_at = now()
     WHERE id = _expense_id;
    INSERT INTO public.audit_log (action, entity_type, entity_id, actor_email, company_db, details)
    VALUES ('reassign_rule_finalized', 'expense', _expense_id::text, _actor, v_company,
      jsonb_build_object('previous_rule_id', v_prev_rule, 'new_rule_id', _new_rule_id,
                         'reason', 'todos os níveis da nova regra já haviam sido aprovados'));
    RETURN QUERY SELECT NULL::integer, NULL::text, true;
    RETURN;
  END IF;

  UPDATE public.expenses
     SET approval_rule_id = _new_rule_id,
         current_level_order = v_target_level,
         current_approver = v_target_approver,
         updated_at = now()
   WHERE id = _expense_id;

  INSERT INTO public.expense_approval_log (expense_id, decision, approver_name, approver_email, level_order, remarks)
  VALUES (_expense_id, 'submitted', 'Sistema', 'system@lovable', v_target_level,
    format('Regra de aprovação reatribuída (%s → %s). Níveis já aprovados foram preservados; documento posicionado no nível %s (%s).',
           coalesce(v_prev_rule::text,'—'), _new_rule_id::text, v_target_level, v_target_approver));

  INSERT INTO public.audit_log (action, entity_type, entity_id, actor_email, company_db, details)
  VALUES ('reassign_rule_respecting_history', 'expense', _expense_id::text, _actor, v_company,
    jsonb_build_object(
      'previous_rule_id', v_prev_rule,
      'previous_level_order', v_prev_level,
      'previous_approver', v_prev_approver,
      'new_rule_id', _new_rule_id,
      'new_level_order', v_target_level,
      'new_approver', v_target_approver,
      'new_approver_email', v_target_email
    ));

  RETURN QUERY SELECT v_target_level, v_target_approver, false;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_approval_rule_safe(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_approval_rule_safe(uuid, uuid, text) TO service_role;