ALTER TABLE public.sap_po_nf_cp_cache
  ADD COLUMN IF NOT EXISTS data_criacao_pedido timestamptz,
  ADD COLUMN IF NOT EXISTS data_criacao_nf timestamptz,
  ADD COLUMN IF NOT EXISTS data_vencimento_parcela timestamptz,
  ADD COLUMN IF NOT EXISTS data_pagamento timestamptz;

CREATE OR REPLACE FUNCTION public.get_document_timeline(_expense_id uuid)
 RETURNS TABLE(occurred_at timestamp with time zone, source text, category text, title text, detail text, actor text, status text, meta jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e RECORD;
  me text := lower(coalesce(public.current_auth_email(), ''));
  is_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
  k text := _expense_id::text;
  win_from timestamptz;
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

  win_from := coalesce(e.created_at, now() - interval '1 year') - interval '1 day';

  RETURN QUERY
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

  UNION ALL
  SELECT coalesce(l.decided_at, l.created_at), 'aprovacao', 'approval',
         concat('Alçada ', coalesce(l.level_order, 0), ' · ', coalesce(l.decision, 'pendente')),
         nullif(l.remarks, ''),
         coalesce(l.approver_name, l.approver_email),
         l.decision,
         jsonb_build_object('substituted_for', l.substituted_for_email, 'action_role', l.action_role)
    FROM public.expense_approval_log l
   WHERE l.expense_id = _expense_id

  UNION ALL
  SELECT a.created_at, 'auditoria', 'action',
         concat(a.action, CASE WHEN a.decision IS NOT NULL THEN ' · ' || a.decision ELSE '' END),
         nullif(concat_ws(' · ', a.reason, a.remarks), ''),
         coalesce(a.actor_identity, a.actor_email),
         a.decision,
         jsonb_build_object('override', a.override_used, 'source', a.actor_source, 'company_db', a.company_db)
    FROM public.expense_audit_log a
   WHERE a.expense_id = _expense_id

  UNION ALL
  SELECT t.ts, 'banco', 'data_change',
         concat(t.table_name, ' · ', CASE t.op WHEN 'I' THEN 'INSERT' WHEN 'U' THEN 'UPDATE' WHEN 'D' THEN 'DELETE' ELSE t.op::text END),
         nullif(array_to_string(t.changed_cols, ', '), ''),
         t.actor_email, NULL,
         jsonb_build_object('row_pk', t.row_pk)
    FROM public.audit_trail t
   WHERE (t.row_pk->>'id') = k

  UNION ALL
  SELECT coalesce(q.last_attempt_at, q.updated_at, q.created_at), 'integracao', 'retry',
         concat('Fila de retentativa · ', q.status),
         nullif(concat_ws(' · ', q.error_category, left(coalesce(q.last_error, ''), 300)), ''),
         NULL, q.status,
         jsonb_build_object('attempts', q.attempts, 'max_attempts', q.max_attempts, 'next_attempt_at', q.next_attempt_at)
    FROM public.sap_retry_queue q
   WHERE q.ref_id = k

  UNION ALL
  SELECT i.created_at, 'integracao', 'call',
         concat(i.system_name, ' · ', i.action),
         nullif(left(coalesce(i.error_message, ''), 300), ''),
         NULL, i.status,
         jsonb_build_object('http_status', i.http_status, 'duration_ms', i.duration_ms)
    FROM public.integration_log i
   WHERE i.created_at >= win_from
     AND (coalesce(i.request_meta::text, '') LIKE '%' || k || '%'
       OR coalesce(i.response_meta::text, '') LIKE '%' || k || '%')

  UNION ALL
  SELECT e.sap_integration_last_attempt_at, 'sap', 'integration',
         CASE WHEN e.sap_doc_num IS NOT NULL THEN concat('Integrado no SAP · Doc ', e.sap_doc_num) ELSE 'Tentativa de integração no SAP' END,
         nullif(left(coalesce(e.sap_integration_error, ''), 300), ''),
         NULL,
         CASE WHEN e.sap_doc_num IS NOT NULL THEN 'success' WHEN e.sap_integration_error IS NOT NULL THEN 'failed' ELSE e.sap_sync_state END,
         jsonb_build_object('doc_entry', e.sap_doc_entry, 'doc_num', e.sap_doc_num,
                            'attachment', e.sap_attachment_status, 'po', e.sap_purchase_order_status)
  WHERE e.sap_integration_last_attempt_at IS NOT NULL OR e.sap_doc_num IS NOT NULL

  -- Datas reais de criação dos documentos no SAP (view VW_FLUXO_CONTAS_PAGAR_AVANCADO)
  UNION ALL
  SELECT DISTINCT ON (c.id_pedido_compra) c.data_criacao_pedido, 'sap', 'sap_document',
         concat('Pedido de compra criado no SAP · ', c.id_pedido_compra),
         concat_ws(' · ', c.nome_fornecedor, c.cod_fornecedor),
         NULL, NULL,
         jsonb_build_object('id_pedido_compra', c.id_pedido_compra, 'company_db', c.company_db)
    FROM public.sap_po_nf_cp_cache c
   WHERE c.company_db = e.company_db
     AND e.sap_doc_entry IS NOT NULL
     AND c.id_pedido_compra = e.sap_doc_entry::text
     AND c.data_criacao_pedido IS NOT NULL

  UNION ALL
  SELECT DISTINCT ON (c.id_nf_entrada) c.data_criacao_nf, 'sap', 'sap_document',
         concat('NF de entrada criada no SAP · ', coalesce(c.numero_nota_fiscal, c.id_nf_entrada)),
         concat_ws(' · ', c.nome_fornecedor,
                   CASE WHEN c.data_vencimento_parcela IS NOT NULL
                        THEN 'Vencimento ' || to_char(c.data_vencimento_parcela, 'DD/MM/YYYY') END),
         NULL, NULL,
         jsonb_build_object('id_nf_entrada', c.id_nf_entrada, 'numero_nota_fiscal', c.numero_nota_fiscal,
                            'vencimento', c.data_vencimento_parcela, 'valor', c.valor)
    FROM public.sap_po_nf_cp_cache c
   WHERE c.company_db = e.company_db
     AND e.sap_doc_entry IS NOT NULL
     AND c.id_pedido_compra = e.sap_doc_entry::text
     AND c.data_criacao_nf IS NOT NULL

  UNION ALL
  SELECT DISTINCT ON (c.id_contas_pagar) c.data_pagamento, 'sap', 'sap_document',
         concat('Contas a pagar no SAP · ', c.id_contas_pagar),
         concat_ws(' · ', c.referencia_valor, c.status_geral),
         NULL, c.status_geral,
         jsonb_build_object('id_contas_pagar', c.id_contas_pagar, 'valor', c.valor,
                            'referencia', c.referencia_valor)
    FROM public.sap_po_nf_cp_cache c
   WHERE c.company_db = e.company_db
     AND e.sap_doc_entry IS NOT NULL
     AND c.id_pedido_compra = e.sap_doc_entry::text
     AND c.data_pagamento IS NOT NULL

  ORDER BY 1 NULLS LAST;
END;
$function$;