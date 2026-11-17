ALTER TABLE public.approval_rules ADD COLUMN IF NOT EXISTS approval_mode text;
CREATE OR REPLACE FUNCTION public.apply_unified_purchase_approval(_company_db text, _test boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid(); actor_email text := auth.jwt()->>'email';
  company public.companies%ROWTYPE; rule public.approval_rules%ROWTYPE;
  doc public.expenses%ROWTYPE; new_rule uuid; rules_before jsonb; levels_before jsonb;
  segments_before jsonb; transferred integer := 0; retired integer := 0;
  next_name text; next_email text; existing uuid;
BEGIN
  IF actor IS NULL OR coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' OR NOT public.has_role(actor,'admin') THEN
    RAISE EXCEPTION 'Administrador com MFA obrigatório' USING ERRCODE='42501';
  END IF;
  SELECT * INTO company FROM public.companies WHERE company_db=_company_db FOR UPDATE;
  IF NOT FOUND OR company.is_test IS DISTINCT FROM _test THEN RAISE EXCEPTION 'Empresa/ambiente inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sap_user_emails WHERE email='juliana.gavineli@anagaming.com.br') OR NOT EXISTS (SELECT 1 FROM public.sap_user_emails WHERE email='mauricio.farias@anagaming.com.br') THEN RAISE EXCEPTION 'Aprovadores não encontrados'; END IF;
  PERFORM 1 FROM public.approval_rules WHERE company_db=_company_db FOR UPDATE;
  SELECT id INTO existing FROM public.approval_rules WHERE company_db=_company_db AND approval_mode='single_purchase' AND is_active;
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('already_applied',true,'rule_id',existing,'company_db',_company_db); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO rules_before FROM public.approval_rules r WHERE company_db=_company_db;
  SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]') INTO levels_before FROM public.approval_rule_levels l JOIN public.approval_rules r ON r.id=l.rule_id WHERE r.company_db=_company_db;
  INSERT INTO public.audit_log(actor_id,actor_email,action,entity_type,entity_id,company_db,details)
  VALUES(actor,actor_email,'unified_purchase_rules_backup','approval_rule',_company_db,_company_db,jsonb_build_object('rules',rules_before,'levels',levels_before,'test',_test));
  FOR rule IN SELECT * FROM public.approval_rules WHERE company_db=_company_db AND is_active AND coalesce(doc_type,'both') IN ('both','purchase','advance') LOOP
    IF coalesce(rule.doc_type,'both')='both' THEN
      UPDATE public.approval_rules SET doc_type='sales' WHERE id=rule.id;
    ELSE
      UPDATE public.approval_rules SET is_active=false WHERE id=rule.id;
    END IF;
    retired := retired+1;
  END LOOP;
  INSERT INTO public.approval_rules(name,company_db,doc_type,criteria,priority,created_by,auto_approve,approval_mode)
  VALUES('Aprovação única — Juliana Gavineli ou Mauricio Farias',_company_db,'purchase','[]',2147483647,actor_email,false,'single_purchase') RETURNING id INTO new_rule;
  INSERT INTO public.approval_rule_levels(rule_id,level_order,approver_name,approver_email,require_all) VALUES
  (new_rule,1,'Juliana Gavineli','juliana.gavineli@anagaming.com.br',false),
  (new_rule,1,'Mauricio Farias','mauricio.farias@anagaming.com.br',false);
  FOR doc IN SELECT * FROM public.expenses WHERE company_db=_company_db AND status='pendente_aprovacao' AND coalesce(doc_type,'purchase') IN ('purchase','advance') AND lower(coalesce(origin,'manual')) NOT IN ('sap','erp','sap_erp','pagcorp') FOR UPDATE LOOP
    SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO segments_before FROM public.expense_approval_segments s WHERE expense_id=doc.id;
    next_name := 'Juliana Gavineli'; next_email := 'juliana.gavineli@anagaming.com.br';
    IF lower(coalesce(doc.requester_email,'')) IN ('juliana.gavineli','juliana.gavineli@anagaming.com.br') OR lower(coalesce(doc.requester_name,'')) IN ('juliana.gavineli','juliana.gavineli@anagaming.com.br','juliana gavineli') THEN
      next_name := 'Mauricio Farias'; next_email := 'mauricio.farias@anagaming.com.br';
    END IF;
    INSERT INTO public.audit_log(actor_id,actor_email,action,entity_type,entity_id,company_db,details)
    VALUES(actor,actor_email,'unified_purchase_pending_transfer','expense',doc.id::text,_company_db,jsonb_build_object('before',to_jsonb(doc),'segments_before',segments_before,'rule_id',new_rule,'to_approver',next_name,'to_email',next_email));
    UPDATE public.expense_approval_segments SET status='substituido',current_approver=null,current_approver_email=null,resolution_note='Substituída por aprovação única do documento; histórico preservado.' WHERE expense_id=doc.id;
    UPDATE public.expenses SET approval_rule_id=new_rule,current_level_order=1,current_approver=next_name,original_approver=next_name,updated_at=now() WHERE id=doc.id;
    INSERT INTO public.expense_approval_log(expense_id,decision,approver_name,approver_email,level_order,remarks)
    VALUES(doc.id,'submitted',actor_email,actor_email,1,'Transferência para alçada única; decisões anteriores preservadas no histórico, sem aprovação automática.');
    transferred:=transferred+1;
  END LOOP;
  RETURN jsonb_build_object('company_db',_company_db,'rule_id',new_rule,'retired',retired,'transferred',transferred,'test',_test);
END $$;
REVOKE ALL ON FUNCTION public.apply_unified_purchase_approval(text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.apply_unified_purchase_approval(text,boolean) TO authenticated;