
-- ===== FASE 1: Remover leitura anônima de dados financeiros =====
DROP POLICY IF EXISTS "Anon can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can read expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can read expense_attachments" ON public.expense_attachments;
DROP POLICY IF EXISTS "Anon can read approval log" ON public.expense_approval_log;
DROP POLICY IF EXISTS "Anon read nf_entrada_logs" ON public.nf_entrada_logs;
DROP POLICY IF EXISTS "Anon read nf_entrada_imports" ON public.nf_entrada_imports;
DROP POLICY IF EXISTS "Anon can read pagcorp integration logs for SAP session flow" ON public.pagcorp_integration_log;

-- audit_log: policy incluía anon+authenticated. Recriar sem anon.
DROP POLICY IF EXISTS "Anyone can view expense audit_log" ON public.audit_log;
CREATE POLICY "Authenticated can view expense audit_log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (entity_type = 'expense');

-- ===== FASE 2: Remover escrita anônima (privilege escalation) =====
-- approval_rules
DROP POLICY IF EXISTS "Anon can read approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can insert approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can update approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can delete approval_rules" ON public.approval_rules;
-- Remover write "USING true" para authenticated (admin ALL já cobre admins)
DROP POLICY IF EXISTS "Authenticated can insert approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Authenticated can update approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Authenticated can delete approval_rules" ON public.approval_rules;

-- approval_rule_levels
DROP POLICY IF EXISTS "Anon can read approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can insert approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can update approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can delete approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can insert approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can update approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can delete approval_rule_levels" ON public.approval_rule_levels;

-- sap_cache: anon out; writes só admin/service_role. Manter authenticated SELECT.
DROP POLICY IF EXISTS "Anon can read sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Anon can insert sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Anon can update sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Anon can delete sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Authenticated can insert sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Authenticated can update sap_cache" ON public.sap_cache;
DROP POLICY IF EXISTS "Authenticated can delete sap_cache" ON public.sap_cache;

-- pagcorp_settlement_accounts: dropar policies "App can ..." (USING true, anon+auth). Admin ALL cobre admin.
DROP POLICY IF EXISTS "App can read pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "App can insert pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "App can update pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
DROP POLICY IF EXISTS "App can delete pagcorp_settlement_accounts" ON public.pagcorp_settlement_accounts;
-- Autenticados podem ler o mapeamento (usado em telas de PagCorp)
CREATE POLICY "Authenticated can read pagcorp_settlement_accounts"
  ON public.pagcorp_settlement_accounts
  FOR SELECT
  TO authenticated
  USING (true);

-- ===== FASE 3: Warnings de exposição =====
DROP POLICY IF EXISTS "Anon can read synapse_execution_log" ON public.synapse_execution_log;
DROP POLICY IF EXISTS "Anon can read synapse_integrations" ON public.synapse_integrations;
DROP POLICY IF EXISTS "Anon can read synapse_global_settings" ON public.synapse_global_settings;

-- pagcorp_nondeductible_cards: policy tem anon+authenticated
DROP POLICY IF EXISTS "Anyone can read nondeductible cards" ON public.pagcorp_nondeductible_cards;
CREATE POLICY "Authenticated can read nondeductible cards"
  ON public.pagcorp_nondeductible_cards
  FOR SELECT
  TO authenticated
  USING (true);

-- ===== FASE 4: Storage bucket expense-attachments =====
-- Restringir acesso ao bucket a authenticated que sejam donos do expense ou admin
DROP POLICY IF EXISTS "auth can read own expense files" ON storage.objects;
CREATE POLICY "auth can read own expense files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'expense-attachments'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1
        FROM public.expense_attachments a
        JOIN public.expenses e ON e.id = a.expense_id
        JOIN auth.users u ON u.id = auth.uid()
        WHERE a.file_path = storage.objects.name
          AND (
            lower(e.requester_email) = lower(u.email)
            OR lower(COALESCE(e.created_by_email,'')) = lower(u.email)
            OR lower(COALESCE(e.current_approver,'')) = lower(u.email)
            OR lower(COALESCE(e.current_approver,'')) = lower(split_part(u.email,'@',1))
          )
      )
    )
  );

DROP POLICY IF EXISTS "auth can upload own expense files" ON storage.objects;
CREATE POLICY "auth can upload own expense files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'expense-attachments');

DROP POLICY IF EXISTS "auth can delete own expense files" ON storage.objects;
CREATE POLICY "auth can delete own expense files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-attachments'
    AND public.has_role(auth.uid(), 'admin')
  );
