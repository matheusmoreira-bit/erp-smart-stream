
CREATE OR REPLACE FUNCTION public.registration_requests_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor text;
  v_changes text[] := '{}';
  v_mode_label jsonb := '{"erpflow":"Cadastro pelo ERP Flow","manual_sap":"Cadastro manual no SAP"}'::jsonb;
BEGIN
  v_actor := lower(coalesce(public.current_auth_email(), 'sistema'));

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.registration_request_events
      (request_id, event_type, from_status, to_status, message, author_email, author_name, attachments)
    VALUES (
      NEW.id, 'audit', NULL, NEW.status,
      'Chamado aberto · Forma de cadastro: ' ||
        coalesce(v_mode_label->>NEW.registration_mode::text, NEW.registration_mode::text),
      coalesce(nullif(lower(NEW.requester_email), ''), v_actor),
      NEW.requester_name, '[]'::jsonb
    );
    RETURN NEW;
  END IF;

  IF NEW.registration_mode IS DISTINCT FROM OLD.registration_mode THEN
    v_changes := v_changes || (
      'Forma de cadastro: ' ||
      coalesce(v_mode_label->>OLD.registration_mode::text, coalesce(OLD.registration_mode::text,'—')) ||
      ' → ' ||
      coalesce(v_mode_label->>NEW.registration_mode::text, coalesce(NEW.registration_mode::text,'—'))
    );
  END IF;

  IF NEW.sap_card_code IS DISTINCT FROM OLD.sap_card_code THEN
    v_changes := v_changes || ('Código no ERP: ' || coalesce(OLD.sap_card_code,'—') || ' → ' || coalesce(NEW.sap_card_code,'—'));
  END IF;
  IF NEW.assignee_email IS DISTINCT FROM OLD.assignee_email THEN
    v_changes := v_changes || ('Responsável: ' || coalesce(OLD.assignee_email,'—') || ' → ' || coalesce(NEW.assignee_email,'—'));
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    v_changes := v_changes || ('Título: ' || coalesce(OLD.title,'—') || ' → ' || coalesce(NEW.title,'—'));
  END IF;
  IF NEW.federal_tax_id IS DISTINCT FROM OLD.federal_tax_id THEN
    v_changes := v_changes || ('CNPJ/CPF: ' || coalesce(OLD.federal_tax_id,'—') || ' → ' || coalesce(NEW.federal_tax_id,'—'));
  END IF;
  IF NEW.contact_email IS DISTINCT FROM OLD.contact_email THEN
    v_changes := v_changes || ('E-mail de contato: ' || coalesce(OLD.contact_email,'—') || ' → ' || coalesce(NEW.contact_email,'—'));
  END IF;
  IF NEW.phone1 IS DISTINCT FROM OLD.phone1 THEN
    v_changes := v_changes || ('Telefone: ' || coalesce(OLD.phone1,'—') || ' → ' || coalesce(NEW.phone1,'—'));
  END IF;
  IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
    v_changes := v_changes || ('Forma de pagamento: ' || coalesce(OLD.payment_method::text,'—') || ' → ' || coalesce(NEW.payment_method::text,'—'));
  END IF;
  IF NEW.bank_details IS DISTINCT FROM OLD.bank_details THEN
    v_changes := v_changes || 'Dados bancários atualizados';
  END IF;
  IF NEW.address IS DISTINCT FROM OLD.address THEN
    v_changes := v_changes || 'Endereço atualizado';
  END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    v_changes := v_changes || 'Observações atualizadas';
  END IF;
  IF NEW.resolution_note IS DISTINCT FROM OLD.resolution_note THEN
    v_changes := v_changes || 'Parecer de conclusão atualizado';
  END IF;
  IF NEW.attachments IS DISTINCT FROM OLD.attachments THEN
    v_changes := v_changes || (
      'Anexos: ' || jsonb_array_length(coalesce(OLD.attachments,'[]'::jsonb))::text ||
      ' → ' || jsonb_array_length(coalesce(NEW.attachments,'[]'::jsonb))::text
    );
  END IF;

  IF array_length(v_changes, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.registration_request_events
    (request_id, event_type, from_status, to_status, message, author_email, author_name, attachments)
  VALUES (
    NEW.id, 'audit', OLD.status, NEW.status,
    array_to_string(v_changes, E'\n'),
    v_actor, NULL, '[]'::jsonb
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_requests_audit_ins ON public.registration_requests;
CREATE TRIGGER trg_registration_requests_audit_ins
AFTER INSERT ON public.registration_requests
FOR EACH ROW EXECUTE FUNCTION public.registration_requests_audit();

DROP TRIGGER IF EXISTS trg_registration_requests_audit_upd ON public.registration_requests;
CREATE TRIGGER trg_registration_requests_audit_upd
AFTER UPDATE ON public.registration_requests
FOR EACH ROW EXECUTE FUNCTION public.registration_requests_audit();
