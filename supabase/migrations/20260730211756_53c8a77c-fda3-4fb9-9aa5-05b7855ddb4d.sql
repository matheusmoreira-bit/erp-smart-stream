CREATE OR REPLACE FUNCTION public.get_document_timeline(_expense_id uuid)
RETURNS TABLE (
  occurred_at timestamptz,
  source text,
  category text,
  title text,
  detail text,
  actor text,
  status text,
  meta jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e RECORD;
  me text := lower(coalesce(public.current_auth_email(), ''));
  is_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
BEGIN
  SELECT * INTO e FROM public.expenses WHERE id = _expense_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT is_admin THEN
    IF me = '' OR NOT (
      lower(coalesce(e.created_by_email, '')) = me
      OR lower(coalesce(e.requester_email, '')) = me
      OR lower(coalesce(e.current_approver, '')) = me
      OR lower(coalesce(e.original_approver, '')) = me
      OR EXISTS (
        SELECT 1 FROM public.expense_approval_log l
         WHERE l.expense_id = _expense_id
           AND (lower(coalesce(l.approver_email, '')) = me OR lower(coalesce(l.substituted_for_email, '')) = me)
      )
    ) THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  -- Ciclo de vida do documento
  SELECT e.created_at, 'documento', 'lifecycle',
         'Documento criado',
         concat_ws(' · ', e.supplier_name, e.company_db, e.origin),
         coalesce(e.requester_name, e.created_by_email, e.requester_email),
         e.status::text,
         jsonb_build_object('doc_type', e.doc_type, 'total', e.total_amount, 'currency', e.currency)
  UNION ALL
  SELECT e.updated_at, 'documento', 'lifecycle', 'Última atualização do documento', NULL,
         NULL, e.status::text, '{}'::jsonb
  WHERE e.updated_at IS NOT NULL AND e.updated_at <> e.created_at

  -- Aprovações
  UNION ALL
  SELECT coalesce(l.decided_at, l.created_at), 'aprovacao', 'approval',
         concat('Alçada ', coalesce(l.level_order, 0), ' · ', coalesce(l.decision, 'pendente')),
         nullif(l.remarks, ''),
         coalesce(l.approver_name, l.approver_email),
         l.decision,
         jsonb_build_object('substituted_for', l.substituted_for_email, 'action_role', l.action_role)
    FROM public.expense_approval_log l
   WHERE l.expense_id = _expense_id

  -- Auditoria de ações (inclui overrides, cancelamentos, delegações)
  UNION ALL
  SELECT a.created_at, 'auditoria', 'action',
         concat(a.action, CASE WHEN a.decision IS NOT NULL THEN ' · ' || a.decision ELSE '' END),
         nullif(concat_ws(' · ', a.reason, a.remarks), ''),
         coalesce(a.actor_identity, a.actor_email),
         a.decision,
         jsonb_build_object('override', a.override_used, 'source', a.actor_source, 'company_db', a.company_db)
    FROM public.expense_audit_log a
   WHERE a.expense_id = _expense_id

  -- Trilha de alterações de dados (audit_trail)
  UNION ALL
  SELECT t.ts, 'banco', 'data_change',
         concat(t.table_name, ' · ', CASE t.op WHEN 'I' THEN 'INSERT' WHEN 'U' THEN 'UPDATE' WHEN 'D' THEN 'DELETE' ELSE t.op::text END),
         nullif(array_to_string(t.changed_cols, ', '), ''),
         t.actor_email, NULL,
         jsonb_build_object('row_pk', t.row_pk)
    FROM public.audit_trail t
   WHERE t.row_pk::text ILIKE '%' || _expense_id::text || '%'

  -- Integração ERP/SAP (fila de retentativa)
  UNION ALL
  SELECT coalesce(q.last_attempt_at, q.updated_at, q.created_at), 'integracao', 'retry',
         concat('Fila de retentativa · ', q.status),
         nullif(concat_ws(' · ', q.error_category, left(coalesce(q.last_error, ''), 300)), ''),
         NULL, q.status,
         jsonb_build_object('attempts', q.attempts, 'max_attempts', q.max_attempts, 'next_attempt_at', q.next_attempt_at)
    FROM public.sap_retry_queue q
   WHERE q.ref_id = _expense_id::text

  -- Chamadas de integração registradas
  UNION ALL
  SELECT i.created_at, 'integracao', 'call',
         concat(i.system_name, ' · ', i.action),
         nullif(left(coalesce(i.error_message, ''), 300), ''),
         NULL, i.status,
         jsonb_build_object('http_status', i.http_status, 'duration_ms', i.duration_ms)
    FROM public.integration_log i
   WHERE coalesce(i.request_meta::text, '') ILIKE '%' || _expense_id::text || '%'
      OR coalesce(i.response_meta::text, '') ILIKE '%' || _expense_id::text || '%'

  -- Resultado da integração no SAP
  UNION ALL
  SELECT e.sap_integration_last_attempt_at, 'sap', 'integration',
         CASE WHEN e.sap_doc_num IS NOT NULL THEN concat('Integrado no SAP · Doc ', e.sap_doc_num) ELSE 'Tentativa de integração no SAP' END,
         nullif(left(coalesce(e.sap_integration_error, ''), 300), ''),
         NULL,
         CASE WHEN e.sap_doc_num IS NOT NULL THEN 'success' WHEN e.sap_integration_error IS NOT NULL THEN 'failed' ELSE e.sap_sync_state END,
         jsonb_build_object('doc_entry', e.sap_doc_entry, 'doc_num', e.sap_doc_num,
                            'attachment', e.sap_attachment_status, 'po', e.sap_purchase_order_status)
  WHERE e.sap_integration_last_attempt_at IS NOT NULL OR e.sap_doc_num IS NOT NULL

  -- Notificações enviadas
  UNION ALL
  SELECT n.created_at, 'notificacao', 'notification',
         n.title, nullif(n.body, ''), n.user_identifier, n.category, coalesce(n.metadata, '{}'::jsonb)
    FROM public.notifications n
   WHERE coalesce(n.metadata::text, '') ILIKE '%' || _expense_id::text || '%'
      OR coalesce(n.link, '') ILIKE '%' || _expense_id::text || '%'

  -- E-mails transacionais
  UNION ALL
  SELECT m.created_at, 'email', 'email',
         concat('E-mail · ', coalesce(m.template_name, 'mensagem')),
         m.recipient_email, NULL, m.status,
         jsonb_build_object('error', m.error_message)
    FROM public.email_send_log m
   WHERE coalesce(m.metadata::text, '') ILIKE '%' || _expense_id::text || '%'

  ORDER BY 1 NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_document_timeline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_document_timeline(uuid) TO authenticated;