export const CATALOG = [
  {
    "table": "access_review_campaigns",
    "columns": [
      "id",
      "name",
      "period_label",
      "status",
      "due_at",
      "opened_by",
      "opened_at",
      "closed_by",
      "closed_at",
      "notes",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "access_review_items",
    "columns": [
      "id",
      "campaign_id",
      "user_key",
      "display_name",
      "sap_email",
      "access_type",
      "company_db",
      "access_ref_id",
      "access_label",
      "decision",
      "justification",
      "decided_by",
      "decided_at",
      "evidence",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "accounts_payable_bank_accounts",
    "columns": [
      "id",
      "company_db",
      "bank_code",
      "legal_name",
      "tax_id",
      "agreement_code",
      "agency",
      "agency_digit",
      "account_number",
      "account_digit",
      "agency_account_digit",
      "sap_transfer_account",
      "next_file_sequence",
      "active",
      "created_by",
      "created_at",
      "updated_at",
      "transit_account_code"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "accounts_payable_batch_items",
    "columns": [
      "id",
      "batch_id",
      "company_db",
      "sap_doc_entry",
      "sap_doc_num",
      "installment_id",
      "supplier_code",
      "supplier_name",
      "supplier_tax_id",
      "due_date",
      "scheduled_date",
      "amount",
      "currency",
      "barcode",
      "payment_method",
      "payment_metadata",
      "company_reference",
      "idempotency_key",
      "status",
      "return_occurrences",
      "bank_protocol",
      "paid_date",
      "paid_amount",
      "sap_payment_doc_entry",
      "sap_payment_doc_num",
      "sap_error",
      "created_at",
      "updated_at",
      "source",
      "expense_id",
      "sap_settlement_status",
      "settlement_note"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "accounts_payable_batches",
    "columns": [
      "id",
      "company_db",
      "bank_account_id",
      "file_sequence",
      "status",
      "filename",
      "payment_date",
      "title_count",
      "total_amount",
      "content_sha256",
      "content",
      "processed_at",
      "generated_by",
      "generated_at",
      "return_filename",
      "return_sha256",
      "return_imported_by",
      "return_imported_at",
      "error_message",
      "created_at",
      "updated_at",
      "approved_by",
      "approved_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "accounts_payable_return_events",
    "columns": [
      "id",
      "batch_id",
      "item_id",
      "company_db",
      "return_sha256",
      "line_number",
      "segment",
      "occurrence_codes",
      "processing_status",
      "payload",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "accounts_payable_supplier_payment_profiles",
    "columns": [
      "id",
      "company_db",
      "supplier_code",
      "supplier_name",
      "supplier_tax_id",
      "payment_method",
      "beneficiary_name",
      "beneficiary_tax_id",
      "bank_code",
      "branch",
      "branch_digit",
      "account_number",
      "account_digit",
      "account_type",
      "pix_key_type",
      "pix_key",
      "metadata",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
      "approval_status",
      "approved_by",
      "approved_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "advance_invoice_applications",
    "columns": [
      "id",
      "company_db",
      "card_code",
      "advance_id",
      "advance_source",
      "sap_advance_doc_entry",
      "sap_advance_doc_num",
      "invoice_doc_entry",
      "invoice_doc_num",
      "baixa_id",
      "amount",
      "currency",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "advance_payment_attachments",
    "columns": [
      "id",
      "advance_id",
      "file_name",
      "file_path",
      "file_size",
      "mime_type",
      "uploaded_by",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "advance_payment_items",
    "columns": [
      "id",
      "advance_id",
      "item_code",
      "description",
      "quantity",
      "unit_price",
      "line_total",
      "cost_center",
      "cost_center_name",
      "project",
      "project_name",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "advance_payments",
    "columns": [
      "id",
      "company_db",
      "supplier_card_code",
      "supplier_name",
      "supplier_cnpj",
      "amount",
      "currency",
      "due_date",
      "remarks",
      "requester_id",
      "requester_name",
      "requester_email",
      "status",
      "current_approval_level",
      "total_approval_levels",
      "rejection_reason",
      "sap_doc_entry",
      "sap_doc_num",
      "sap_integration_status",
      "sap_integration_error",
      "sap_integrated_at",
      "created_at",
      "updated_at",
      "sap_integration_locked_at",
      "cost_center",
      "cost_center_name",
      "advance_type",
      "reconciliation_date",
      "reconciliation_account_code",
      "reconciliation_account_name",
      "reconciled_at",
      "reconciled_by",
      "reconciliation_error",
      "sap_incoming_payment_doc_entry",
      "sap_doc_date",
      "sap_doc_status",
      "sap_cancelled",
      "sap_open_amount",
      "sap_status_synced_at",
      "approved_by",
      "approved_by_name",
      "approved_at",
      "auto_approved"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "ai_document_analyses",
    "columns": [
      "id",
      "scope",
      "input_hash",
      "model",
      "entity_type",
      "entity_id",
      "company_db",
      "result",
      "hit_count",
      "last_used_at",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "approval_history",
    "columns": [
      "id",
      "external_id",
      "company_db",
      "decision",
      "decision_date",
      "approver_code",
      "approver_name",
      "approver_email",
      "requester_code",
      "requester_name",
      "doc_object_type",
      "doc_type_name",
      "doc_entry",
      "doc_num",
      "doc_total",
      "currency",
      "card_code",
      "card_name",
      "remarks",
      "stage_name",
      "step",
      "raw",
      "synced_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "approval_matrix_versions",
    "columns": [
      "id",
      "company_db",
      "version_no",
      "label",
      "description",
      "rules_count",
      "levels_count",
      "snapshot",
      "created_by",
      "restored_from_version",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "approval_rule_levels",
    "columns": [
      "id",
      "rule_id",
      "level_order",
      "approver_name",
      "approver_email",
      "created_at",
      "require_all"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "approval_rules",
    "columns": [
      "id",
      "name",
      "is_active",
      "priority",
      "min_value",
      "max_value",
      "cost_center",
      "project",
      "requester_pattern",
      "doc_type",
      "created_by",
      "created_at",
      "updated_at",
      "criteria",
      "company_db",
      "auto_approve"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "approver_cost_centers",
    "columns": [
      "id",
      "sap_email",
      "company_db",
      "cost_center",
      "cost_center_name",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "approver_substitutes",
    "columns": [
      "id",
      "company_db",
      "official_email",
      "official_name",
      "substitute_email",
      "substitute_name",
      "starts_at",
      "ends_at",
      "reason",
      "granted_by_id",
      "granted_by_email",
      "revoked_at",
      "revoked_by_id",
      "revoked_by_email",
      "revoked_reason",
      "created_at",
      "updated_at",
      "cost_center_prefixes"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_accounts_payable",
    "columns": [
      "id",
      "company_db",
      "sap_doc_entry",
      "card_code",
      "doc_date",
      "due_date",
      "total_amount",
      "payment_terms_code",
      "linked_grpo_id",
      "linked_invoice_id",
      "raw_data",
      "synced_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_approval_decisions",
    "columns": [
      "id",
      "approval_request_id",
      "company_db",
      "step_number",
      "status",
      "approver_user_id",
      "decided_at",
      "remarks",
      "raw_data",
      "synced_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_approval_requests",
    "columns": [
      "id",
      "company_db",
      "sap_request_id",
      "status",
      "doc_object_type",
      "doc_entry",
      "doc_date_sap",
      "update_date_sap",
      "originator_user_id",
      "template_id",
      "remarks",
      "raw_data",
      "synced_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_divergences",
    "columns": [
      "id",
      "audit_run_id",
      "company_db",
      "divergence_type",
      "severity",
      "description",
      "expected_value",
      "actual_value",
      "delta_value",
      "is_fraud_flag",
      "is_reviewed",
      "reviewer_notes",
      "reviewed_by",
      "reviewed_at",
      "card_code",
      "source_table",
      "source_id",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_documents",
    "columns": [
      "id",
      "audit_run_id",
      "company_db",
      "doc_type",
      "storage_path",
      "original_filename",
      "mime_type",
      "status",
      "extracted",
      "error_message",
      "divergences_created",
      "uploaded_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_insights",
    "columns": [
      "id",
      "audit_run_id",
      "company_db",
      "category",
      "headline",
      "body",
      "severity",
      "metadata",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_logs",
    "columns": [
      "id",
      "audit_run_id",
      "company_db",
      "level",
      "message",
      "context",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_rules",
    "columns": [
      "id",
      "company_db",
      "name",
      "divergence_type",
      "default_severity",
      "tolerance",
      "config",
      "is_active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_runs",
    "columns": [
      "id",
      "company_db",
      "status",
      "scope",
      "date_from",
      "date_to",
      "current_step",
      "progress_pct",
      "total_docs_analyzed",
      "total_divergences",
      "total_fraud_flags",
      "fetch_warnings",
      "error_message",
      "triggered_by",
      "started_at",
      "finished_at",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_workflow_runs",
    "columns": [
      "id",
      "audit_run_id",
      "step_id",
      "company_db",
      "status",
      "started_at",
      "finished_at",
      "output",
      "error_message",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_console_workflow_steps",
    "columns": [
      "id",
      "company_db",
      "name",
      "step_order",
      "handler",
      "config",
      "is_active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_log",
    "columns": [
      "id",
      "actor_id",
      "actor_email",
      "action",
      "entity_type",
      "entity_id",
      "details",
      "created_at",
      "company_db"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_pay_config",
    "columns": [
      "company_db",
      "tolerance_pct_baixa",
      "tolerance_pct_media",
      "approval_thresholds",
      "fornecedor_risco",
      "run_agent_on",
      "bank_change_window_days",
      "enabled",
      "created_at",
      "updated_at"
    ],
    "order": [
      "company_db"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_pay_finding",
    "columns": [
      "id",
      "company_db",
      "audit_result_id",
      "finding_type",
      "severity",
      "field_name",
      "value_before",
      "value_after",
      "delta",
      "explanation",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_pay_fraud_signal",
    "columns": [
      "id",
      "company_db",
      "signal_type",
      "entity_type",
      "entity_ref",
      "related_audit_result_ids",
      "severity",
      "confidence",
      "narrative",
      "status",
      "resolution_note",
      "resolved_by",
      "resolved_at",
      "period_start",
      "period_end",
      "detected_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_pay_result",
    "columns": [
      "id",
      "company_db",
      "queue_id",
      "document_ref",
      "document_type",
      "baseline_source",
      "fornecedor_code",
      "fornecedor_name",
      "solicitante",
      "projeto",
      "centro_custo",
      "baseline_snapshot",
      "settlement_snapshot",
      "valor_baseline",
      "valor_pago",
      "desvio_valor_abs",
      "desvio_valor_pct",
      "overall_severity",
      "risk_score",
      "has_findings",
      "audited_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "audit_trail",
    "columns": [
      "id",
      "ts",
      "actor_id",
      "actor_email",
      "actor_role",
      "schema_name",
      "table_name",
      "op",
      "row_pk",
      "old_data",
      "new_data",
      "changed_cols",
      "prev_hash",
      "row_hash",
      "app_context"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [
      "session_jwt_sub"
    ],
    "review": true
  },
  {
    "table": "audit_trail_archive",
    "columns": [
      "id",
      "ts",
      "actor_id",
      "actor_email",
      "actor_role",
      "schema_name",
      "table_name",
      "op",
      "row_pk",
      "old_data",
      "new_data",
      "changed_cols",
      "prev_hash",
      "row_hash",
      "app_context",
      "archived_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [
      "session_jwt_sub"
    ],
    "review": true
  },
  {
    "table": "auditoria_cruzamento_config",
    "columns": [
      "empresa_id",
      "tolerancia_valor_abs",
      "tolerancia_valor_pct",
      "janela_dias",
      "usar_raiz_cnpj_fallback",
      "updated_at",
      "updated_by",
      "source_company_dbs",
      "auto_conciliar",
      "auto_score_min",
      "auto_exigir_lancamento_erp"
    ],
    "order": [
      "empresa_id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "auditoria_cruzamento_fiscal",
    "columns": [
      "id",
      "cenario",
      "empresa_id",
      "company_db",
      "erp_origem",
      "cnpj_fornecedor",
      "razao_social_fornecedor",
      "nota_mastertax_id",
      "nota_chave_acesso",
      "nota_numero",
      "nota_valor",
      "nota_data_emissao",
      "conta_paga_id_externo",
      "conta_paga_valor",
      "conta_paga_data_baixa",
      "conta_paga_forma_pagamento",
      "conta_paga_link_origem",
      "diferenca_valor",
      "diferenca_dias",
      "score_confianca",
      "candidatos_ambiguos",
      "status_match",
      "observacao_usuario",
      "revisado_por",
      "revisado_em",
      "periodo_inicio",
      "periodo_fim",
      "criado_em",
      "atualizado_em",
      "auto_conciliado",
      "auto_conciliado_em",
      "auto_regra",
      "lancamento_erp_status",
      "lancamento_erp_id"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "baixas_recebimento",
    "columns": [
      "id",
      "company_db",
      "card_code",
      "card_name",
      "data_recebimento",
      "conta_contabil_codigo",
      "conta_contabil_nome",
      "valor_total",
      "valor_juros_multa",
      "status",
      "sap_incoming_payment_doc_entry",
      "sap_error_message",
      "criado_por",
      "created_at",
      "updated_at",
      "conta_juros_multa_codigo",
      "conta_juros_multa_nome",
      "criado_por_user_code",
      "criado_por_nome"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "baixas_recebimento_itens",
    "columns": [
      "id",
      "baixa_id",
      "invoice_doc_entry",
      "invoice_doc_num",
      "valor_baixado",
      "created_at",
      "invoice_type",
      "invoice_doc_line"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "cc_project_alerts",
    "columns": [
      "id",
      "user_id",
      "user_email",
      "sap_user_name",
      "company_db",
      "line_index",
      "cost_center_code",
      "cost_center_name",
      "project_code_at_alert",
      "project_name_at_alert",
      "is_institutional_project",
      "decision",
      "final_project_code",
      "context",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "collaborator_profiles",
    "columns": [
      "user_code",
      "display_name",
      "avatar_url",
      "email",
      "phone",
      "notify_whatsapp_overdue",
      "notify_whatsapp_approvals",
      "notify_email_overdue",
      "notify_email_approvals",
      "sap_synced_at",
      "dismissed_until",
      "created_at",
      "updated_at"
    ],
    "order": [
      "user_code"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "companies",
    "columns": [
      "id",
      "company_db",
      "display_name",
      "is_active",
      "created_at",
      "updated_at",
      "targets",
      "erp_type",
      "default_currency",
      "timezone",
      "logo_url",
      "legal_name",
      "trade_name",
      "tax_id",
      "foreign_name",
      "is_foreign",
      "is_test"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [
      "service_layer_url"
    ],
    "review": true
  },
  {
    "table": "cost_center_redirects",
    "columns": [
      "id",
      "company_db",
      "from_cost_center",
      "to_cost_center",
      "to_project",
      "reason",
      "is_active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "document_drafts",
    "columns": [
      "id",
      "user_id",
      "company_db",
      "doc_type",
      "payload",
      "preview",
      "created_at",
      "updated_at",
      "expires_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "email_send_log",
    "columns": [
      "id",
      "message_id",
      "template_name",
      "recipient_email",
      "status",
      "error_message",
      "metadata",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "employee_department_mapping",
    "columns": [
      "id",
      "integration_config_id",
      "jumpcloud_department",
      "sap_department_code",
      "sap_department_name",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "employee_integration_config",
    "columns": [
      "id",
      "name",
      "company_db",
      "jumpcloud_organization_id",
      "schedule_type",
      "preferred_hour",
      "is_active",
      "sync_inactive_users",
      "sync_managers",
      "default_department_code",
      "default_branch_code",
      "last_execution_at",
      "last_execution_status",
      "last_execution_message",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "employee_pending_relation",
    "columns": [
      "id",
      "integration_config_id",
      "employee_jc_id",
      "manager_jc_id",
      "resolved_at",
      "last_attempt_at",
      "message",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "empresa_kyp_config",
    "columns": [
      "company_id",
      "kyp_provider_id",
      "ativo",
      "config",
      "updated_at"
    ],
    "order": [
      "company_id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "enabled_erp_types",
    "columns": [
      "erp_type",
      "is_active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "erp_type"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "expense_approval_log",
    "columns": [
      "id",
      "expense_id",
      "level_order",
      "approver_name",
      "approver_email",
      "decision",
      "remarks",
      "decided_at",
      "created_at",
      "substituted_for_email",
      "substituted_for_name",
      "substitution_id",
      "action_role"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "expense_approval_segments",
    "columns": [
      "id",
      "expense_id",
      "segment_key",
      "cost_center",
      "project",
      "amount",
      "rule_id",
      "chain",
      "current_level",
      "status",
      "current_approver",
      "current_approver_email",
      "decided_by",
      "decided_at",
      "created_at",
      "updated_at",
      "resolution",
      "rule_name",
      "fallback_branch",
      "fallback_from_rule_id",
      "fallback_from_rule_name",
      "resolution_note"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "expense_attachments",
    "columns": [
      "id",
      "expense_id",
      "file_name",
      "file_path",
      "file_size",
      "mime_type",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "expense_audit_log",
    "columns": [
      "id",
      "expense_id",
      "action",
      "decision",
      "level_order",
      "actor_identity",
      "actor_email",
      "actor_source",
      "is_cloud_admin",
      "is_sap_superuser",
      "override_used",
      "substitution_id",
      "substituted_for_email",
      "substituted_for_name",
      "reason",
      "remarks",
      "ip_address",
      "user_agent",
      "request_id",
      "idempotency_key",
      "company_db",
      "created_at",
      "action_role",
      "segment_key",
      "track",
      "cost_center",
      "project",
      "rule_id",
      "rule_name",
      "correlation_id",
      "step",
      "metadata"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "expense_items",
    "columns": [
      "id",
      "expense_id",
      "item_code",
      "description",
      "quantity",
      "unit_price",
      "line_total",
      "cost_center",
      "project",
      "created_at",
      "items_group_code",
      "items_group_name",
      "free_of_charge"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "expense_revisions",
    "columns": [
      "id",
      "expense_id",
      "revision_number",
      "changed_by_name",
      "changed_by_email",
      "status_before",
      "status_after",
      "resubmitted",
      "changes",
      "snapshot",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "expenses",
    "columns": [
      "id",
      "supplier_code",
      "supplier_name",
      "total_amount",
      "currency",
      "cost_center",
      "project",
      "remarks",
      "status",
      "requester_name",
      "requester_email",
      "current_approver",
      "sap_doc_entry",
      "sap_doc_num",
      "created_at",
      "updated_at",
      "origin",
      "created_by_email",
      "company_db",
      "branch_id",
      "sap_attachment_entry",
      "sap_attachment_status",
      "sap_purchase_order_status",
      "sap_attachment_link_status",
      "sap_integration_error",
      "sap_integration_last_attempt_at",
      "doc_type",
      "approval_rule_id",
      "sap_integration_locked_at",
      "current_level_order",
      "doc_date",
      "due_date",
      "rateio_type",
      "sap_sync_state",
      "sap_sync_attempts",
      "sap_sync_next_retry_at",
      "original_approver",
      "sap_status_last_check_at",
      "nfse_split_mode",
      "sales_usage",
      "payment_terms_code",
      "payment_terms_name",
      "revision_number",
      "revision_note",
      "payment_method",
      "payment_boleto_barcode",
      "payment_boleto_digitable_line",
      "payment_metadata",
      "omie_ap_data",
      "omie_document_id",
      "freight_amount",
      "sap_legacy_backup",
      "payment_lock_batch_item_id"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "external_api_allowlist",
    "columns": [
      "id",
      "company_db",
      "user_code",
      "enabled",
      "failed_attempts",
      "locked_until",
      "last_failure_at",
      "last_failure_reason",
      "notes",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "feature_flags",
    "columns": [
      "key",
      "enabled",
      "scope",
      "company_db",
      "description",
      "updated_at",
      "updated_by"
    ],
    "order": [
      "key"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "fornecedores",
    "columns": [
      "id",
      "tipo_pessoa",
      "cnpj",
      "cpf",
      "razao_social",
      "nome_fantasia",
      "tipo_estabelecimento",
      "situacao_cadastral",
      "data_inicio_atividade",
      "natureza_juridica_id",
      "natureza_juridica_descricao",
      "porte",
      "capital_social",
      "cnae_principal_codigo",
      "cnae_principal_descricao",
      "cnaes_secundarios",
      "logradouro",
      "numero",
      "complemento",
      "bairro",
      "cep",
      "municipio",
      "municipio_ibge",
      "uf",
      "pais",
      "telefone1",
      "telefone2",
      "email",
      "inscricao_estadual",
      "simples_nacional",
      "socios",
      "api_payload",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "idp_deprovision_log",
    "columns": [
      "id",
      "company_db",
      "idp_provider",
      "idp_user_id",
      "sap_user_code",
      "email",
      "user_key",
      "reason",
      "source",
      "sap_locked",
      "groups_revoked",
      "substitutions_revoked",
      "push_devices_revoked",
      "cost_centers_revoked",
      "approval_rules_orphaned",
      "details",
      "errors",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [
      "credentials_revoked"
    ],
    "review": true
  },
  {
    "table": "idp_user_mapping",
    "columns": [
      "id",
      "sap_user_code",
      "sap_user_name",
      "sap_email",
      "idp_provider",
      "idp_user_id",
      "idp_email",
      "idp_display_name",
      "status",
      "linked_at",
      "created_at",
      "updated_at",
      "employee_id",
      "employee_type",
      "job_title",
      "company_name",
      "department",
      "cost_center_code",
      "cost_center_label",
      "manager_idp_id",
      "attributes_synced_at",
      "deprovisioned_at",
      "deprovision_reason"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "item_base",
    "columns": [
      "id",
      "tipo",
      "ncm",
      "codigo_servico",
      "grupo",
      "unidade",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "item_variante",
    "columns": [
      "id",
      "item_base_id",
      "sequencial",
      "descricao",
      "codigo_completo",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "kyp_avaliacoes",
    "columns": [
      "id",
      "kyp_fornecedor_id",
      "documento",
      "tipo_pessoa",
      "nome",
      "kyp_provider_id",
      "provider_code",
      "executado_em",
      "acao",
      "motivo",
      "provider_ref_id",
      "provider_response",
      "empresas_afetadas",
      "sucesso",
      "disparado_por"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "kyp_fornecedor_ocorrencias",
    "columns": [
      "id",
      "kyp_fornecedor_id",
      "company_id",
      "company_db",
      "erp",
      "codigo_fornecedor_erp",
      "nome_erp",
      "bloqueado_em",
      "detalhes",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "kyp_fornecedores",
    "columns": [
      "id",
      "documento",
      "tipo_pessoa",
      "nome",
      "status_atual",
      "ultima_avaliacao_em",
      "proxima_expiracao_em",
      "kyp_provider_id",
      "provider_ref_id",
      "provider_status",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "kyp_providers",
    "columns": [
      "id",
      "code",
      "nome",
      "ativo",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "license_idle_alerts",
    "columns": [
      "id",
      "company_db",
      "user_code",
      "alert_week",
      "license_type",
      "days_idle",
      "whatsapp_to",
      "email_to",
      "payload",
      "sent_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "license_pricing",
    "columns": [
      "license_type",
      "monthly_cost",
      "currency",
      "updated_at"
    ],
    "order": [
      "license_type"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "message_send_log",
    "columns": [
      "id",
      "created_at",
      "channel",
      "recipient",
      "subject",
      "status",
      "error_message",
      "source",
      "company_db",
      "entity_type",
      "entity_id",
      "metadata"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "nf_entrada_contas_pagar",
    "columns": [
      "id",
      "nf_import_id",
      "source",
      "company_db",
      "ap_doc_entry",
      "ap_doc_num",
      "ap_total",
      "ap_paid",
      "ap_currency",
      "linked_by",
      "notes",
      "linked_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "nf_entrada_imports",
    "columns": [
      "id",
      "chave_acesso",
      "numero_nf",
      "serie",
      "cnpj_fornecedor",
      "nome_fornecedor",
      "data_emissao",
      "valor_total",
      "condicao_pagamento",
      "itens",
      "impostos",
      "raw_mastertax",
      "xml_storage_path",
      "pdf_storage_path",
      "expense_id",
      "sap_company_db",
      "sap_po_draft_id",
      "sap_invoice_draft_id",
      "cost_center",
      "status",
      "rejection_reason",
      "last_error",
      "last_poll_at",
      "created_at",
      "updated_at",
      "sap_matched_po_doc_entry",
      "sap_matched_po_is_draft",
      "sap_matched_card_code",
      "sap_match_reason",
      "settlement_ap_count",
      "erp_invoice_posted",
      "erp_invoice_doc_entry",
      "erp_invoice_checked_at",
      "match_candidates",
      "match_resolved_by",
      "match_resolved_at",
      "divergence_amount",
      "divergence_override_by",
      "divergence_override_reason",
      "divergence_override_at",
      "cnpj_destinatario",
      "nome_destinatario",
      "sap_matched_po_doc_num",
      "erp_invoice_doc_num",
      "erp_invoice_doc_date",
      "erp_invoice_doc_status",
      "erp_invoice_cancelled",
      "erp_invoice_open_amount",
      "erp_invoice_status_synced_at",
      "modelo",
      "subserie",
      "auto_captured"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "nf_entrada_logs",
    "columns": [
      "id",
      "import_id",
      "step",
      "status_from",
      "status_to",
      "message",
      "payload",
      "actor",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "nf_entrada_settings",
    "columns": [
      "id",
      "company_db",
      "key",
      "value",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "nfse_email_log",
    "columns": [
      "id",
      "company_db",
      "expense_id",
      "invoice_doc_entry",
      "nfse_number",
      "project_code",
      "to_emails",
      "cc_emails",
      "subject",
      "attachment_path",
      "status",
      "error_message",
      "sent_by",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "nfse_email_recipients",
    "columns": [
      "id",
      "company_db",
      "project_code",
      "brand",
      "to_emails",
      "cc_emails",
      "is_active",
      "source",
      "created_at",
      "updated_at",
      "customer_code",
      "customer_name"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "nfse_email_settings",
    "columns": [
      "id",
      "company_db",
      "from_name",
      "from_email",
      "smtp_host",
      "smtp_port",
      "smtp_user",
      "reply_to",
      "is_active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [
      "smtp_password_secret"
    ],
    "review": true
  },
  {
    "table": "notification_audit_log",
    "columns": [
      "id",
      "expense_id",
      "company_db",
      "doc_type",
      "channel",
      "recipient",
      "recipient_name",
      "recipient_role",
      "level_order",
      "event_key",
      "status",
      "resolution_source",
      "resolution_reason",
      "rule_id",
      "rule_name",
      "matrix_version",
      "cost_center",
      "project",
      "amount",
      "currency",
      "metadata",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_channel_settings",
    "columns": [
      "id",
      "company_db",
      "event_key",
      "in_app_enabled",
      "email_enabled",
      "push_enabled",
      "slack_enabled",
      "whatsapp_enabled",
      "updated_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_delivery_attempts",
    "columns": [
      "id",
      "dispatch_id",
      "recipient_id",
      "event_key",
      "channel",
      "attempt_no",
      "status",
      "error_message",
      "recipient_address",
      "recipient_name",
      "company_db",
      "source_module",
      "source_entity_type",
      "source_entity_id",
      "duration_ms",
      "metadata",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_dispatch_recipients",
    "columns": [
      "id",
      "dispatch_id",
      "recipient_name",
      "recipient_email",
      "recipient_phone",
      "recipient_user_id",
      "channel_address",
      "recipient_type",
      "status",
      "provider_message_id",
      "sent_at",
      "error_message",
      "metadata",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_dispatches",
    "columns": [
      "id",
      "event_id",
      "event_key",
      "source_module",
      "source_entity_type",
      "source_entity_id",
      "company_db",
      "rule_id",
      "template_id",
      "template_version",
      "status",
      "channel",
      "scheduled_at",
      "sent_at",
      "error_message",
      "idempotency_key",
      "payload_snapshot",
      "rendered_subject",
      "rendered_body",
      "rendered_html",
      "metadata",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_events",
    "columns": [
      "id",
      "event_key",
      "source_module",
      "source_entity_type",
      "source_entity_id",
      "company_db",
      "payload_json",
      "idempotency_key",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_governance",
    "columns": [
      "id",
      "company_db",
      "exclude_test_companies",
      "block_self_approval",
      "notify_requester",
      "extra_recipients",
      "blocked_recipients",
      "channels",
      "enabled",
      "updated_by",
      "updated_at",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_preferences",
    "columns": [
      "id",
      "user_identifier",
      "category",
      "in_app",
      "email",
      "created_at",
      "updated_at",
      "whatsapp",
      "slack"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_rule_audit_log",
    "columns": [
      "id",
      "actor_email",
      "action",
      "entity_type",
      "entity_id",
      "before_data",
      "after_data",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_rule_recipients",
    "columns": [
      "id",
      "rule_id",
      "recipient_type",
      "value",
      "filters_json",
      "active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_rules",
    "columns": [
      "id",
      "trigger_id",
      "template_id",
      "name",
      "channel",
      "priority",
      "active",
      "recipient_strategy",
      "conditions_json",
      "fallback_rule_id",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_send_runs",
    "columns": [
      "id",
      "function_name",
      "status",
      "recipients_count",
      "error_message",
      "details",
      "sent_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_settings",
    "columns": [
      "id",
      "company_db",
      "event_key",
      "label",
      "description",
      "enabled",
      "channels",
      "frequency",
      "frequency_minutes",
      "window_start_hour",
      "window_end_hour",
      "weekdays_only",
      "subject_template",
      "body_template",
      "html_template",
      "trigger_config",
      "updated_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_templates",
    "columns": [
      "id",
      "name",
      "description",
      "channel",
      "subject_template",
      "body_template",
      "html_template",
      "variables_schema",
      "active",
      "version",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notification_triggers",
    "columns": [
      "id",
      "name",
      "event_key",
      "source_module",
      "description",
      "company_db",
      "active",
      "debounce_seconds",
      "conditions_json",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "notifications",
    "columns": [
      "id",
      "user_identifier",
      "company_db",
      "title",
      "body",
      "category",
      "is_read",
      "link",
      "metadata",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "overdue_reminder_log",
    "columns": [
      "id",
      "expense_id",
      "company_db",
      "recipient_role",
      "recipient_name",
      "recipient_phone",
      "sent_at",
      "status",
      "response"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "overdue_reminder_settings",
    "columns": [
      "id",
      "company_db",
      "enabled",
      "frequency_minutes",
      "template",
      "window_start_hour",
      "window_end_hour",
      "weekdays_only",
      "max_reminders_per_doc",
      "notify_approver",
      "notify_requester",
      "updated_at",
      "updated_by"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_account_mapping",
    "columns": [
      "id",
      "account_code",
      "account_name",
      "cost_center",
      "project",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_balance_snapshots",
    "columns": [
      "id",
      "company_db",
      "account",
      "alias",
      "account_type",
      "parent_account",
      "cost_center",
      "available",
      "snapshot_date",
      "captured_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_card_mapping",
    "columns": [
      "id",
      "company_db",
      "card_identifier",
      "card_label",
      "is_fallback",
      "cost_center",
      "project",
      "item_code",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_card_supplier_mapping",
    "columns": [
      "id",
      "company_db",
      "card_identifier",
      "card_label",
      "supplier_code",
      "supplier_name",
      "cost_center",
      "project",
      "item_code",
      "account_code",
      "is_active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_cards",
    "columns": [
      "id",
      "company_db",
      "card_identifier",
      "card_name",
      "card_last_digits",
      "card_label",
      "account_alias",
      "first_seen_at",
      "last_seen_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_description_supplier_rules",
    "columns": [
      "id",
      "company_db",
      "pattern",
      "match_type",
      "supplier_code",
      "supplier_name",
      "priority",
      "is_active",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_document_classification",
    "columns": [
      "id",
      "company_db",
      "pagcorp_expense_id",
      "status",
      "has_fiscal_document",
      "document_kinds",
      "confidence",
      "error_message",
      "analyzed_at",
      "created_at",
      "updated_at",
      "documents_total",
      "documents_currency",
      "documents_count",
      "is_international"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_document_relations",
    "columns": [
      "pagcorp_log_id",
      "company_db",
      "po_doc_entry",
      "po_doc_num",
      "po_status",
      "po_total",
      "po_total_fc",
      "po_currency",
      "nf_doc_entries",
      "payment_doc_entries",
      "po_found",
      "nf_found",
      "payment_found",
      "amount_matches",
      "last_resolved_at",
      "resolve_error",
      "created_at",
      "updated_at",
      "nf_inferred"
    ],
    "order": [
      "pagcorp_log_id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_item_mapping",
    "columns": [
      "id",
      "account_code",
      "account_name",
      "item_code",
      "is_fallback",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_nondeductible_cards",
    "columns": [
      "id",
      "company_db",
      "card_identifier",
      "card_label",
      "card_holder",
      "supplier_code",
      "supplier_name",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_nondeductible_expenses",
    "columns": [
      "id",
      "pagcorp_expense_id",
      "company_db",
      "supplier_code",
      "supplier_name",
      "reason",
      "created_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_settlement_accounts",
    "columns": [
      "id",
      "company_db",
      "card_identifier",
      "settlement_account_code",
      "cost_center",
      "project",
      "enabled",
      "created_at",
      "updated_at",
      "currency",
      "event_classification"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_settlement_candidate_notices",
    "columns": [
      "id",
      "company_db",
      "po_doc_num",
      "nf_doc_nums",
      "vendor_name",
      "amount",
      "first_notified_at",
      "last_seen_at",
      "resolved_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pagcorp_supplier_links",
    "columns": [
      "id",
      "company_db",
      "federal_tax_id",
      "card_name_key",
      "supplier_id",
      "card_code",
      "card_name",
      "resolution",
      "resolved_by",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "pedidos_venda_erp",
    "columns": [
      "id",
      "company_db",
      "doc_entry",
      "doc_num",
      "card_code",
      "criado_por",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "permission_group_modules",
    "columns": [
      "id",
      "group_id",
      "module_key",
      "created_at",
      "can_view",
      "can_create",
      "can_edit",
      "can_delete",
      "can_approve",
      "can_integrate",
      "can_export"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "permission_groups",
    "columns": [
      "id",
      "name",
      "description",
      "created_at",
      "updated_at",
      "company_db",
      "erp_type"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "permissions_enforcement_scope",
    "columns": [
      "company_db",
      "enabled",
      "updated_at",
      "updated_by"
    ],
    "order": [
      "company_db"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "po_notification_sent",
    "columns": [
      "id",
      "company_db",
      "po_doc_entry",
      "po_doc_num",
      "milestone",
      "recipient_email",
      "email_subject",
      "email_html",
      "status",
      "error_message",
      "sent_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "registration_request_events",
    "columns": [
      "id",
      "request_id",
      "author_email",
      "author_name",
      "event_type",
      "message",
      "from_status",
      "to_status",
      "created_at",
      "attachments"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "registration_requests",
    "columns": [
      "id",
      "request_type",
      "status",
      "title",
      "federal_tax_id",
      "contact_email",
      "phone1",
      "phone2",
      "currency",
      "address",
      "payment_method",
      "bank_details",
      "registration_mode",
      "context",
      "transaction",
      "attachments",
      "notes",
      "company_db",
      "requester_email",
      "requester_name",
      "assignee_email",
      "sap_card_code",
      "resolution_note",
      "due_at",
      "resolved_at",
      "resolved_by",
      "created_at",
      "updated_at",
      "followers"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "registration_sla_reminder_log",
    "columns": [
      "id",
      "request_id",
      "kind",
      "recipients",
      "status",
      "detail",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "roi_parameters",
    "columns": [
      "id",
      "company_db",
      "salario_aprovador",
      "salario_solicitante",
      "tempo_lancar_sap_min",
      "tempo_aprovar_sap_min",
      "tempo_lancar_flow_min",
      "tempo_aprovar_flow_min",
      "custo_licenca_aprovador_sap",
      "custo_licenca_solicitante_sap",
      "custo_licenca_flow",
      "multa_percent",
      "juros_mes_percent",
      "horas_mes",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sales_order_invoices",
    "columns": [
      "id",
      "expense_id",
      "company_db",
      "sap_order_doc_entry",
      "sap_invoice_doc_entry",
      "sap_invoice_doc_num",
      "nfse_number",
      "rps_number",
      "series",
      "authorized_at",
      "total_amount",
      "currency",
      "status",
      "last_error",
      "created_by_email",
      "created_at",
      "updated_at",
      "sap_order_doc_num",
      "paid_amount",
      "paid_at",
      "sap_incoming_payment_doc_entry",
      "sap_incoming_payment_doc_num",
      "fiscal_authorized_at",
      "fiscal_doc_key"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_attachments",
    "columns": [
      "id",
      "company_db",
      "doc_type",
      "doc_entry",
      "attachment_entry",
      "line_num",
      "file_name",
      "file_extension",
      "source_path",
      "storage_path",
      "byte_size",
      "sha256",
      "status",
      "last_error",
      "downloaded_at",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_cursors",
    "columns": [
      "company_db",
      "doc_type",
      "last_doc_entry",
      "last_full_sync_at",
      "last_incremental_at",
      "completed",
      "updated_at"
    ],
    "order": [
      "company_db",
      "doc_type"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_documents",
    "columns": [
      "id",
      "company_db",
      "doc_type",
      "doc_entry",
      "doc_num",
      "doc_date",
      "card_code",
      "card_name",
      "doc_total",
      "doc_currency",
      "doc_status",
      "update_date",
      "attachment_entry",
      "attachments_total",
      "attachments_copied",
      "payload",
      "last_error",
      "fetched_at",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_master_cursors",
    "columns": [
      "company_db",
      "entity_type",
      "last_offset",
      "completed",
      "last_full_sync_at",
      "last_incremental_at",
      "updated_at"
    ],
    "order": [
      "company_db",
      "entity_type"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_master_data",
    "columns": [
      "id",
      "company_db",
      "entity_type",
      "code",
      "name",
      "payload",
      "update_date",
      "fetched_at",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_master_restore_map",
    "columns": [
      "id",
      "source_company_db",
      "target_company_db",
      "entity_type",
      "code",
      "status",
      "error_message",
      "restored_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_restore_map",
    "columns": [
      "id",
      "source_company_db",
      "target_company_db",
      "doc_type",
      "source_doc_entry",
      "source_doc_num",
      "target_doc_entry",
      "target_doc_num",
      "status",
      "error_message",
      "restored_at",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_archive_runs",
    "columns": [
      "id",
      "company_db",
      "kind",
      "doc_type",
      "status",
      "documents_count",
      "attachments_count",
      "errors",
      "started_at",
      "finished_at",
      "duration_ms",
      "triggered_by"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_cache",
    "columns": [
      "id",
      "cache_key",
      "company_db",
      "data",
      "expires_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_fluxo_analise_cache",
    "columns": [
      "id",
      "company_db",
      "flow_key",
      "data_atualizacao_esboco",
      "solicitante",
      "departamento",
      "centro_custo",
      "marca",
      "descricao",
      "aprovador",
      "data_aprovacao",
      "fornecedor",
      "valor",
      "data_vencimento",
      "data_lancamento",
      "data_pagamento",
      "id_esboco",
      "id_pedido",
      "id_nf",
      "id_cp",
      "raw_json",
      "synced_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_group_mapping",
    "columns": [
      "id",
      "company_db",
      "sap_group_code",
      "sap_group_name",
      "module_key",
      "can_view",
      "can_create",
      "can_edit",
      "can_delete",
      "can_approve",
      "can_integrate",
      "can_export",
      "created_at",
      "updated_at",
      "created_by"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_groups_cache",
    "columns": [
      "id",
      "company_db",
      "sap_group_code",
      "sap_group_name",
      "last_seen_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_nf_entrada_cache",
    "columns": [
      "id",
      "company_db",
      "doc_entry",
      "doc_num",
      "series",
      "card_code",
      "card_name",
      "doc_date",
      "doc_due_date",
      "tax_date",
      "doc_total",
      "doc_currency",
      "document_status",
      "cancelled",
      "base_po_doc_entry",
      "raw_json",
      "sap_update_date",
      "synced_at",
      "created_at",
      "updated_at",
      "paid_to_date",
      "sequence_serial",
      "series_string",
      "sub_series_string",
      "sequence_model",
      "folio_number"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_po_nf_cp_cache",
    "columns": [
      "id",
      "company_db",
      "link_key",
      "id_pedido_compra",
      "id_nf_entrada",
      "numero_nota_fiscal",
      "id_contas_pagar",
      "cod_fornecedor",
      "nome_fornecedor",
      "valor",
      "referencia_valor",
      "status_geral",
      "raw_json",
      "synced_at",
      "created_at",
      "data_criacao_pedido",
      "data_criacao_nf",
      "data_vencimento_parcela",
      "data_pagamento"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_purchase_order_cache",
    "columns": [
      "id",
      "company_db",
      "doc_entry",
      "doc_num",
      "series",
      "card_code",
      "card_name",
      "doc_date",
      "doc_due_date",
      "doc_total",
      "doc_total_fc",
      "doc_currency",
      "document_status",
      "cancelled",
      "sap_update_date",
      "raw_json",
      "synced_at",
      "created_at",
      "updated_at",
      "comments"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_total_reconciliation",
    "columns": [
      "id",
      "expense_id",
      "company_db",
      "doc_type",
      "sap_doc_entry",
      "sap_doc_num",
      "flow_total",
      "sap_total",
      "sap_net_total",
      "difference",
      "abs_difference",
      "status",
      "cause",
      "cause_label",
      "cause_detail",
      "breakdown",
      "resolved_at",
      "resolved_by",
      "checked_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_user_directory",
    "columns": [
      "user_key",
      "sap_user_code",
      "display_name",
      "is_active",
      "created_at",
      "updated_at",
      "management_segment"
    ],
    "order": [
      "user_key"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_user_emails",
    "columns": [
      "id",
      "user_key",
      "email",
      "is_primary",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sap_vendor_payment_cache",
    "columns": [
      "id",
      "company_db",
      "doc_entry",
      "doc_num",
      "series",
      "card_code",
      "card_name",
      "doc_date",
      "doc_total",
      "doc_total_fc",
      "doc_currency",
      "document_status",
      "cancelled",
      "invoice_links",
      "sap_update_date",
      "raw_json",
      "synced_at",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sla_escalation_settings",
    "columns": [
      "id",
      "company_db",
      "enabled",
      "sla_business_hours",
      "repeat_business_hours",
      "prefer_substitute",
      "escalate_to_next_level",
      "fallback_email",
      "max_escalations",
      "notify_in_app",
      "notify_email",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "sla_escalations",
    "columns": [
      "id",
      "expense_id",
      "company_db",
      "doc_num",
      "doc_type",
      "supplier_name",
      "total_amount",
      "currency",
      "from_approver",
      "to_approver",
      "target_kind",
      "level_from",
      "level_to",
      "substitution_id",
      "pending_since",
      "sla_deadline",
      "escalation_index",
      "notes",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "standalone_mode",
    "columns": [
      "company_db",
      "enabled",
      "reason",
      "ends_at",
      "snapshot_at",
      "snapshot_summary",
      "updated_by",
      "updated_at",
      "created_at"
    ],
    "order": [
      "company_db"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "substitute_notification_preferences",
    "columns": [
      "id",
      "user_identifier",
      "enabled",
      "in_app",
      "email",
      "push",
      "slack",
      "min_amount",
      "delay_minutes",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "suppliers",
    "columns": [
      "id",
      "company_db",
      "card_code",
      "card_name",
      "card_type",
      "federal_tax_id",
      "u_fgr_taxid0",
      "email",
      "phone1",
      "phone2",
      "currency",
      "bill_to_street",
      "bill_to_zip",
      "bill_to_city",
      "bill_to_state",
      "bill_to_country",
      "bill_to_block",
      "bill_to_building",
      "is_active",
      "sap_sync_status",
      "sap_sync_error",
      "sap_last_synced_at",
      "source",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "suppressed_emails",
    "columns": [
      "id",
      "email",
      "reason",
      "metadata",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "uber_cost_center_project_defaults",
    "columns": [
      "id",
      "company_db",
      "cost_center_code",
      "cost_center_label",
      "project_code",
      "project_name",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "uber_user_mappings",
    "columns": [
      "id",
      "company_db",
      "source",
      "employee_key",
      "employee_name",
      "employee_email",
      "cost_center_code",
      "cost_center_label",
      "origin",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_company_access",
    "columns": [
      "id",
      "email",
      "company_db",
      "created_at",
      "created_by"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_group_assignments",
    "columns": [
      "id",
      "sap_email",
      "group_id",
      "created_at",
      "company_db"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_identity_migration_backup",
    "columns": [
      "id",
      "source_table",
      "payload",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_licenses",
    "columns": [
      "id",
      "company_db",
      "user_code",
      "user_name",
      "is_locked",
      "has_license",
      "license_type",
      "notes",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_management_segments",
    "columns": [
      "id",
      "user_key",
      "company_db",
      "segment",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_phones",
    "columns": [
      "id",
      "company_db",
      "user_code",
      "phone",
      "source",
      "updated_at",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_profiles",
    "columns": [
      "id",
      "company_db",
      "user_code",
      "display_name",
      "avatar_url",
      "email",
      "phone",
      "notify_whatsapp_overdue",
      "notify_whatsapp_approvals",
      "notify_email_overdue",
      "notify_email_approvals",
      "sap_synced_at",
      "dismissed_until",
      "created_at",
      "updated_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "user_roles",
    "columns": [
      "id",
      "user_id",
      "role",
      "created_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "whatsapp_approval_alerts",
    "columns": [
      "id",
      "company_db",
      "approval_request_id",
      "approver_code",
      "whatsapp_to",
      "payload",
      "sent_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "whatsapp_flow_approval_alerts",
    "columns": [
      "id",
      "company_db",
      "expense_id",
      "approver_code",
      "whatsapp_to",
      "payload",
      "sent_at"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  },
  {
    "table": "whatsapp_login_alerts",
    "columns": [
      "id",
      "company_db",
      "user_code",
      "failure_key",
      "sent_at",
      "whatsapp_to",
      "payload"
    ],
    "order": [
      "id"
    ],
    "excluded_columns": [],
    "review": true
  }
] as const;
export const EXCLUDED = [
  {
    "table": "ai_chat_messages",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "ai_chat_threads",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "api_keys",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "approval_action_tokens",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "approval_history_sync_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "audit_pay_queue",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "auth_caller_cache",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "copilot_pending_actions",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "db_query_metrics",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "edge_function_metrics",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "edge_metrics_alerts",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "edge_rate_limits",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "email_send_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "email_unsubscribe_tokens",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "employee_sync_execution",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "employee_sync_item",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "erp_session_cache",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "erp_session_revocations",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "expense_action_idempotency",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "expense_create_idempotency",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "expense_sap_sync_runs",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "gdrive_backup_settings",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "gdrive_export_chunks",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "gdrive_export_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "hana_health_probes",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "impersonation_sessions",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "infra_backup_log",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "integration_health_alert_settings",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "integration_health_alerts",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "integration_log",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "integration_pause",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "nf_entrada_write_queue",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "nf_po_draft_jobs",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "pagcorp_integration_log",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "pagcorp_portal_sessions",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "permission_shadow_log",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "push_subscriptions",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "sap_fluxo_analise_sync_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "sap_nf_entrada_sync_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "sap_po_nf_cp_sync_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "sap_purchase_order_sync_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "sap_retry_queue",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "sap_vendor_payment_sync_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "security_csrf_tokens",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "submitted_document_hashes",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "synapse_execution_log",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "synapse_global_settings",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "synapse_integrations",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "system_credentials",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "user_sap_credentials",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "user_tour_state",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  },
  {
    "table": "watcher_runs",
    "reason": "credenciais/sessões, operação técnica/filas ou sem chave estável"
  }
] as const;
