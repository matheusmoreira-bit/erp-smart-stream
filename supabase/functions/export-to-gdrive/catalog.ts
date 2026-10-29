export const CATALOG = [] as const;
export const EXCLUDED = [
  {
    "table": "access_review_campaigns",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "access_review_items",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "accounts_payable_bank_accounts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "accounts_payable_batch_items",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "accounts_payable_batches",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "accounts_payable_return_events",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "accounts_payable_supplier_payment_profiles",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "advance_invoice_applications",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "advance_payment_attachments",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "advance_payment_items",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "advance_payments",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "ai_chat_messages",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "ai_chat_threads",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "ai_document_analyses",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "api_keys",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "approval_action_tokens",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "approval_history",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "approval_history_sync_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "approval_matrix_versions",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "approval_rule_levels",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "approval_rules",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "approver_cost_centers",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "approver_substitutes",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_accounts_payable",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_approval_decisions",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_approval_requests",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_divergences",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_documents",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_insights",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_logs",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_rules",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_runs",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_workflow_runs",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_console_workflow_steps",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_pay_config",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_pay_finding",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_pay_fraud_signal",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_pay_queue",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "audit_pay_result",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_trail",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "audit_trail_archive",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "auditoria_cruzamento_config",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "auditoria_cruzamento_fiscal",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "auth_caller_cache",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "baixas_recebimento",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "baixas_recebimento_itens",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "cc_project_alerts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "collaborator_profiles",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "companies",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "copilot_pending_actions",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "cost_center_redirects",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "db_query_metrics",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "document_drafts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "edge_function_metrics",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "edge_metrics_alerts",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "edge_rate_limits",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "email_send_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "email_send_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "email_unsubscribe_tokens",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "employee_department_mapping",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "employee_integration_config",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "employee_pending_relation",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "employee_sync_execution",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "employee_sync_item",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "empresa_kyp_config",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "enabled_erp_types",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "erp_session_cache",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "erp_session_revocations",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "expense_action_idempotency",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "expense_approval_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "expense_approval_segments",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "expense_attachments",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "expense_audit_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "expense_create_idempotency",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "expense_items",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "expense_revisions",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "expense_sap_sync_runs",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "expenses",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "external_api_allowlist",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "feature_flags",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "fornecedores",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "gdrive_backup_settings",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "gdrive_export_chunks",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "gdrive_export_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "hana_health_probes",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "idp_deprovision_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "idp_user_mapping",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "impersonation_sessions",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "infra_backup_log",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "integration_health_alert_settings",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "integration_health_alerts",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "integration_log",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "integration_pause",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "item_base",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "item_variante",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "kyp_avaliacoes",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "kyp_fornecedor_ocorrencias",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "kyp_fornecedores",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "kyp_providers",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "license_idle_alerts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "license_pricing",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "message_send_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "nf_entrada_contas_pagar",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "nf_entrada_imports",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "nf_entrada_logs",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "nf_entrada_settings",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "nf_entrada_write_queue",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "nf_po_draft_jobs",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "nfse_email_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "nfse_email_recipients",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "nfse_email_settings",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_audit_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_channel_settings",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_delivery_attempts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_dispatch_recipients",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_dispatches",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_events",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_governance",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_preferences",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_rule_audit_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_rule_recipients",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_rules",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_send_runs",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_settings",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_templates",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notification_triggers",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "notifications",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "overdue_reminder_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "overdue_reminder_settings",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_account_mapping",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_balance_snapshots",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_card_mapping",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_card_supplier_mapping",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_cards",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_description_supplier_rules",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_document_classification",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_document_relations",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_integration_log",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "pagcorp_item_mapping",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_nondeductible_cards",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_nondeductible_expenses",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_portal_sessions",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "pagcorp_settlement_accounts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_settlement_candidate_notices",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pagcorp_supplier_links",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "pedidos_venda_erp",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "permission_group_modules",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "permission_groups",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "permission_shadow_log",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "permissions_enforcement_scope",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "po_notification_sent",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "push_subscriptions",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "registration_request_events",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "registration_requests",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "registration_sla_reminder_log",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "roi_parameters",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sales_order_invoices",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_attachments",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_cursors",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_documents",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_master_cursors",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_master_data",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_master_restore_map",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_restore_map",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_archive_runs",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_cache",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_fluxo_analise_cache",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_fluxo_analise_sync_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "sap_group_mapping",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_groups_cache",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_nf_entrada_cache",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_nf_entrada_sync_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "sap_po_nf_cp_cache",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_po_nf_cp_sync_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "sap_purchase_order_cache",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_purchase_order_sync_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "sap_retry_queue",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "sap_total_reconciliation",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_user_directory",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_user_emails",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_vendor_payment_cache",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sap_vendor_payment_sync_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "security_csrf_tokens",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "sla_escalation_settings",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "sla_escalations",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "standalone_mode",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "submitted_document_hashes",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "substitute_notification_preferences",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "suppliers",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "suppressed_emails",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "synapse_execution_log",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "synapse_global_settings",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "synapse_integrations",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "system_credentials",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "uber_cost_center_project_defaults",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "uber_user_mappings",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_company_access",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_group_assignments",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_identity_migration_backup",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_licenses",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_management_segments",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_phones",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_profiles",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_roles",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "user_sap_credentials",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "user_tour_state",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "watcher_runs",
    "reason": "credenciais/sessões ou operação técnica/filas; não é exportação de negócio"
  },
  {
    "table": "whatsapp_approval_alerts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "whatsapp_flow_approval_alerts",
    "reason": "sem chave primária estável; revisão necessária"
  },
  {
    "table": "whatsapp_login_alerts",
    "reason": "sem chave primária estável; revisão necessária"
  }
] as const;
