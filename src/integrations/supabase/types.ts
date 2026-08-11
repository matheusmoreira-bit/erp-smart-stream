export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_review_campaigns: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          due_at: string | null
          id: string
          name: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          period_label: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          name: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          period_label: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          period_label?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      access_review_items: {
        Row: {
          access_label: string
          access_ref_id: string | null
          access_type: string
          campaign_id: string
          company_db: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          display_name: string | null
          evidence: Json
          id: string
          justification: string | null
          sap_email: string | null
          updated_at: string
          user_key: string
        }
        Insert: {
          access_label: string
          access_ref_id?: string | null
          access_type: string
          campaign_id: string
          company_db?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          display_name?: string | null
          evidence?: Json
          id?: string
          justification?: string | null
          sap_email?: string | null
          updated_at?: string
          user_key: string
        }
        Update: {
          access_label?: string
          access_ref_id?: string | null
          access_type?: string
          campaign_id?: string
          company_db?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          display_name?: string | null
          evidence?: Json
          id?: string
          justification?: string | null
          sap_email?: string | null
          updated_at?: string
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_review_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "access_review_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      advance_payment_attachments: {
        Row: {
          advance_id: string
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          uploaded_by: string | null
        }
        Insert: {
          advance_id: string
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          advance_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advance_payment_attachments_advance_id_fkey"
            columns: ["advance_id"]
            isOneToOne: false
            referencedRelation: "advance_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      advance_payment_items: {
        Row: {
          advance_id: string
          cost_center: string | null
          cost_center_name: string | null
          created_at: string
          description: string
          id: string
          item_code: string | null
          line_total: number
          project: string | null
          project_name: string | null
          quantity: number
          unit_price: number
        }
        Insert: {
          advance_id: string
          cost_center?: string | null
          cost_center_name?: string | null
          created_at?: string
          description: string
          id?: string
          item_code?: string | null
          line_total?: number
          project?: string | null
          project_name?: string | null
          quantity?: number
          unit_price?: number
        }
        Update: {
          advance_id?: string
          cost_center?: string | null
          cost_center_name?: string | null
          created_at?: string
          description?: string
          id?: string
          item_code?: string | null
          line_total?: number
          project?: string | null
          project_name?: string | null
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "advance_payment_items_advance_id_fkey"
            columns: ["advance_id"]
            isOneToOne: false
            referencedRelation: "advance_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      advance_payments: {
        Row: {
          amount: number
          company_db: string
          cost_center: string | null
          cost_center_name: string | null
          created_at: string
          currency: string
          current_approval_level: number
          due_date: string | null
          id: string
          rejection_reason: string | null
          remarks: string | null
          requester_email: string | null
          requester_id: string
          requester_name: string | null
          sap_doc_entry: number | null
          sap_doc_num: number | null
          sap_integrated_at: string | null
          sap_integration_error: string | null
          sap_integration_locked_at: string | null
          sap_integration_status: string | null
          status: string
          supplier_card_code: string
          supplier_cnpj: string | null
          supplier_name: string
          total_approval_levels: number
          updated_at: string
        }
        Insert: {
          amount: number
          company_db: string
          cost_center?: string | null
          cost_center_name?: string | null
          created_at?: string
          currency?: string
          current_approval_level?: number
          due_date?: string | null
          id?: string
          rejection_reason?: string | null
          remarks?: string | null
          requester_email?: string | null
          requester_id: string
          requester_name?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_integrated_at?: string | null
          sap_integration_error?: string | null
          sap_integration_locked_at?: string | null
          sap_integration_status?: string | null
          status?: string
          supplier_card_code: string
          supplier_cnpj?: string | null
          supplier_name: string
          total_approval_levels?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          company_db?: string
          cost_center?: string | null
          cost_center_name?: string | null
          created_at?: string
          currency?: string
          current_approval_level?: number
          due_date?: string | null
          id?: string
          rejection_reason?: string | null
          remarks?: string | null
          requester_email?: string | null
          requester_id?: string
          requester_name?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_integrated_at?: string | null
          sap_integration_error?: string | null
          sap_integration_locked_at?: string | null
          sap_integration_status?: string | null
          status?: string
          supplier_card_code?: string
          supplier_cnpj?: string | null
          supplier_name?: string
          total_approval_levels?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_chat_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          role: string
          thread_id: string
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          role: string
          thread_id: string
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      approval_action_tokens: {
        Row: {
          approver_email: string
          approver_name: string | null
          channel: string
          created_at: string
          expense_id: string
          expires_at: string
          id: string
          level_order: number | null
          token_hash: string
          used_action: string | null
          used_at: string | null
          used_ip: string | null
          used_user_agent: string | null
        }
        Insert: {
          approver_email: string
          approver_name?: string | null
          channel?: string
          created_at?: string
          expense_id: string
          expires_at: string
          id?: string
          level_order?: number | null
          token_hash: string
          used_action?: string | null
          used_at?: string | null
          used_ip?: string | null
          used_user_agent?: string | null
        }
        Update: {
          approver_email?: string
          approver_name?: string | null
          channel?: string
          created_at?: string
          expense_id?: string
          expires_at?: string
          id?: string
          level_order?: number | null
          token_hash?: string
          used_action?: string | null
          used_at?: string | null
          used_ip?: string | null
          used_user_agent?: string | null
        }
        Relationships: []
      }
      approval_history: {
        Row: {
          approver_code: string | null
          approver_email: string | null
          approver_name: string | null
          card_code: string | null
          card_name: string | null
          company_db: string
          created_at: string
          currency: string | null
          decision: string | null
          decision_date: string | null
          doc_entry: number | null
          doc_num: number | null
          doc_object_type: string | null
          doc_total: number | null
          doc_type_name: string | null
          external_id: string
          id: string
          raw: Json
          remarks: string | null
          requester_code: string | null
          requester_name: string | null
          stage_name: string | null
          step: number | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          approver_code?: string | null
          approver_email?: string | null
          approver_name?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db: string
          created_at?: string
          currency?: string | null
          decision?: string | null
          decision_date?: string | null
          doc_entry?: number | null
          doc_num?: number | null
          doc_object_type?: string | null
          doc_total?: number | null
          doc_type_name?: string | null
          external_id: string
          id?: string
          raw?: Json
          remarks?: string | null
          requester_code?: string | null
          requester_name?: string | null
          stage_name?: string | null
          step?: number | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          approver_code?: string | null
          approver_email?: string | null
          approver_name?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db?: string
          created_at?: string
          currency?: string | null
          decision?: string | null
          decision_date?: string | null
          doc_entry?: number | null
          doc_num?: number | null
          doc_object_type?: string | null
          doc_total?: number | null
          doc_type_name?: string | null
          external_id?: string
          id?: string
          raw?: Json
          remarks?: string | null
          requester_code?: string | null
          requester_name?: string | null
          stage_name?: string | null
          step?: number | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      approval_history_sync_state: {
        Row: {
          id: number
          last_count: number | null
          last_message: string | null
          last_status: string | null
          last_sync_at: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          last_count?: number | null
          last_message?: string | null
          last_status?: string | null
          last_sync_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          last_count?: number | null
          last_message?: string | null
          last_status?: string | null
          last_sync_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      approval_matrix_versions: {
        Row: {
          company_db: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          label: string | null
          levels_count: number
          restored_from_version: number | null
          rules_count: number
          snapshot: Json
          updated_at: string
          version_no: number
        }
        Insert: {
          company_db: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          label?: string | null
          levels_count?: number
          restored_from_version?: number | null
          rules_count?: number
          snapshot?: Json
          updated_at?: string
          version_no: number
        }
        Update: {
          company_db?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          label?: string | null
          levels_count?: number
          restored_from_version?: number | null
          rules_count?: number
          snapshot?: Json
          updated_at?: string
          version_no?: number
        }
        Relationships: []
      }
      approval_rule_levels: {
        Row: {
          approver_email: string | null
          approver_name: string
          created_at: string
          id: string
          level_order: number
          rule_id: string
        }
        Insert: {
          approver_email?: string | null
          approver_name: string
          created_at?: string
          id?: string
          level_order: number
          rule_id: string
        }
        Update: {
          approver_email?: string | null
          approver_name?: string
          created_at?: string
          id?: string
          level_order?: number
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rule_levels_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          company_db: string
          cost_center: string | null
          created_at: string
          created_by: string
          criteria: Json | null
          doc_type: string | null
          id: string
          is_active: boolean
          max_value: number | null
          min_value: number | null
          name: string
          priority: number
          project: string | null
          requester_pattern: string | null
          updated_at: string
        }
        Insert: {
          company_db: string
          cost_center?: string | null
          created_at?: string
          created_by: string
          criteria?: Json | null
          doc_type?: string | null
          id?: string
          is_active?: boolean
          max_value?: number | null
          min_value?: number | null
          name: string
          priority?: number
          project?: string | null
          requester_pattern?: string | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          cost_center?: string | null
          created_at?: string
          created_by?: string
          criteria?: Json | null
          doc_type?: string | null
          id?: string
          is_active?: boolean
          max_value?: number | null
          min_value?: number | null
          name?: string
          priority?: number
          project?: string | null
          requester_pattern?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      approver_cost_centers: {
        Row: {
          company_db: string
          cost_center: string
          cost_center_name: string | null
          created_at: string
          id: string
          sap_email: string
          updated_at: string
        }
        Insert: {
          company_db: string
          cost_center: string
          cost_center_name?: string | null
          created_at?: string
          id?: string
          sap_email: string
          updated_at?: string
        }
        Update: {
          company_db?: string
          cost_center?: string
          cost_center_name?: string | null
          created_at?: string
          id?: string
          sap_email?: string
          updated_at?: string
        }
        Relationships: []
      }
      approver_substitutes: {
        Row: {
          company_db: string | null
          cost_center_prefixes: string[] | null
          created_at: string
          ends_at: string
          granted_by_email: string
          granted_by_id: string | null
          id: string
          official_email: string
          official_name: string | null
          reason: string | null
          revoked_at: string | null
          revoked_by_email: string | null
          revoked_by_id: string | null
          revoked_reason: string | null
          starts_at: string
          substitute_email: string
          substitute_name: string | null
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          cost_center_prefixes?: string[] | null
          created_at?: string
          ends_at: string
          granted_by_email: string
          granted_by_id?: string | null
          id?: string
          official_email: string
          official_name?: string | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by_email?: string | null
          revoked_by_id?: string | null
          revoked_reason?: string | null
          starts_at?: string
          substitute_email: string
          substitute_name?: string | null
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          cost_center_prefixes?: string[] | null
          created_at?: string
          ends_at?: string
          granted_by_email?: string
          granted_by_id?: string | null
          id?: string
          official_email?: string
          official_name?: string | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by_email?: string | null
          revoked_by_id?: string | null
          revoked_reason?: string | null
          starts_at?: string
          substitute_email?: string
          substitute_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_console_accounts_payable: {
        Row: {
          card_code: string | null
          company_db: string
          doc_date: string | null
          due_date: string | null
          id: string
          linked_grpo_id: string | null
          linked_invoice_id: string | null
          payment_terms_code: string | null
          raw_data: Json | null
          sap_doc_entry: number
          synced_at: string
          total_amount: number | null
        }
        Insert: {
          card_code?: string | null
          company_db: string
          doc_date?: string | null
          due_date?: string | null
          id?: string
          linked_grpo_id?: string | null
          linked_invoice_id?: string | null
          payment_terms_code?: string | null
          raw_data?: Json | null
          sap_doc_entry: number
          synced_at?: string
          total_amount?: number | null
        }
        Update: {
          card_code?: string | null
          company_db?: string
          doc_date?: string | null
          due_date?: string | null
          id?: string
          linked_grpo_id?: string | null
          linked_invoice_id?: string | null
          payment_terms_code?: string | null
          raw_data?: Json | null
          sap_doc_entry?: number
          synced_at?: string
          total_amount?: number | null
        }
        Relationships: []
      }
      audit_console_approval_decisions: {
        Row: {
          approval_request_id: string | null
          approver_user_id: number | null
          company_db: string
          decided_at: string | null
          id: string
          raw_data: Json | null
          remarks: string | null
          status: string | null
          step_number: number | null
          synced_at: string
        }
        Insert: {
          approval_request_id?: string | null
          approver_user_id?: number | null
          company_db: string
          decided_at?: string | null
          id?: string
          raw_data?: Json | null
          remarks?: string | null
          status?: string | null
          step_number?: number | null
          synced_at?: string
        }
        Update: {
          approval_request_id?: string | null
          approver_user_id?: number | null
          company_db?: string
          decided_at?: string | null
          id?: string
          raw_data?: Json | null
          remarks?: string | null
          status?: string | null
          step_number?: number | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_console_approval_decisions_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "audit_console_approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_console_approval_requests: {
        Row: {
          company_db: string
          doc_date_sap: string | null
          doc_entry: number | null
          doc_object_type: string | null
          id: string
          originator_user_id: number | null
          raw_data: Json | null
          remarks: string | null
          sap_request_id: number
          status: string | null
          synced_at: string
          template_id: number | null
          update_date_sap: string | null
        }
        Insert: {
          company_db: string
          doc_date_sap?: string | null
          doc_entry?: number | null
          doc_object_type?: string | null
          id?: string
          originator_user_id?: number | null
          raw_data?: Json | null
          remarks?: string | null
          sap_request_id: number
          status?: string | null
          synced_at?: string
          template_id?: number | null
          update_date_sap?: string | null
        }
        Update: {
          company_db?: string
          doc_date_sap?: string | null
          doc_entry?: number | null
          doc_object_type?: string | null
          id?: string
          originator_user_id?: number | null
          raw_data?: Json | null
          remarks?: string | null
          sap_request_id?: number
          status?: string | null
          synced_at?: string
          template_id?: number | null
          update_date_sap?: string | null
        }
        Relationships: []
      }
      audit_console_divergences: {
        Row: {
          actual_value: number | null
          audit_run_id: string | null
          card_code: string | null
          company_db: string
          created_at: string
          delta_value: number | null
          description: string
          divergence_type: Database["public"]["Enums"]["audit_console_divergence_type"]
          expected_value: number | null
          id: string
          is_fraud_flag: boolean
          is_reviewed: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          severity: Database["public"]["Enums"]["audit_console_severity"]
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          actual_value?: number | null
          audit_run_id?: string | null
          card_code?: string | null
          company_db: string
          created_at?: string
          delta_value?: number | null
          description: string
          divergence_type: Database["public"]["Enums"]["audit_console_divergence_type"]
          expected_value?: number | null
          id?: string
          is_fraud_flag?: boolean
          is_reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          severity?: Database["public"]["Enums"]["audit_console_severity"]
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          actual_value?: number | null
          audit_run_id?: string | null
          card_code?: string | null
          company_db?: string
          created_at?: string
          delta_value?: number | null
          description?: string
          divergence_type?: Database["public"]["Enums"]["audit_console_divergence_type"]
          expected_value?: number | null
          id?: string
          is_fraud_flag?: boolean
          is_reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          severity?: Database["public"]["Enums"]["audit_console_severity"]
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_console_divergences_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "audit_console_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_console_documents: {
        Row: {
          audit_run_id: string | null
          company_db: string
          created_at: string
          divergences_created: number
          doc_type: string
          error_message: string | null
          extracted: Json
          id: string
          mime_type: string | null
          original_filename: string | null
          status: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          audit_run_id?: string | null
          company_db: string
          created_at?: string
          divergences_created?: number
          doc_type: string
          error_message?: string | null
          extracted?: Json
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          audit_run_id?: string | null
          company_db?: string
          created_at?: string
          divergences_created?: number
          doc_type?: string
          error_message?: string | null
          extracted?: Json
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_console_documents_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "audit_console_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_console_insights: {
        Row: {
          audit_run_id: string | null
          body: string | null
          category: string | null
          company_db: string
          created_at: string
          headline: string
          id: string
          metadata: Json
          severity: Database["public"]["Enums"]["audit_console_severity"]
        }
        Insert: {
          audit_run_id?: string | null
          body?: string | null
          category?: string | null
          company_db: string
          created_at?: string
          headline: string
          id?: string
          metadata?: Json
          severity?: Database["public"]["Enums"]["audit_console_severity"]
        }
        Update: {
          audit_run_id?: string | null
          body?: string | null
          category?: string | null
          company_db?: string
          created_at?: string
          headline?: string
          id?: string
          metadata?: Json
          severity?: Database["public"]["Enums"]["audit_console_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "audit_console_insights_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "audit_console_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_console_logs: {
        Row: {
          audit_run_id: string | null
          company_db: string
          context: Json
          created_at: string
          id: string
          level: string
          message: string
        }
        Insert: {
          audit_run_id?: string | null
          company_db: string
          context?: Json
          created_at?: string
          id?: string
          level?: string
          message: string
        }
        Update: {
          audit_run_id?: string | null
          company_db?: string
          context?: Json
          created_at?: string
          id?: string
          level?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_console_logs_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "audit_console_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_console_rules: {
        Row: {
          company_db: string | null
          config: Json
          created_at: string
          default_severity: Database["public"]["Enums"]["audit_console_severity"]
          divergence_type: Database["public"]["Enums"]["audit_console_divergence_type"]
          id: string
          is_active: boolean
          name: string
          tolerance: number | null
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          config?: Json
          created_at?: string
          default_severity?: Database["public"]["Enums"]["audit_console_severity"]
          divergence_type: Database["public"]["Enums"]["audit_console_divergence_type"]
          id?: string
          is_active?: boolean
          name: string
          tolerance?: number | null
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          config?: Json
          created_at?: string
          default_severity?: Database["public"]["Enums"]["audit_console_severity"]
          divergence_type?: Database["public"]["Enums"]["audit_console_divergence_type"]
          id?: string
          is_active?: boolean
          name?: string
          tolerance?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_console_runs: {
        Row: {
          company_db: string
          created_at: string
          current_step: string | null
          date_from: string | null
          date_to: string | null
          error_message: string | null
          fetch_warnings: Json
          finished_at: string | null
          id: string
          progress_pct: number
          scope: string | null
          started_at: string
          status: Database["public"]["Enums"]["audit_console_run_status"]
          total_divergences: number
          total_docs_analyzed: number
          total_fraud_flags: number
          triggered_by: string | null
        }
        Insert: {
          company_db: string
          created_at?: string
          current_step?: string | null
          date_from?: string | null
          date_to?: string | null
          error_message?: string | null
          fetch_warnings?: Json
          finished_at?: string | null
          id?: string
          progress_pct?: number
          scope?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["audit_console_run_status"]
          total_divergences?: number
          total_docs_analyzed?: number
          total_fraud_flags?: number
          triggered_by?: string | null
        }
        Update: {
          company_db?: string
          created_at?: string
          current_step?: string | null
          date_from?: string | null
          date_to?: string | null
          error_message?: string | null
          fetch_warnings?: Json
          finished_at?: string | null
          id?: string
          progress_pct?: number
          scope?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["audit_console_run_status"]
          total_divergences?: number
          total_docs_analyzed?: number
          total_fraud_flags?: number
          triggered_by?: string | null
        }
        Relationships: []
      }
      audit_console_workflow_runs: {
        Row: {
          audit_run_id: string | null
          company_db: string
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          output: Json | null
          started_at: string | null
          status: string
          step_id: string | null
        }
        Insert: {
          audit_run_id?: string | null
          company_db: string
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          output?: Json | null
          started_at?: string | null
          status?: string
          step_id?: string | null
        }
        Update: {
          audit_run_id?: string | null
          company_db?: string
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          output?: Json | null
          started_at?: string | null
          status?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_console_workflow_runs_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "audit_console_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_console_workflow_runs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "audit_console_workflow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_console_workflow_steps: {
        Row: {
          company_db: string | null
          config: Json
          created_at: string
          handler: string
          id: string
          is_active: boolean
          name: string
          step_order: number
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          config?: Json
          created_at?: string
          handler: string
          id?: string
          is_active?: boolean
          name: string
          step_order?: number
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          config?: Json
          created_at?: string
          handler?: string
          id?: string
          is_active?: boolean
          name?: string
          step_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          company_db: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          company_db?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          company_db?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      audit_pay_config: {
        Row: {
          approval_thresholds: Json
          bank_change_window_days: number
          company_db: string
          created_at: string
          enabled: boolean
          fornecedor_risco: Json
          run_agent_on: Database["public"]["Enums"]["audit_pay_agent_mode"]
          tolerance_pct_baixa: number
          tolerance_pct_media: number
          updated_at: string
        }
        Insert: {
          approval_thresholds?: Json
          bank_change_window_days?: number
          company_db: string
          created_at?: string
          enabled?: boolean
          fornecedor_risco?: Json
          run_agent_on?: Database["public"]["Enums"]["audit_pay_agent_mode"]
          tolerance_pct_baixa?: number
          tolerance_pct_media?: number
          updated_at?: string
        }
        Update: {
          approval_thresholds?: Json
          bank_change_window_days?: number
          company_db?: string
          created_at?: string
          enabled?: boolean
          fornecedor_risco?: Json
          run_agent_on?: Database["public"]["Enums"]["audit_pay_agent_mode"]
          tolerance_pct_baixa?: number
          tolerance_pct_media?: number
          updated_at?: string
        }
        Relationships: []
      }
      audit_pay_finding: {
        Row: {
          audit_result_id: string
          company_db: string
          created_at: string
          delta: number | null
          explanation: string | null
          field_name: string | null
          finding_type: Database["public"]["Enums"]["audit_pay_finding_type"]
          id: string
          severity: Database["public"]["Enums"]["audit_pay_severity"]
          value_after: Json | null
          value_before: Json | null
        }
        Insert: {
          audit_result_id: string
          company_db: string
          created_at?: string
          delta?: number | null
          explanation?: string | null
          field_name?: string | null
          finding_type: Database["public"]["Enums"]["audit_pay_finding_type"]
          id?: string
          severity?: Database["public"]["Enums"]["audit_pay_severity"]
          value_after?: Json | null
          value_before?: Json | null
        }
        Update: {
          audit_result_id?: string
          company_db?: string
          created_at?: string
          delta?: number | null
          explanation?: string | null
          field_name?: string | null
          finding_type?: Database["public"]["Enums"]["audit_pay_finding_type"]
          id?: string
          severity?: Database["public"]["Enums"]["audit_pay_severity"]
          value_after?: Json | null
          value_before?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_pay_finding_audit_result_id_fkey"
            columns: ["audit_result_id"]
            isOneToOne: false
            referencedRelation: "audit_pay_result"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_pay_fraud_signal: {
        Row: {
          company_db: string
          confidence: number
          created_at: string
          detected_at: string
          entity_ref: string
          entity_type: Database["public"]["Enums"]["audit_pay_entity_type"]
          id: string
          narrative: string | null
          period_end: string | null
          period_start: string | null
          related_audit_result_ids: string[]
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["audit_pay_severity"]
          signal_type: Database["public"]["Enums"]["audit_pay_signal_type"]
          status: Database["public"]["Enums"]["audit_pay_signal_status"]
          updated_at: string
        }
        Insert: {
          company_db: string
          confidence?: number
          created_at?: string
          detected_at?: string
          entity_ref: string
          entity_type: Database["public"]["Enums"]["audit_pay_entity_type"]
          id?: string
          narrative?: string | null
          period_end?: string | null
          period_start?: string | null
          related_audit_result_ids?: string[]
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["audit_pay_severity"]
          signal_type: Database["public"]["Enums"]["audit_pay_signal_type"]
          status?: Database["public"]["Enums"]["audit_pay_signal_status"]
          updated_at?: string
        }
        Update: {
          company_db?: string
          confidence?: number
          created_at?: string
          detected_at?: string
          entity_ref?: string
          entity_type?: Database["public"]["Enums"]["audit_pay_entity_type"]
          id?: string
          narrative?: string | null
          period_end?: string | null
          period_start?: string | null
          related_audit_result_ids?: string[]
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["audit_pay_severity"]
          signal_type?: Database["public"]["Enums"]["audit_pay_signal_type"]
          status?: Database["public"]["Enums"]["audit_pay_signal_status"]
          updated_at?: string
        }
        Relationships: []
      }
      audit_pay_queue: {
        Row: {
          attempts: number
          baseline_source: Database["public"]["Enums"]["audit_pay_baseline_source"]
          company_db: string
          created_at: string
          document_ref: string
          document_type: Database["public"]["Enums"]["audit_pay_doc_type"]
          enqueued_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          priority: number
          started_at: string | null
          status: Database["public"]["Enums"]["audit_pay_queue_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          baseline_source?: Database["public"]["Enums"]["audit_pay_baseline_source"]
          company_db: string
          created_at?: string
          document_ref: string
          document_type?: Database["public"]["Enums"]["audit_pay_doc_type"]
          enqueued_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          priority?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["audit_pay_queue_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          baseline_source?: Database["public"]["Enums"]["audit_pay_baseline_source"]
          company_db?: string
          created_at?: string
          document_ref?: string
          document_type?: Database["public"]["Enums"]["audit_pay_doc_type"]
          enqueued_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          priority?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["audit_pay_queue_status"]
          updated_at?: string
        }
        Relationships: []
      }
      audit_pay_result: {
        Row: {
          audited_at: string
          baseline_snapshot: Json
          baseline_source: Database["public"]["Enums"]["audit_pay_baseline_source"]
          centro_custo: string | null
          company_db: string
          created_at: string
          desvio_valor_abs: number | null
          desvio_valor_pct: number | null
          document_ref: string
          document_type: Database["public"]["Enums"]["audit_pay_doc_type"]
          fornecedor_code: string | null
          fornecedor_name: string | null
          has_findings: boolean
          id: string
          overall_severity: Database["public"]["Enums"]["audit_pay_severity"]
          projeto: string | null
          queue_id: string | null
          risk_score: number
          settlement_snapshot: Json
          solicitante: string | null
          updated_at: string
          valor_baseline: number | null
          valor_pago: number | null
        }
        Insert: {
          audited_at?: string
          baseline_snapshot?: Json
          baseline_source?: Database["public"]["Enums"]["audit_pay_baseline_source"]
          centro_custo?: string | null
          company_db: string
          created_at?: string
          desvio_valor_abs?: number | null
          desvio_valor_pct?: number | null
          document_ref: string
          document_type: Database["public"]["Enums"]["audit_pay_doc_type"]
          fornecedor_code?: string | null
          fornecedor_name?: string | null
          has_findings?: boolean
          id?: string
          overall_severity?: Database["public"]["Enums"]["audit_pay_severity"]
          projeto?: string | null
          queue_id?: string | null
          risk_score?: number
          settlement_snapshot?: Json
          solicitante?: string | null
          updated_at?: string
          valor_baseline?: number | null
          valor_pago?: number | null
        }
        Update: {
          audited_at?: string
          baseline_snapshot?: Json
          baseline_source?: Database["public"]["Enums"]["audit_pay_baseline_source"]
          centro_custo?: string | null
          company_db?: string
          created_at?: string
          desvio_valor_abs?: number | null
          desvio_valor_pct?: number | null
          document_ref?: string
          document_type?: Database["public"]["Enums"]["audit_pay_doc_type"]
          fornecedor_code?: string | null
          fornecedor_name?: string | null
          has_findings?: boolean
          id?: string
          overall_severity?: Database["public"]["Enums"]["audit_pay_severity"]
          projeto?: string | null
          queue_id?: string | null
          risk_score?: number
          settlement_snapshot?: Json
          solicitante?: string | null
          updated_at?: string
          valor_baseline?: number | null
          valor_pago?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_pay_result_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "audit_pay_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_trail: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          actor_role: string | null
          app_context: Json | null
          changed_cols: string[] | null
          id: number
          new_data: Json | null
          old_data: Json | null
          op: string
          prev_hash: string | null
          row_hash: string
          row_pk: Json | null
          schema_name: string
          session_jwt_sub: string | null
          table_name: string
          ts: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          app_context?: Json | null
          changed_cols?: string[] | null
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          op: string
          prev_hash?: string | null
          row_hash: string
          row_pk?: Json | null
          schema_name: string
          session_jwt_sub?: string | null
          table_name: string
          ts?: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          app_context?: Json | null
          changed_cols?: string[] | null
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          op?: string
          prev_hash?: string | null
          row_hash?: string
          row_pk?: Json | null
          schema_name?: string
          session_jwt_sub?: string | null
          table_name?: string
          ts?: string
        }
        Relationships: []
      }
      audit_trail_archive: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          actor_role: string | null
          app_context: Json | null
          archived_at: string
          changed_cols: string[] | null
          id: number
          new_data: Json | null
          old_data: Json | null
          op: string
          prev_hash: string | null
          row_hash: string | null
          row_pk: Json | null
          schema_name: string
          session_jwt_sub: string | null
          table_name: string
          ts: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          app_context?: Json | null
          archived_at?: string
          changed_cols?: string[] | null
          id: number
          new_data?: Json | null
          old_data?: Json | null
          op: string
          prev_hash?: string | null
          row_hash?: string | null
          row_pk?: Json | null
          schema_name: string
          session_jwt_sub?: string | null
          table_name: string
          ts: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          app_context?: Json | null
          archived_at?: string
          changed_cols?: string[] | null
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          op?: string
          prev_hash?: string | null
          row_hash?: string | null
          row_pk?: Json | null
          schema_name?: string
          session_jwt_sub?: string | null
          table_name?: string
          ts?: string
        }
        Relationships: []
      }
      auditoria_cruzamento_config: {
        Row: {
          auto_conciliar: boolean
          auto_exigir_lancamento_erp: boolean
          auto_score_min: number
          empresa_id: string
          janela_dias: number
          source_company_dbs: string[]
          tolerancia_valor_abs: number
          tolerancia_valor_pct: number
          updated_at: string
          updated_by: string | null
          usar_raiz_cnpj_fallback: boolean
        }
        Insert: {
          auto_conciliar?: boolean
          auto_exigir_lancamento_erp?: boolean
          auto_score_min?: number
          empresa_id: string
          janela_dias?: number
          source_company_dbs?: string[]
          tolerancia_valor_abs?: number
          tolerancia_valor_pct?: number
          updated_at?: string
          updated_by?: string | null
          usar_raiz_cnpj_fallback?: boolean
        }
        Update: {
          auto_conciliar?: boolean
          auto_exigir_lancamento_erp?: boolean
          auto_score_min?: number
          empresa_id?: string
          janela_dias?: number
          source_company_dbs?: string[]
          tolerancia_valor_abs?: number
          tolerancia_valor_pct?: number
          updated_at?: string
          updated_by?: string | null
          usar_raiz_cnpj_fallback?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_cruzamento_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      auditoria_cruzamento_fiscal: {
        Row: {
          atualizado_em: string
          auto_conciliado: boolean
          auto_conciliado_em: string | null
          auto_regra: string | null
          candidatos_ambiguos: Json | null
          cenario: string
          cnpj_fornecedor: string
          company_db: string
          conta_paga_data_baixa: string | null
          conta_paga_forma_pagamento: string | null
          conta_paga_id_externo: string | null
          conta_paga_link_origem: string | null
          conta_paga_valor: number | null
          criado_em: string
          diferenca_dias: number | null
          diferenca_valor: number | null
          empresa_id: string
          erp_origem: string | null
          id: string
          lancamento_erp_id: string | null
          lancamento_erp_status: string | null
          nota_chave_acesso: string | null
          nota_data_emissao: string | null
          nota_mastertax_id: string | null
          nota_numero: string | null
          nota_valor: number | null
          observacao_usuario: string | null
          periodo_fim: string
          periodo_inicio: string
          razao_social_fornecedor: string | null
          revisado_em: string | null
          revisado_por: string | null
          score_confianca: number | null
          status_match: string
        }
        Insert: {
          atualizado_em?: string
          auto_conciliado?: boolean
          auto_conciliado_em?: string | null
          auto_regra?: string | null
          candidatos_ambiguos?: Json | null
          cenario: string
          cnpj_fornecedor: string
          company_db: string
          conta_paga_data_baixa?: string | null
          conta_paga_forma_pagamento?: string | null
          conta_paga_id_externo?: string | null
          conta_paga_link_origem?: string | null
          conta_paga_valor?: number | null
          criado_em?: string
          diferenca_dias?: number | null
          diferenca_valor?: number | null
          empresa_id: string
          erp_origem?: string | null
          id?: string
          lancamento_erp_id?: string | null
          lancamento_erp_status?: string | null
          nota_chave_acesso?: string | null
          nota_data_emissao?: string | null
          nota_mastertax_id?: string | null
          nota_numero?: string | null
          nota_valor?: number | null
          observacao_usuario?: string | null
          periodo_fim: string
          periodo_inicio: string
          razao_social_fornecedor?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          score_confianca?: number | null
          status_match?: string
        }
        Update: {
          atualizado_em?: string
          auto_conciliado?: boolean
          auto_conciliado_em?: string | null
          auto_regra?: string | null
          candidatos_ambiguos?: Json | null
          cenario?: string
          cnpj_fornecedor?: string
          company_db?: string
          conta_paga_data_baixa?: string | null
          conta_paga_forma_pagamento?: string | null
          conta_paga_id_externo?: string | null
          conta_paga_link_origem?: string | null
          conta_paga_valor?: number | null
          criado_em?: string
          diferenca_dias?: number | null
          diferenca_valor?: number | null
          empresa_id?: string
          erp_origem?: string | null
          id?: string
          lancamento_erp_id?: string | null
          lancamento_erp_status?: string | null
          nota_chave_acesso?: string | null
          nota_data_emissao?: string | null
          nota_mastertax_id?: string | null
          nota_numero?: string | null
          nota_valor?: number | null
          observacao_usuario?: string | null
          periodo_fim?: string
          periodo_inicio?: string
          razao_social_fornecedor?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          score_confianca?: number | null
          status_match?: string
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_cruzamento_fiscal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auditoria_cruzamento_fiscal_nota_mastertax_id_fkey"
            columns: ["nota_mastertax_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_caller_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          payload: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          payload: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          payload?: Json
        }
        Relationships: []
      }
      baixas_recebimento: {
        Row: {
          card_code: string
          card_name: string | null
          company_db: string
          conta_contabil_codigo: string
          conta_contabil_nome: string | null
          conta_juros_multa_codigo: string | null
          conta_juros_multa_nome: string | null
          created_at: string
          criado_por: string | null
          criado_por_nome: string | null
          criado_por_user_code: string | null
          data_recebimento: string
          id: string
          sap_error_message: string | null
          sap_incoming_payment_doc_entry: number | null
          status: string
          updated_at: string
          valor_juros_multa: number
          valor_total: number
        }
        Insert: {
          card_code: string
          card_name?: string | null
          company_db: string
          conta_contabil_codigo: string
          conta_contabil_nome?: string | null
          conta_juros_multa_codigo?: string | null
          conta_juros_multa_nome?: string | null
          created_at?: string
          criado_por?: string | null
          criado_por_nome?: string | null
          criado_por_user_code?: string | null
          data_recebimento: string
          id?: string
          sap_error_message?: string | null
          sap_incoming_payment_doc_entry?: number | null
          status?: string
          updated_at?: string
          valor_juros_multa?: number
          valor_total: number
        }
        Update: {
          card_code?: string
          card_name?: string | null
          company_db?: string
          conta_contabil_codigo?: string
          conta_contabil_nome?: string | null
          conta_juros_multa_codigo?: string | null
          conta_juros_multa_nome?: string | null
          created_at?: string
          criado_por?: string | null
          criado_por_nome?: string | null
          criado_por_user_code?: string | null
          data_recebimento?: string
          id?: string
          sap_error_message?: string | null
          sap_incoming_payment_doc_entry?: number | null
          status?: string
          updated_at?: string
          valor_juros_multa?: number
          valor_total?: number
        }
        Relationships: []
      }
      baixas_recebimento_itens: {
        Row: {
          baixa_id: string
          created_at: string
          id: string
          invoice_doc_entry: number
          invoice_doc_line: number | null
          invoice_doc_num: string | null
          invoice_type: string
          valor_baixado: number
        }
        Insert: {
          baixa_id: string
          created_at?: string
          id?: string
          invoice_doc_entry: number
          invoice_doc_line?: number | null
          invoice_doc_num?: string | null
          invoice_type?: string
          valor_baixado: number
        }
        Update: {
          baixa_id?: string
          created_at?: string
          id?: string
          invoice_doc_entry?: number
          invoice_doc_line?: number | null
          invoice_doc_num?: string | null
          invoice_type?: string
          valor_baixado?: number
        }
        Relationships: [
          {
            foreignKeyName: "baixas_recebimento_itens_baixa_id_fkey"
            columns: ["baixa_id"]
            isOneToOne: false
            referencedRelation: "baixas_recebimento"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_project_alerts: {
        Row: {
          company_db: string | null
          context: Json
          cost_center_code: string
          cost_center_name: string | null
          created_at: string
          decision: string
          final_project_code: string | null
          id: string
          is_institutional_project: boolean
          line_index: number | null
          project_code_at_alert: string | null
          project_name_at_alert: string | null
          sap_user_name: string | null
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          company_db?: string | null
          context?: Json
          cost_center_code: string
          cost_center_name?: string | null
          created_at?: string
          decision?: string
          final_project_code?: string | null
          id?: string
          is_institutional_project?: boolean
          line_index?: number | null
          project_code_at_alert?: string | null
          project_name_at_alert?: string | null
          sap_user_name?: string | null
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Update: {
          company_db?: string | null
          context?: Json
          cost_center_code?: string
          cost_center_name?: string | null
          created_at?: string
          decision?: string
          final_project_code?: string | null
          id?: string
          is_institutional_project?: boolean
          line_index?: number | null
          project_code_at_alert?: string | null
          project_name_at_alert?: string | null
          sap_user_name?: string | null
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      collaborator_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          dismissed_until: string | null
          display_name: string | null
          email: string | null
          notify_email_approvals: boolean
          notify_email_overdue: boolean
          notify_whatsapp_approvals: boolean
          notify_whatsapp_overdue: boolean
          phone: string | null
          sap_synced_at: string | null
          updated_at: string
          user_code: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          dismissed_until?: string | null
          display_name?: string | null
          email?: string | null
          notify_email_approvals?: boolean
          notify_email_overdue?: boolean
          notify_whatsapp_approvals?: boolean
          notify_whatsapp_overdue?: boolean
          phone?: string | null
          sap_synced_at?: string | null
          updated_at?: string
          user_code: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          dismissed_until?: string | null
          display_name?: string | null
          email?: string | null
          notify_email_approvals?: boolean
          notify_email_overdue?: boolean
          notify_whatsapp_approvals?: boolean
          notify_whatsapp_overdue?: boolean
          phone?: string | null
          sap_synced_at?: string | null
          updated_at?: string
          user_code?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          company_db: string
          created_at: string
          default_currency: string
          display_name: string
          erp_type: string
          foreign_name: string | null
          id: string
          is_active: boolean
          is_foreign: boolean
          is_test: boolean
          legal_name: string | null
          logo_url: string | null
          service_layer_url: string | null
          targets: Json
          tax_id: string | null
          timezone: string
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          default_currency?: string
          display_name: string
          erp_type?: string
          foreign_name?: string | null
          id?: string
          is_active?: boolean
          is_foreign?: boolean
          is_test?: boolean
          legal_name?: string | null
          logo_url?: string | null
          service_layer_url?: string | null
          targets?: Json
          tax_id?: string | null
          timezone?: string
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          default_currency?: string
          display_name?: string
          erp_type?: string
          foreign_name?: string | null
          id?: string
          is_active?: boolean
          is_foreign?: boolean
          is_test?: boolean
          legal_name?: string | null
          logo_url?: string | null
          service_layer_url?: string | null
          targets?: Json
          tax_id?: string | null
          timezone?: string
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_center_redirects: {
        Row: {
          company_db: string
          created_at: string
          from_cost_center: string
          id: string
          is_active: boolean
          reason: string | null
          to_cost_center: string
          to_project: string | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          from_cost_center: string
          id?: string
          is_active?: boolean
          reason?: string | null
          to_cost_center: string
          to_project?: string | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          from_cost_center?: string
          id?: string
          is_active?: boolean
          reason?: string | null
          to_cost_center?: string
          to_project?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      db_query_metrics: {
        Row: {
          company_db: string | null
          duration_ms: number
          id: number
          ok: boolean
          operation: string
          row_count: number | null
          screen: string
          source: string
          started_at: string
          status_code: number | null
          target: string
          user_id: string | null
        }
        Insert: {
          company_db?: string | null
          duration_ms: number
          id?: number
          ok?: boolean
          operation?: string
          row_count?: number | null
          screen: string
          source?: string
          started_at?: string
          status_code?: number | null
          target: string
          user_id?: string | null
        }
        Update: {
          company_db?: string | null
          duration_ms?: number
          id?: number
          ok?: boolean
          operation?: string
          row_count?: number | null
          screen?: string
          source?: string
          started_at?: string
          status_code?: number | null
          target?: string
          user_id?: string | null
        }
        Relationships: []
      }
      document_drafts: {
        Row: {
          company_db: string
          created_at: string
          doc_type: string
          expires_at: string
          id: string
          payload: Json
          preview: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_db: string
          created_at?: string
          doc_type: string
          expires_at?: string
          id?: string
          payload?: Json
          preview?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_db?: string
          created_at?: string
          doc_type?: string
          expires_at?: string
          id?: string
          payload?: Json
          preview?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      edge_function_metrics: {
        Row: {
          company_db: string | null
          duration_ms: number
          error_code: string | null
          function_name: string
          id: number
          meta: Json | null
          ok: boolean
          started_at: string
          status_code: number | null
        }
        Insert: {
          company_db?: string | null
          duration_ms: number
          error_code?: string | null
          function_name: string
          id?: number
          meta?: Json | null
          ok?: boolean
          started_at?: string
          status_code?: number | null
        }
        Update: {
          company_db?: string | null
          duration_ms?: number
          error_code?: string | null
          function_name?: string
          id?: number
          meta?: Json | null
          ok?: boolean
          started_at?: string
          status_code?: number | null
        }
        Relationships: []
      }
      edge_metrics_alerts: {
        Row: {
          created_at: string
          error_rate: number | null
          errors: number | null
          function_name: string
          id: string
          kind: string
          message: string | null
          ok: boolean | null
          p95_ms: number | null
          response: string | null
          sent_to: string | null
          total: number | null
          window_bucket: string
        }
        Insert: {
          created_at?: string
          error_rate?: number | null
          errors?: number | null
          function_name: string
          id?: string
          kind: string
          message?: string | null
          ok?: boolean | null
          p95_ms?: number | null
          response?: string | null
          sent_to?: string | null
          total?: number | null
          window_bucket: string
        }
        Update: {
          created_at?: string
          error_rate?: number | null
          errors?: number | null
          function_name?: string
          id?: string
          kind?: string
          message?: string | null
          ok?: boolean | null
          p95_ms?: number | null
          response?: string | null
          sent_to?: string | null
          total?: number | null
          window_bucket?: string
        }
        Relationships: []
      }
      edge_rate_limits: {
        Row: {
          count: number
          key: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          count?: number
          key: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          count?: number
          key?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      employee_department_mapping: {
        Row: {
          created_at: string
          id: string
          integration_config_id: string
          jumpcloud_department: string
          sap_department_code: string | null
          sap_department_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          integration_config_id: string
          jumpcloud_department: string
          sap_department_code?: string | null
          sap_department_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          integration_config_id?: string
          jumpcloud_department?: string
          sap_department_code?: string | null
          sap_department_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_department_mapping_integration_config_id_fkey"
            columns: ["integration_config_id"]
            isOneToOne: false
            referencedRelation: "employee_integration_config"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_integration_config: {
        Row: {
          company_db: string
          created_at: string
          created_by: string | null
          default_branch_code: string | null
          default_department_code: string | null
          id: string
          is_active: boolean
          jumpcloud_organization_id: string | null
          last_execution_at: string | null
          last_execution_message: string | null
          last_execution_status: string | null
          name: string
          preferred_hour: number | null
          schedule_type: string
          sync_inactive_users: boolean
          sync_managers: boolean
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          created_by?: string | null
          default_branch_code?: string | null
          default_department_code?: string | null
          id?: string
          is_active?: boolean
          jumpcloud_organization_id?: string | null
          last_execution_at?: string | null
          last_execution_message?: string | null
          last_execution_status?: string | null
          name: string
          preferred_hour?: number | null
          schedule_type?: string
          sync_inactive_users?: boolean
          sync_managers?: boolean
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          created_by?: string | null
          default_branch_code?: string | null
          default_department_code?: string | null
          id?: string
          is_active?: boolean
          jumpcloud_organization_id?: string | null
          last_execution_at?: string | null
          last_execution_message?: string | null
          last_execution_status?: string | null
          name?: string
          preferred_hour?: number | null
          schedule_type?: string
          sync_inactive_users?: boolean
          sync_managers?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      employee_pending_relation: {
        Row: {
          created_at: string
          employee_jc_id: string
          id: string
          integration_config_id: string
          last_attempt_at: string | null
          manager_jc_id: string
          message: string | null
          resolved_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_jc_id: string
          id?: string
          integration_config_id: string
          last_attempt_at?: string | null
          manager_jc_id: string
          message?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_jc_id?: string
          id?: string
          integration_config_id?: string
          last_attempt_at?: string | null
          manager_jc_id?: string
          message?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_pending_relation_integration_config_id_fkey"
            columns: ["integration_config_id"]
            isOneToOne: false
            referencedRelation: "employee_integration_config"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_sync_execution: {
        Row: {
          company_db: string
          created_at: string
          duration_ms: number | null
          error_message: string | null
          execution_type: string
          finished_at: string | null
          id: string
          integration_config_id: string
          started_at: string
          status: string
          total_created: number
          total_errors: number
          total_inactivated: number
          total_matched: number
          total_pending: number
          total_source: number
          total_unchanged: number
          total_updated: number
          triggered_by: string | null
          triggered_by_email: string | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          execution_type: string
          finished_at?: string | null
          id?: string
          integration_config_id: string
          started_at?: string
          status?: string
          total_created?: number
          total_errors?: number
          total_inactivated?: number
          total_matched?: number
          total_pending?: number
          total_source?: number
          total_unchanged?: number
          total_updated?: number
          triggered_by?: string | null
          triggered_by_email?: string | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          execution_type?: string
          finished_at?: string | null
          id?: string
          integration_config_id?: string
          started_at?: string
          status?: string
          total_created?: number
          total_errors?: number
          total_inactivated?: number
          total_matched?: number
          total_pending?: number
          total_source?: number
          total_unchanged?: number
          total_updated?: number
          triggered_by?: string | null
          triggered_by_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_sync_execution_integration_config_id_fkey"
            columns: ["integration_config_id"]
            isOneToOne: false
            referencedRelation: "employee_integration_config"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_sync_item: {
        Row: {
          changed_fields: Json
          company_db: string
          created_at: string
          department_source: string | null
          department_target: string | null
          employee_email: string | null
          employee_name: string | null
          error_code: string | null
          execution_id: string
          hash: string | null
          id: string
          integration_config_id: string
          jumpcloud_user_id: string | null
          manager_jc_id: string | null
          message: string | null
          normalized_payload: Json | null
          result: string
          sap_employee_id: number | null
          sap_payload: Json | null
          source_payload: Json | null
        }
        Insert: {
          changed_fields?: Json
          company_db: string
          created_at?: string
          department_source?: string | null
          department_target?: string | null
          employee_email?: string | null
          employee_name?: string | null
          error_code?: string | null
          execution_id: string
          hash?: string | null
          id?: string
          integration_config_id: string
          jumpcloud_user_id?: string | null
          manager_jc_id?: string | null
          message?: string | null
          normalized_payload?: Json | null
          result: string
          sap_employee_id?: number | null
          sap_payload?: Json | null
          source_payload?: Json | null
        }
        Update: {
          changed_fields?: Json
          company_db?: string
          created_at?: string
          department_source?: string | null
          department_target?: string | null
          employee_email?: string | null
          employee_name?: string | null
          error_code?: string | null
          execution_id?: string
          hash?: string | null
          id?: string
          integration_config_id?: string
          jumpcloud_user_id?: string | null
          manager_jc_id?: string | null
          message?: string | null
          normalized_payload?: Json | null
          result?: string
          sap_employee_id?: number | null
          sap_payload?: Json | null
          source_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_sync_item_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "employee_sync_execution"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_sync_item_integration_config_id_fkey"
            columns: ["integration_config_id"]
            isOneToOne: false
            referencedRelation: "employee_integration_config"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_kyp_config: {
        Row: {
          ativo: boolean
          company_id: string
          config: Json
          kyp_provider_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          company_id: string
          config?: Json
          kyp_provider_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          company_id?: string
          config?: Json
          kyp_provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_kyp_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_kyp_config_kyp_provider_id_fkey"
            columns: ["kyp_provider_id"]
            isOneToOne: false
            referencedRelation: "kyp_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      enabled_erp_types: {
        Row: {
          created_at: string
          erp_type: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          erp_type: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          erp_type?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      erp_session_revocations: {
        Row: {
          company_db: string | null
          reason: string | null
          revoked_at: string
          sid_hash: string
          user_key: string
        }
        Insert: {
          company_db?: string | null
          reason?: string | null
          revoked_at?: string
          sid_hash: string
          user_key: string
        }
        Update: {
          company_db?: string | null
          reason?: string | null
          revoked_at?: string
          sid_hash?: string
          user_key?: string
        }
        Relationships: []
      }
      expense_action_idempotency: {
        Row: {
          action: string
          completed_at: string | null
          created_at: string
          expense_id: string
          idempotency_key: string
          response: Json | null
          status_code: number | null
        }
        Insert: {
          action: string
          completed_at?: string | null
          created_at?: string
          expense_id: string
          idempotency_key: string
          response?: Json | null
          status_code?: number | null
        }
        Update: {
          action?: string
          completed_at?: string | null
          created_at?: string
          expense_id?: string
          idempotency_key?: string
          response?: Json | null
          status_code?: number | null
        }
        Relationships: []
      }
      expense_approval_log: {
        Row: {
          action_role: string | null
          approver_email: string | null
          approver_name: string | null
          created_at: string
          decided_at: string
          decision: string
          expense_id: string
          id: string
          level_order: number | null
          remarks: string | null
          substituted_for_email: string | null
          substituted_for_name: string | null
          substitution_id: string | null
        }
        Insert: {
          action_role?: string | null
          approver_email?: string | null
          approver_name?: string | null
          created_at?: string
          decided_at?: string
          decision: string
          expense_id: string
          id?: string
          level_order?: number | null
          remarks?: string | null
          substituted_for_email?: string | null
          substituted_for_name?: string | null
          substitution_id?: string | null
        }
        Update: {
          action_role?: string | null
          approver_email?: string | null
          approver_name?: string | null
          created_at?: string
          decided_at?: string
          decision?: string
          expense_id?: string
          id?: string
          level_order?: number | null
          remarks?: string | null
          substituted_for_email?: string | null
          substituted_for_name?: string | null
          substitution_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_approval_log_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_approval_segments: {
        Row: {
          amount: number
          chain: Json
          cost_center: string | null
          created_at: string
          current_approver: string | null
          current_approver_email: string | null
          current_level: number
          decided_at: string | null
          decided_by: string | null
          expense_id: string
          fallback_branch: string | null
          fallback_from_rule_id: string | null
          fallback_from_rule_name: string | null
          id: string
          project: string | null
          resolution: string
          resolution_note: string | null
          rule_id: string | null
          rule_name: string | null
          segment_key: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          chain?: Json
          cost_center?: string | null
          created_at?: string
          current_approver?: string | null
          current_approver_email?: string | null
          current_level?: number
          decided_at?: string | null
          decided_by?: string | null
          expense_id: string
          fallback_branch?: string | null
          fallback_from_rule_id?: string | null
          fallback_from_rule_name?: string | null
          id?: string
          project?: string | null
          resolution?: string
          resolution_note?: string | null
          rule_id?: string | null
          rule_name?: string | null
          segment_key: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          chain?: Json
          cost_center?: string | null
          created_at?: string
          current_approver?: string | null
          current_approver_email?: string | null
          current_level?: number
          decided_at?: string | null
          decided_by?: string | null
          expense_id?: string
          fallback_branch?: string | null
          fallback_from_rule_id?: string | null
          fallback_from_rule_name?: string | null
          id?: string
          project?: string | null
          resolution?: string
          resolution_note?: string | null
          rule_id?: string | null
          rule_name?: string | null
          segment_key?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_approval_segments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_attachments: {
        Row: {
          created_at: string
          expense_id: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
        }
        Insert: {
          created_at?: string
          expense_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
        }
        Update: {
          created_at?: string
          expense_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_attachments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_audit_log: {
        Row: {
          action: string
          action_role: string | null
          actor_email: string | null
          actor_identity: string
          actor_source: string
          company_db: string | null
          created_at: string
          decision: string
          expense_id: string
          id: string
          idempotency_key: string | null
          ip_address: string | null
          is_cloud_admin: boolean
          is_sap_superuser: boolean
          level_order: number | null
          override_used: boolean
          reason: string | null
          remarks: string | null
          request_id: string | null
          substituted_for_email: string | null
          substituted_for_name: string | null
          substitution_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          action_role?: string | null
          actor_email?: string | null
          actor_identity: string
          actor_source: string
          company_db?: string | null
          created_at?: string
          decision: string
          expense_id: string
          id?: string
          idempotency_key?: string | null
          ip_address?: string | null
          is_cloud_admin?: boolean
          is_sap_superuser?: boolean
          level_order?: number | null
          override_used?: boolean
          reason?: string | null
          remarks?: string | null
          request_id?: string | null
          substituted_for_email?: string | null
          substituted_for_name?: string | null
          substitution_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          action_role?: string | null
          actor_email?: string | null
          actor_identity?: string
          actor_source?: string
          company_db?: string | null
          created_at?: string
          decision?: string
          expense_id?: string
          id?: string
          idempotency_key?: string | null
          ip_address?: string | null
          is_cloud_admin?: boolean
          is_sap_superuser?: boolean
          level_order?: number | null
          override_used?: boolean
          reason?: string | null
          remarks?: string | null
          request_id?: string | null
          substituted_for_email?: string | null
          substituted_for_name?: string | null
          substitution_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_audit_log_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_create_idempotency: {
        Row: {
          caller_identity: string
          company_db: string | null
          completed_at: string | null
          created_at: string
          expense_id: string | null
          fingerprint: string
          idempotency_key: string
          response: Json | null
          status_code: number | null
        }
        Insert: {
          caller_identity: string
          company_db?: string | null
          completed_at?: string | null
          created_at?: string
          expense_id?: string | null
          fingerprint: string
          idempotency_key: string
          response?: Json | null
          status_code?: number | null
        }
        Update: {
          caller_identity?: string
          company_db?: string | null
          completed_at?: string | null
          created_at?: string
          expense_id?: string | null
          fingerprint?: string
          idempotency_key?: string
          response?: Json | null
          status_code?: number | null
        }
        Relationships: []
      }
      expense_items: {
        Row: {
          cost_center: string | null
          created_at: string
          description: string
          expense_id: string
          id: string
          item_code: string | null
          items_group_code: number | null
          items_group_name: string | null
          line_total: number
          project: string | null
          quantity: number
          unit_price: number
        }
        Insert: {
          cost_center?: string | null
          created_at?: string
          description: string
          expense_id: string
          id?: string
          item_code?: string | null
          items_group_code?: number | null
          items_group_name?: string | null
          line_total?: number
          project?: string | null
          quantity?: number
          unit_price?: number
        }
        Update: {
          cost_center?: string | null
          created_at?: string
          description?: string
          expense_id?: string
          id?: string
          item_code?: string | null
          items_group_code?: number | null
          items_group_name?: string | null
          line_total?: number
          project?: string | null
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_items_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_sap_sync_runs: {
        Row: {
          duration_ms: number | null
          error_count: number
          error_message: string | null
          errors: Json
          finished_at: string | null
          id: string
          processed_count: number
          results: Json
          skipped_count: number
          started_at: string
          status: string
          trigger: string
          updated_count: number
        }
        Insert: {
          duration_ms?: number | null
          error_count?: number
          error_message?: string | null
          errors?: Json
          finished_at?: string | null
          id?: string
          processed_count?: number
          results?: Json
          skipped_count?: number
          started_at?: string
          status?: string
          trigger?: string
          updated_count?: number
        }
        Update: {
          duration_ms?: number | null
          error_count?: number
          error_message?: string | null
          errors?: Json
          finished_at?: string | null
          id?: string
          processed_count?: number
          results?: Json
          skipped_count?: number
          started_at?: string
          status?: string
          trigger?: string
          updated_count?: number
        }
        Relationships: []
      }
      expenses: {
        Row: {
          approval_rule_id: string | null
          branch_id: number
          company_db: string
          cost_center: string | null
          created_at: string
          created_by_email: string | null
          currency: string
          current_approver: string | null
          current_level_order: number
          doc_date: string | null
          doc_type: string
          due_date: string | null
          id: string
          nfse_split_mode: string
          origin: string
          original_approver: string | null
          project: string | null
          rateio_type: string | null
          remarks: string | null
          requester_email: string | null
          requester_name: string
          sales_usage: string | null
          sap_attachment_entry: number | null
          sap_attachment_link_status: string | null
          sap_attachment_status: string | null
          sap_doc_entry: number | null
          sap_doc_num: number | null
          sap_integration_error: string | null
          sap_integration_last_attempt_at: string | null
          sap_integration_locked_at: string | null
          sap_purchase_order_status: string | null
          sap_status_last_check_at: string | null
          sap_sync_attempts: number
          sap_sync_next_retry_at: string | null
          sap_sync_state: string | null
          status: Database["public"]["Enums"]["expense_status"]
          supplier_code: string | null
          supplier_name: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          approval_rule_id?: string | null
          branch_id?: number
          company_db: string
          cost_center?: string | null
          created_at?: string
          created_by_email?: string | null
          currency?: string
          current_approver?: string | null
          current_level_order?: number
          doc_date?: string | null
          doc_type?: string
          due_date?: string | null
          id?: string
          nfse_split_mode?: string
          origin?: string
          original_approver?: string | null
          project?: string | null
          rateio_type?: string | null
          remarks?: string | null
          requester_email?: string | null
          requester_name: string
          sales_usage?: string | null
          sap_attachment_entry?: number | null
          sap_attachment_link_status?: string | null
          sap_attachment_status?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_integration_error?: string | null
          sap_integration_last_attempt_at?: string | null
          sap_integration_locked_at?: string | null
          sap_purchase_order_status?: string | null
          sap_status_last_check_at?: string | null
          sap_sync_attempts?: number
          sap_sync_next_retry_at?: string | null
          sap_sync_state?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          supplier_code?: string | null
          supplier_name: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approval_rule_id?: string | null
          branch_id?: number
          company_db?: string
          cost_center?: string | null
          created_at?: string
          created_by_email?: string | null
          currency?: string
          current_approver?: string | null
          current_level_order?: number
          doc_date?: string | null
          doc_type?: string
          due_date?: string | null
          id?: string
          nfse_split_mode?: string
          origin?: string
          original_approver?: string | null
          project?: string | null
          rateio_type?: string | null
          remarks?: string | null
          requester_email?: string | null
          requester_name?: string
          sales_usage?: string | null
          sap_attachment_entry?: number | null
          sap_attachment_link_status?: string | null
          sap_attachment_status?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_integration_error?: string | null
          sap_integration_last_attempt_at?: string | null
          sap_integration_locked_at?: string | null
          sap_purchase_order_status?: string | null
          sap_status_last_check_at?: string | null
          sap_sync_attempts?: number
          sap_sync_next_retry_at?: string | null
          sap_sync_state?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          supplier_code?: string | null
          supplier_name?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_approval_rule_id_fkey"
            columns: ["approval_rule_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      external_api_allowlist: {
        Row: {
          company_db: string
          created_at: string
          enabled: boolean
          failed_attempts: number
          id: string
          last_failure_at: string | null
          last_failure_reason: string | null
          locked_until: string | null
          notes: string | null
          updated_at: string
          user_code: string
        }
        Insert: {
          company_db: string
          created_at?: string
          enabled?: boolean
          failed_attempts?: number
          id?: string
          last_failure_at?: string | null
          last_failure_reason?: string | null
          locked_until?: string | null
          notes?: string | null
          updated_at?: string
          user_code: string
        }
        Update: {
          company_db?: string
          created_at?: string
          enabled?: boolean
          failed_attempts?: number
          id?: string
          last_failure_at?: string | null
          last_failure_reason?: string | null
          locked_until?: string | null
          notes?: string | null
          updated_at?: string
          user_code?: string
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          company_db: string | null
          description: string | null
          enabled: boolean
          key: string
          scope: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_db?: string | null
          description?: string | null
          enabled?: boolean
          key: string
          scope?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_db?: string | null
          description?: string | null
          enabled?: boolean
          key?: string
          scope?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          api_payload: Json | null
          bairro: string | null
          capital_social: number | null
          cep: string | null
          cnae_principal_codigo: string | null
          cnae_principal_descricao: string | null
          cnaes_secundarios: Json | null
          cnpj: string | null
          complemento: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          data_inicio_atividade: string | null
          email: string | null
          id: string
          inscricao_estadual: string | null
          logradouro: string | null
          municipio: string | null
          municipio_ibge: string | null
          natureza_juridica_descricao: string | null
          natureza_juridica_id: string | null
          nome_fantasia: string | null
          numero: string | null
          pais: string | null
          porte: string | null
          razao_social: string | null
          simples_nacional: boolean | null
          situacao_cadastral: string | null
          socios: Json | null
          telefone1: string | null
          telefone2: string | null
          tipo_estabelecimento: string | null
          tipo_pessoa: Database["public"]["Enums"]["fornecedor_tipo_pessoa"]
          uf: string | null
          updated_at: string
        }
        Insert: {
          api_payload?: Json | null
          bairro?: string | null
          capital_social?: number | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnaes_secundarios?: Json | null
          cnpj?: string | null
          complemento?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          data_inicio_atividade?: string | null
          email?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          municipio?: string | null
          municipio_ibge?: string | null
          natureza_juridica_descricao?: string | null
          natureza_juridica_id?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          pais?: string | null
          porte?: string | null
          razao_social?: string | null
          simples_nacional?: boolean | null
          situacao_cadastral?: string | null
          socios?: Json | null
          telefone1?: string | null
          telefone2?: string | null
          tipo_estabelecimento?: string | null
          tipo_pessoa: Database["public"]["Enums"]["fornecedor_tipo_pessoa"]
          uf?: string | null
          updated_at?: string
        }
        Update: {
          api_payload?: Json | null
          bairro?: string | null
          capital_social?: number | null
          cep?: string | null
          cnae_principal_codigo?: string | null
          cnae_principal_descricao?: string | null
          cnaes_secundarios?: Json | null
          cnpj?: string | null
          complemento?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          data_inicio_atividade?: string | null
          email?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          municipio?: string | null
          municipio_ibge?: string | null
          natureza_juridica_descricao?: string | null
          natureza_juridica_id?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          pais?: string | null
          porte?: string | null
          razao_social?: string | null
          simples_nacional?: boolean | null
          situacao_cadastral?: string | null
          socios?: Json | null
          telefone1?: string | null
          telefone2?: string | null
          tipo_estabelecimento?: string | null
          tipo_pessoa?: Database["public"]["Enums"]["fornecedor_tipo_pessoa"]
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gdrive_backup_settings: {
        Row: {
          created_at: string
          folder_id: string | null
          folder_name: string | null
          folder_path: string | null
          folder_url: string | null
          id: string
          last_snapshot: string | null
          run_error: string | null
          run_finished_at: string | null
          run_progress: string | null
          run_started_at: string | null
          run_status: string | null
          run_trigger: string | null
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          folder_id?: string | null
          folder_name?: string | null
          folder_path?: string | null
          folder_url?: string | null
          id?: string
          last_snapshot?: string | null
          run_error?: string | null
          run_finished_at?: string | null
          run_progress?: string | null
          run_started_at?: string | null
          run_status?: string | null
          run_trigger?: string | null
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          folder_id?: string | null
          folder_name?: string | null
          folder_path?: string | null
          folder_url?: string | null
          id?: string
          last_snapshot?: string | null
          run_error?: string | null
          run_finished_at?: string | null
          run_progress?: string | null
          run_started_at?: string | null
          run_status?: string | null
          run_trigger?: string | null
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      hana_health_probes: {
        Row: {
          base_url: string
          company_db: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          http_status: number | null
          id: string
          ok: boolean
          view_name: string | null
        }
        Insert: {
          base_url: string
          company_db?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          ok?: boolean
          view_name?: string | null
        }
        Update: {
          base_url?: string
          company_db?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          ok?: boolean
          view_name?: string | null
        }
        Relationships: []
      }
      idp_deprovision_log: {
        Row: {
          approval_rules_orphaned: number
          company_db: string | null
          cost_centers_revoked: number
          created_at: string
          credentials_revoked: number
          details: Json
          email: string | null
          errors: Json
          groups_revoked: number
          id: string
          idp_provider: string | null
          idp_user_id: string | null
          push_devices_revoked: number
          reason: string
          sap_locked: boolean
          sap_user_code: string | null
          source: string
          substitutions_revoked: number
          user_key: string | null
        }
        Insert: {
          approval_rules_orphaned?: number
          company_db?: string | null
          cost_centers_revoked?: number
          created_at?: string
          credentials_revoked?: number
          details?: Json
          email?: string | null
          errors?: Json
          groups_revoked?: number
          id?: string
          idp_provider?: string | null
          idp_user_id?: string | null
          push_devices_revoked?: number
          reason: string
          sap_locked?: boolean
          sap_user_code?: string | null
          source?: string
          substitutions_revoked?: number
          user_key?: string | null
        }
        Update: {
          approval_rules_orphaned?: number
          company_db?: string | null
          cost_centers_revoked?: number
          created_at?: string
          credentials_revoked?: number
          details?: Json
          email?: string | null
          errors?: Json
          groups_revoked?: number
          id?: string
          idp_provider?: string | null
          idp_user_id?: string | null
          push_devices_revoked?: number
          reason?: string
          sap_locked?: boolean
          sap_user_code?: string | null
          source?: string
          substitutions_revoked?: number
          user_key?: string | null
        }
        Relationships: []
      }
      idp_user_mapping: {
        Row: {
          attributes_synced_at: string | null
          company_name: string | null
          cost_center_code: string | null
          cost_center_label: string | null
          created_at: string
          department: string | null
          deprovision_reason: string | null
          deprovisioned_at: string | null
          employee_id: string | null
          employee_type: string | null
          id: string
          idp_display_name: string | null
          idp_email: string | null
          idp_provider: string
          idp_user_id: string | null
          job_title: string | null
          linked_at: string | null
          manager_idp_id: string | null
          sap_email: string | null
          sap_user_code: string
          sap_user_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attributes_synced_at?: string | null
          company_name?: string | null
          cost_center_code?: string | null
          cost_center_label?: string | null
          created_at?: string
          department?: string | null
          deprovision_reason?: string | null
          deprovisioned_at?: string | null
          employee_id?: string | null
          employee_type?: string | null
          id?: string
          idp_display_name?: string | null
          idp_email?: string | null
          idp_provider?: string
          idp_user_id?: string | null
          job_title?: string | null
          linked_at?: string | null
          manager_idp_id?: string | null
          sap_email?: string | null
          sap_user_code: string
          sap_user_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attributes_synced_at?: string | null
          company_name?: string | null
          cost_center_code?: string | null
          cost_center_label?: string | null
          created_at?: string
          department?: string | null
          deprovision_reason?: string | null
          deprovisioned_at?: string | null
          employee_id?: string | null
          employee_type?: string | null
          id?: string
          idp_display_name?: string | null
          idp_email?: string | null
          idp_provider?: string
          idp_user_id?: string | null
          job_title?: string | null
          linked_at?: string | null
          manager_idp_id?: string | null
          sap_email?: string | null
          sap_user_code?: string
          sap_user_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      infra_backup_log: {
        Row: {
          bucket: string | null
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          kind: string
          manifest: Json | null
          objects_count: number | null
          s3_prefix: string | null
          started_at: string
          status: string
          tables_count: number | null
          total_bytes: number | null
          trigger: string
          updated_at: string
        }
        Insert: {
          bucket?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          manifest?: Json | null
          objects_count?: number | null
          s3_prefix?: string | null
          started_at?: string
          status: string
          tables_count?: number | null
          total_bytes?: number | null
          trigger?: string
          updated_at?: string
        }
        Update: {
          bucket?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          manifest?: Json | null
          objects_count?: number | null
          s3_prefix?: string | null
          started_at?: string
          status?: string
          tables_count?: number | null
          total_bytes?: number | null
          trigger?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_health_alert_settings: {
        Row: {
          cooldown_minutes: number
          created_at: string
          enabled: boolean
          error_rate_threshold: number
          id: string
          min_samples: number
          notify_email: boolean
          notify_slack: boolean
          p95_threshold_ms: number
          provider: string
          recipient_emails: string[]
          slack_channel: string | null
          updated_at: string
          window_minutes: number
        }
        Insert: {
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          error_rate_threshold?: number
          id?: string
          min_samples?: number
          notify_email?: boolean
          notify_slack?: boolean
          p95_threshold_ms?: number
          provider: string
          recipient_emails?: string[]
          slack_channel?: string | null
          updated_at?: string
          window_minutes?: number
        }
        Update: {
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          error_rate_threshold?: number
          id?: string
          min_samples?: number
          notify_email?: boolean
          notify_slack?: boolean
          p95_threshold_ms?: number
          provider?: string
          recipient_emails?: string[]
          slack_channel?: string | null
          updated_at?: string
          window_minutes?: number
        }
        Relationships: []
      }
      integration_health_alerts: {
        Row: {
          channels: string[]
          created_at: string
          delivery_detail: string | null
          delivery_ok: boolean | null
          error_rate: number | null
          errors: number | null
          id: string
          kind: string
          message: string
          p95_ms: number | null
          provider: string
          severity: string
          total: number | null
          window_minutes: number | null
        }
        Insert: {
          channels?: string[]
          created_at?: string
          delivery_detail?: string | null
          delivery_ok?: boolean | null
          error_rate?: number | null
          errors?: number | null
          id?: string
          kind: string
          message: string
          p95_ms?: number | null
          provider: string
          severity?: string
          total?: number | null
          window_minutes?: number | null
        }
        Update: {
          channels?: string[]
          created_at?: string
          delivery_detail?: string | null
          delivery_ok?: boolean | null
          error_rate?: number | null
          errors?: number | null
          id?: string
          kind?: string
          message?: string
          p95_ms?: number | null
          provider?: string
          severity?: string
          total?: number | null
          window_minutes?: number | null
        }
        Relationships: []
      }
      integration_log: {
        Row: {
          action: string
          company_db: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          http_status: number | null
          id: string
          request_meta: Json | null
          response_meta: Json | null
          status: string
          system_name: string
        }
        Insert: {
          action: string
          company_db?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          request_meta?: Json | null
          response_meta?: Json | null
          status?: string
          system_name: string
        }
        Update: {
          action?: string
          company_db?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          request_meta?: Json | null
          response_meta?: Json | null
          status?: string
          system_name?: string
        }
        Relationships: []
      }
      integration_pause: {
        Row: {
          created_at: string
          created_by: string | null
          key: string
          paused_until: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          key: string
          paused_until: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          key?: string
          paused_until?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      item_base: {
        Row: {
          codigo_servico: string | null
          created_at: string
          created_by: string | null
          grupo: string | null
          id: string
          ncm: string | null
          tipo: Database["public"]["Enums"]["item_tipo"]
          unidade: string | null
          updated_at: string
        }
        Insert: {
          codigo_servico?: string | null
          created_at?: string
          created_by?: string | null
          grupo?: string | null
          id?: string
          ncm?: string | null
          tipo: Database["public"]["Enums"]["item_tipo"]
          unidade?: string | null
          updated_at?: string
        }
        Update: {
          codigo_servico?: string | null
          created_at?: string
          created_by?: string | null
          grupo?: string | null
          id?: string
          ncm?: string | null
          tipo?: Database["public"]["Enums"]["item_tipo"]
          unidade?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      item_variante: {
        Row: {
          codigo_completo: string
          created_at: string
          created_by: string | null
          descricao: string
          id: string
          item_base_id: string
          sequencial: number
          updated_at: string
        }
        Insert: {
          codigo_completo: string
          created_at?: string
          created_by?: string | null
          descricao: string
          id?: string
          item_base_id: string
          sequencial: number
          updated_at?: string
        }
        Update: {
          codigo_completo?: string
          created_at?: string
          created_by?: string | null
          descricao?: string
          id?: string
          item_base_id?: string
          sequencial?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_variante_item_base_id_fkey"
            columns: ["item_base_id"]
            isOneToOne: false
            referencedRelation: "item_base"
            referencedColumns: ["id"]
          },
        ]
      }
      kyp_avaliacoes: {
        Row: {
          acao: string
          disparado_por: string | null
          documento: string | null
          empresas_afetadas: string[]
          executado_em: string
          id: string
          kyp_fornecedor_id: string | null
          kyp_provider_id: string | null
          motivo: string | null
          nome: string | null
          provider_code: string | null
          provider_ref_id: string | null
          provider_response: Json | null
          sucesso: boolean
          tipo_pessoa: string | null
        }
        Insert: {
          acao: string
          disparado_por?: string | null
          documento?: string | null
          empresas_afetadas?: string[]
          executado_em?: string
          id?: string
          kyp_fornecedor_id?: string | null
          kyp_provider_id?: string | null
          motivo?: string | null
          nome?: string | null
          provider_code?: string | null
          provider_ref_id?: string | null
          provider_response?: Json | null
          sucesso?: boolean
          tipo_pessoa?: string | null
        }
        Update: {
          acao?: string
          disparado_por?: string | null
          documento?: string | null
          empresas_afetadas?: string[]
          executado_em?: string
          id?: string
          kyp_fornecedor_id?: string | null
          kyp_provider_id?: string | null
          motivo?: string | null
          nome?: string | null
          provider_code?: string | null
          provider_ref_id?: string | null
          provider_response?: Json | null
          sucesso?: boolean
          tipo_pessoa?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kyp_avaliacoes_kyp_fornecedor_id_fkey"
            columns: ["kyp_fornecedor_id"]
            isOneToOne: false
            referencedRelation: "kyp_fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kyp_avaliacoes_kyp_provider_id_fkey"
            columns: ["kyp_provider_id"]
            isOneToOne: false
            referencedRelation: "kyp_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      kyp_fornecedor_ocorrencias: {
        Row: {
          bloqueado_em: string | null
          codigo_fornecedor_erp: string
          company_db: string
          company_id: string | null
          created_at: string
          detalhes: Json
          erp: string
          id: string
          kyp_fornecedor_id: string
          nome_erp: string | null
          updated_at: string
        }
        Insert: {
          bloqueado_em?: string | null
          codigo_fornecedor_erp: string
          company_db: string
          company_id?: string | null
          created_at?: string
          detalhes?: Json
          erp: string
          id?: string
          kyp_fornecedor_id: string
          nome_erp?: string | null
          updated_at?: string
        }
        Update: {
          bloqueado_em?: string | null
          codigo_fornecedor_erp?: string
          company_db?: string
          company_id?: string | null
          created_at?: string
          detalhes?: Json
          erp?: string
          id?: string
          kyp_fornecedor_id?: string
          nome_erp?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyp_fornecedor_ocorrencias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kyp_fornecedor_ocorrencias_kyp_fornecedor_id_fkey"
            columns: ["kyp_fornecedor_id"]
            isOneToOne: false
            referencedRelation: "kyp_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      kyp_fornecedores: {
        Row: {
          created_at: string
          documento: string
          id: string
          kyp_provider_id: string | null
          nome: string | null
          provider_ref_id: string | null
          provider_status: string | null
          proxima_expiracao_em: string | null
          status_atual: string
          tipo_pessoa: string
          ultima_avaliacao_em: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          documento: string
          id?: string
          kyp_provider_id?: string | null
          nome?: string | null
          provider_ref_id?: string | null
          provider_status?: string | null
          proxima_expiracao_em?: string | null
          status_atual?: string
          tipo_pessoa: string
          ultima_avaliacao_em?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          documento?: string
          id?: string
          kyp_provider_id?: string | null
          nome?: string | null
          provider_ref_id?: string | null
          provider_status?: string | null
          proxima_expiracao_em?: string | null
          status_atual?: string
          tipo_pessoa?: string
          ultima_avaliacao_em?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyp_fornecedores_kyp_provider_id_fkey"
            columns: ["kyp_provider_id"]
            isOneToOne: false
            referencedRelation: "kyp_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      kyp_providers: {
        Row: {
          ativo: boolean
          code: string
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          code: string
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          ativo?: boolean
          code?: string
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      license_idle_alerts: {
        Row: {
          alert_week: string
          company_db: string
          days_idle: number | null
          email_to: string | null
          id: string
          license_type: string | null
          payload: Json
          sent_at: string
          user_code: string
          whatsapp_to: string | null
        }
        Insert: {
          alert_week: string
          company_db: string
          days_idle?: number | null
          email_to?: string | null
          id?: string
          license_type?: string | null
          payload?: Json
          sent_at?: string
          user_code: string
          whatsapp_to?: string | null
        }
        Update: {
          alert_week?: string
          company_db?: string
          days_idle?: number | null
          email_to?: string | null
          id?: string
          license_type?: string | null
          payload?: Json
          sent_at?: string
          user_code?: string
          whatsapp_to?: string | null
        }
        Relationships: []
      }
      license_pricing: {
        Row: {
          currency: string
          license_type: string
          monthly_cost: number
          updated_at: string
        }
        Insert: {
          currency?: string
          license_type: string
          monthly_cost?: number
          updated_at?: string
        }
        Update: {
          currency?: string
          license_type?: string
          monthly_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      nf_entrada_contas_pagar: {
        Row: {
          ap_currency: string | null
          ap_doc_entry: string
          ap_doc_num: string | null
          ap_paid: number | null
          ap_total: number | null
          company_db: string
          created_at: string
          id: string
          linked_at: string
          linked_by: string | null
          nf_import_id: string
          notes: string | null
          source: string
          updated_at: string
        }
        Insert: {
          ap_currency?: string | null
          ap_doc_entry: string
          ap_doc_num?: string | null
          ap_paid?: number | null
          ap_total?: number | null
          company_db: string
          created_at?: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          nf_import_id: string
          notes?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          ap_currency?: string | null
          ap_doc_entry?: string
          ap_doc_num?: string | null
          ap_paid?: number | null
          ap_total?: number | null
          company_db?: string
          created_at?: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          nf_import_id?: string
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_contas_pagar_nf_import_id_fkey"
            columns: ["nf_import_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_entrada_imports: {
        Row: {
          chave_acesso: string
          cnpj_fornecedor: string | null
          condicao_pagamento: string | null
          cost_center: string | null
          created_at: string
          data_emissao: string | null
          divergence_amount: number | null
          divergence_override_at: string | null
          divergence_override_by: string | null
          divergence_override_reason: string | null
          erp_invoice_checked_at: string | null
          erp_invoice_doc_entry: string | null
          erp_invoice_posted: boolean
          expense_id: string | null
          id: string
          impostos: Json
          itens: Json
          last_error: string | null
          last_poll_at: string | null
          match_candidates: Json | null
          match_resolved_at: string | null
          match_resolved_by: string | null
          nome_fornecedor: string | null
          numero_nf: string | null
          pdf_storage_path: string | null
          raw_mastertax: Json | null
          rejection_reason: string | null
          sap_company_db: string | null
          sap_invoice_draft_id: string | null
          sap_match_reason: string | null
          sap_matched_card_code: string | null
          sap_matched_po_doc_entry: string | null
          sap_matched_po_is_draft: boolean
          sap_po_draft_id: string | null
          serie: string | null
          settlement_ap_count: number
          status: Database["public"]["Enums"]["nf_entrada_status"]
          updated_at: string
          valor_total: number | null
          xml_storage_path: string | null
        }
        Insert: {
          chave_acesso: string
          cnpj_fornecedor?: string | null
          condicao_pagamento?: string | null
          cost_center?: string | null
          created_at?: string
          data_emissao?: string | null
          divergence_amount?: number | null
          divergence_override_at?: string | null
          divergence_override_by?: string | null
          divergence_override_reason?: string | null
          erp_invoice_checked_at?: string | null
          erp_invoice_doc_entry?: string | null
          erp_invoice_posted?: boolean
          expense_id?: string | null
          id?: string
          impostos?: Json
          itens?: Json
          last_error?: string | null
          last_poll_at?: string | null
          match_candidates?: Json | null
          match_resolved_at?: string | null
          match_resolved_by?: string | null
          nome_fornecedor?: string | null
          numero_nf?: string | null
          pdf_storage_path?: string | null
          raw_mastertax?: Json | null
          rejection_reason?: string | null
          sap_company_db?: string | null
          sap_invoice_draft_id?: string | null
          sap_match_reason?: string | null
          sap_matched_card_code?: string | null
          sap_matched_po_doc_entry?: string | null
          sap_matched_po_is_draft?: boolean
          sap_po_draft_id?: string | null
          serie?: string | null
          settlement_ap_count?: number
          status?: Database["public"]["Enums"]["nf_entrada_status"]
          updated_at?: string
          valor_total?: number | null
          xml_storage_path?: string | null
        }
        Update: {
          chave_acesso?: string
          cnpj_fornecedor?: string | null
          condicao_pagamento?: string | null
          cost_center?: string | null
          created_at?: string
          data_emissao?: string | null
          divergence_amount?: number | null
          divergence_override_at?: string | null
          divergence_override_by?: string | null
          divergence_override_reason?: string | null
          erp_invoice_checked_at?: string | null
          erp_invoice_doc_entry?: string | null
          erp_invoice_posted?: boolean
          expense_id?: string | null
          id?: string
          impostos?: Json
          itens?: Json
          last_error?: string | null
          last_poll_at?: string | null
          match_candidates?: Json | null
          match_resolved_at?: string | null
          match_resolved_by?: string | null
          nome_fornecedor?: string | null
          numero_nf?: string | null
          pdf_storage_path?: string | null
          raw_mastertax?: Json | null
          rejection_reason?: string | null
          sap_company_db?: string | null
          sap_invoice_draft_id?: string | null
          sap_match_reason?: string | null
          sap_matched_card_code?: string | null
          sap_matched_po_doc_entry?: string | null
          sap_matched_po_is_draft?: boolean
          sap_po_draft_id?: string | null
          serie?: string | null
          settlement_ap_count?: number
          status?: Database["public"]["Enums"]["nf_entrada_status"]
          updated_at?: string
          valor_total?: number | null
          xml_storage_path?: string | null
        }
        Relationships: []
      }
      nf_entrada_logs: {
        Row: {
          actor: string | null
          created_at: string
          id: string
          import_id: string
          message: string | null
          payload: Json | null
          status_from: Database["public"]["Enums"]["nf_entrada_status"] | null
          status_to: Database["public"]["Enums"]["nf_entrada_status"] | null
          step: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          id?: string
          import_id: string
          message?: string | null
          payload?: Json | null
          status_from?: Database["public"]["Enums"]["nf_entrada_status"] | null
          status_to?: Database["public"]["Enums"]["nf_entrada_status"] | null
          step: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          id?: string
          import_id?: string
          message?: string | null
          payload?: Json | null
          status_from?: Database["public"]["Enums"]["nf_entrada_status"] | null
          status_to?: Database["public"]["Enums"]["nf_entrada_status"] | null
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_logs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_entrada_settings: {
        Row: {
          company_db: string
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      nf_entrada_write_queue: {
        Row: {
          attempts: number
          company_db: string
          created_at: string
          erp_document_id: string | null
          erp_document_type: string | null
          erp_type: string
          error_message: string | null
          id: string
          idempotency_key: string
          import_id: string
          operation: string
          payload: Json
          processed_at: string | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_db: string
          created_at?: string
          erp_document_id?: string | null
          erp_document_type?: string | null
          erp_type?: string
          error_message?: string | null
          id?: string
          idempotency_key: string
          import_id: string
          operation: string
          payload?: Json
          processed_at?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_db?: string
          created_at?: string
          erp_document_id?: string | null
          erp_document_type?: string | null
          erp_type?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string
          import_id?: string
          operation?: string
          payload?: Json
          processed_at?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_write_queue_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      nfse_email_log: {
        Row: {
          attachment_path: string | null
          cc_emails: string[]
          company_db: string
          created_at: string
          error_message: string | null
          expense_id: string | null
          id: string
          invoice_doc_entry: number | null
          nfse_number: string | null
          project_code: string | null
          sent_by: string | null
          status: string
          subject: string | null
          to_emails: string[]
        }
        Insert: {
          attachment_path?: string | null
          cc_emails?: string[]
          company_db: string
          created_at?: string
          error_message?: string | null
          expense_id?: string | null
          id?: string
          invoice_doc_entry?: number | null
          nfse_number?: string | null
          project_code?: string | null
          sent_by?: string | null
          status?: string
          subject?: string | null
          to_emails?: string[]
        }
        Update: {
          attachment_path?: string | null
          cc_emails?: string[]
          company_db?: string
          created_at?: string
          error_message?: string | null
          expense_id?: string | null
          id?: string
          invoice_doc_entry?: number | null
          nfse_number?: string | null
          project_code?: string | null
          sent_by?: string | null
          status?: string
          subject?: string | null
          to_emails?: string[]
        }
        Relationships: []
      }
      nfse_email_recipients: {
        Row: {
          brand: string | null
          cc_emails: string[]
          company_db: string
          created_at: string
          customer_code: string
          customer_name: string | null
          id: string
          is_active: boolean
          project_code: string
          source: string
          to_emails: string[]
          updated_at: string
        }
        Insert: {
          brand?: string | null
          cc_emails?: string[]
          company_db: string
          created_at?: string
          customer_code?: string
          customer_name?: string | null
          id?: string
          is_active?: boolean
          project_code?: string
          source?: string
          to_emails?: string[]
          updated_at?: string
        }
        Update: {
          brand?: string | null
          cc_emails?: string[]
          company_db?: string
          created_at?: string
          customer_code?: string
          customer_name?: string | null
          id?: string
          is_active?: boolean
          project_code?: string
          source?: string
          to_emails?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      nfse_email_settings: {
        Row: {
          company_db: string
          created_at: string
          from_email: string
          from_name: string
          id: string
          is_active: boolean
          reply_to: string | null
          smtp_host: string
          smtp_password_secret: string
          smtp_port: number
          smtp_user: string
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          from_email: string
          from_name: string
          id?: string
          is_active?: boolean
          reply_to?: string | null
          smtp_host?: string
          smtp_password_secret: string
          smtp_port?: number
          smtp_user: string
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          from_email?: string
          from_name?: string
          id?: string
          is_active?: boolean
          reply_to?: string | null
          smtp_host?: string
          smtp_password_secret?: string
          smtp_port?: number
          smtp_user?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_audit_log: {
        Row: {
          amount: number | null
          channel: string
          company_db: string | null
          cost_center: string | null
          created_at: string
          currency: string | null
          doc_type: string | null
          event_key: string
          expense_id: string | null
          id: string
          level_order: number | null
          matrix_version: string | null
          metadata: Json
          project: string | null
          recipient: string
          recipient_name: string | null
          recipient_role: string
          resolution_reason: string | null
          resolution_source: string | null
          rule_id: string | null
          rule_name: string | null
          status: string
        }
        Insert: {
          amount?: number | null
          channel: string
          company_db?: string | null
          cost_center?: string | null
          created_at?: string
          currency?: string | null
          doc_type?: string | null
          event_key?: string
          expense_id?: string | null
          id?: string
          level_order?: number | null
          matrix_version?: string | null
          metadata?: Json
          project?: string | null
          recipient: string
          recipient_name?: string | null
          recipient_role?: string
          resolution_reason?: string | null
          resolution_source?: string | null
          rule_id?: string | null
          rule_name?: string | null
          status?: string
        }
        Update: {
          amount?: number | null
          channel?: string
          company_db?: string | null
          cost_center?: string | null
          created_at?: string
          currency?: string | null
          doc_type?: string | null
          event_key?: string
          expense_id?: string | null
          id?: string
          level_order?: number | null
          matrix_version?: string | null
          metadata?: Json
          project?: string | null
          recipient?: string
          recipient_name?: string | null
          recipient_role?: string
          resolution_reason?: string | null
          resolution_source?: string | null
          rule_id?: string | null
          rule_name?: string | null
          status?: string
        }
        Relationships: []
      }
      notification_channel_settings: {
        Row: {
          company_db: string | null
          created_at: string
          email_enabled: boolean
          event_key: string
          id: string
          in_app_enabled: boolean
          push_enabled: boolean
          slack_enabled: boolean
          updated_at: string
          updated_by: string | null
          whatsapp_enabled: boolean
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          email_enabled?: boolean
          event_key?: string
          id?: string
          in_app_enabled?: boolean
          push_enabled?: boolean
          slack_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          whatsapp_enabled?: boolean
        }
        Update: {
          company_db?: string | null
          created_at?: string
          email_enabled?: boolean
          event_key?: string
          id?: string
          in_app_enabled?: boolean
          push_enabled?: boolean
          slack_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      notification_governance: {
        Row: {
          block_self_approval: boolean
          blocked_recipients: string[]
          channels: string[]
          company_db: string | null
          created_at: string
          enabled: boolean
          exclude_test_companies: boolean
          extra_recipients: string[]
          id: string
          notify_requester: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          block_self_approval?: boolean
          blocked_recipients?: string[]
          channels?: string[]
          company_db?: string | null
          created_at?: string
          enabled?: boolean
          exclude_test_companies?: boolean
          extra_recipients?: string[]
          id?: string
          notify_requester?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          block_self_approval?: boolean
          blocked_recipients?: string[]
          channels?: string[]
          company_db?: string | null
          created_at?: string
          enabled?: boolean
          exclude_test_companies?: boolean
          extra_recipients?: string[]
          id?: string
          notify_requester?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          category: string
          created_at: string
          email: boolean
          id: string
          in_app: boolean
          slack: boolean
          updated_at: string
          user_identifier: string
          whatsapp: boolean
        }
        Insert: {
          category: string
          created_at?: string
          email?: boolean
          id?: string
          in_app?: boolean
          slack?: boolean
          updated_at?: string
          user_identifier: string
          whatsapp?: boolean
        }
        Update: {
          category?: string
          created_at?: string
          email?: boolean
          id?: string
          in_app?: boolean
          slack?: boolean
          updated_at?: string
          user_identifier?: string
          whatsapp?: boolean
        }
        Relationships: []
      }
      notification_send_runs: {
        Row: {
          details: Json
          error_message: string | null
          function_name: string
          id: string
          recipients_count: number
          sent_at: string
          status: string
        }
        Insert: {
          details?: Json
          error_message?: string | null
          function_name: string
          id?: string
          recipients_count?: number
          sent_at?: string
          status?: string
        }
        Update: {
          details?: Json
          error_message?: string | null
          function_name?: string
          id?: string
          recipients_count?: number
          sent_at?: string
          status?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          body_template: string | null
          channels: string[]
          company_db: string | null
          created_at: string
          description: string | null
          enabled: boolean
          event_key: string
          frequency: string
          frequency_minutes: number | null
          html_template: string | null
          id: string
          label: string
          subject_template: string | null
          trigger_config: Json
          updated_at: string
          updated_by: string | null
          weekdays_only: boolean
          window_end_hour: number | null
          window_start_hour: number | null
        }
        Insert: {
          body_template?: string | null
          channels?: string[]
          company_db?: string | null
          created_at?: string
          description?: string | null
          enabled?: boolean
          event_key: string
          frequency?: string
          frequency_minutes?: number | null
          html_template?: string | null
          id?: string
          label: string
          subject_template?: string | null
          trigger_config?: Json
          updated_at?: string
          updated_by?: string | null
          weekdays_only?: boolean
          window_end_hour?: number | null
          window_start_hour?: number | null
        }
        Update: {
          body_template?: string | null
          channels?: string[]
          company_db?: string | null
          created_at?: string
          description?: string | null
          enabled?: boolean
          event_key?: string
          frequency?: string
          frequency_minutes?: number | null
          html_template?: string | null
          id?: string
          label?: string
          subject_template?: string | null
          trigger_config?: Json
          updated_at?: string
          updated_by?: string | null
          weekdays_only?: boolean
          window_end_hour?: number | null
          window_start_hour?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          company_db: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          metadata: Json | null
          title: string
          user_identifier: string
        }
        Insert: {
          body?: string | null
          category?: string
          company_db?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          metadata?: Json | null
          title: string
          user_identifier: string
        }
        Update: {
          body?: string | null
          category?: string
          company_db?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          metadata?: Json | null
          title?: string
          user_identifier?: string
        }
        Relationships: []
      }
      overdue_reminder_log: {
        Row: {
          company_db: string
          expense_id: string
          id: string
          recipient_name: string | null
          recipient_phone: string | null
          recipient_role: string
          response: string | null
          sent_at: string
          status: string
        }
        Insert: {
          company_db: string
          expense_id: string
          id?: string
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_role: string
          response?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          company_db?: string
          expense_id?: string
          id?: string
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_role?: string
          response?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "overdue_reminder_log_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      overdue_reminder_settings: {
        Row: {
          company_db: string | null
          enabled: boolean
          frequency_minutes: number
          id: string
          max_reminders_per_doc: number
          notify_approver: boolean
          notify_requester: boolean
          template: string
          updated_at: string
          updated_by: string | null
          weekdays_only: boolean
          window_end_hour: number
          window_start_hour: number
        }
        Insert: {
          company_db?: string | null
          enabled?: boolean
          frequency_minutes?: number
          id?: string
          max_reminders_per_doc?: number
          notify_approver?: boolean
          notify_requester?: boolean
          template?: string
          updated_at?: string
          updated_by?: string | null
          weekdays_only?: boolean
          window_end_hour?: number
          window_start_hour?: number
        }
        Update: {
          company_db?: string | null
          enabled?: boolean
          frequency_minutes?: number
          id?: string
          max_reminders_per_doc?: number
          notify_approver?: boolean
          notify_requester?: boolean
          template?: string
          updated_at?: string
          updated_by?: string | null
          weekdays_only?: boolean
          window_end_hour?: number
          window_start_hour?: number
        }
        Relationships: []
      }
      pagcorp_account_mapping: {
        Row: {
          account_code: string
          account_name: string | null
          cost_center: string | null
          created_at: string
          id: string
          project: string | null
          updated_at: string
        }
        Insert: {
          account_code: string
          account_name?: string | null
          cost_center?: string | null
          created_at?: string
          id?: string
          project?: string | null
          updated_at?: string
        }
        Update: {
          account_code?: string
          account_name?: string | null
          cost_center?: string | null
          created_at?: string
          id?: string
          project?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_card_mapping: {
        Row: {
          card_identifier: string | null
          card_label: string | null
          company_db: string
          cost_center: string | null
          created_at: string
          id: string
          is_fallback: boolean
          item_code: string | null
          project: string | null
          updated_at: string
        }
        Insert: {
          card_identifier?: string | null
          card_label?: string | null
          company_db: string
          cost_center?: string | null
          created_at?: string
          id?: string
          is_fallback?: boolean
          item_code?: string | null
          project?: string | null
          updated_at?: string
        }
        Update: {
          card_identifier?: string | null
          card_label?: string | null
          company_db?: string
          cost_center?: string | null
          created_at?: string
          id?: string
          is_fallback?: boolean
          item_code?: string | null
          project?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_cards: {
        Row: {
          account_alias: string | null
          card_identifier: string
          card_label: string | null
          card_last_digits: string | null
          card_name: string | null
          company_db: string
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          updated_at: string
        }
        Insert: {
          account_alias?: string | null
          card_identifier: string
          card_label?: string | null
          card_last_digits?: string | null
          card_name?: string | null
          company_db: string
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          updated_at?: string
        }
        Update: {
          account_alias?: string | null
          card_identifier?: string
          card_label?: string | null
          card_last_digits?: string | null
          card_name?: string | null
          company_db?: string
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_document_relations: {
        Row: {
          amount_matches: boolean | null
          company_db: string | null
          created_at: string
          last_resolved_at: string | null
          nf_doc_entries: number[]
          nf_found: boolean
          nf_inferred: boolean
          pagcorp_log_id: string
          payment_doc_entries: number[]
          payment_found: boolean
          po_currency: string | null
          po_doc_entry: number | null
          po_doc_num: number | null
          po_found: boolean
          po_status: string | null
          po_total: number | null
          po_total_fc: number | null
          resolve_error: string | null
          updated_at: string
        }
        Insert: {
          amount_matches?: boolean | null
          company_db?: string | null
          created_at?: string
          last_resolved_at?: string | null
          nf_doc_entries?: number[]
          nf_found?: boolean
          nf_inferred?: boolean
          pagcorp_log_id: string
          payment_doc_entries?: number[]
          payment_found?: boolean
          po_currency?: string | null
          po_doc_entry?: number | null
          po_doc_num?: number | null
          po_found?: boolean
          po_status?: string | null
          po_total?: number | null
          po_total_fc?: number | null
          resolve_error?: string | null
          updated_at?: string
        }
        Update: {
          amount_matches?: boolean | null
          company_db?: string | null
          created_at?: string
          last_resolved_at?: string | null
          nf_doc_entries?: number[]
          nf_found?: boolean
          nf_inferred?: boolean
          pagcorp_log_id?: string
          payment_doc_entries?: number[]
          payment_found?: boolean
          po_currency?: string | null
          po_doc_entry?: number | null
          po_doc_num?: number | null
          po_found?: boolean
          po_status?: string | null
          po_total?: number | null
          po_total_fc?: number | null
          resolve_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagcorp_document_relations_pagcorp_log_id_fkey"
            columns: ["pagcorp_log_id"]
            isOneToOne: true
            referencedRelation: "pagcorp_integration_log"
            referencedColumns: ["id"]
          },
        ]
      }
      pagcorp_integration_log: {
        Row: {
          company_db: string | null
          created_at: string
          error_message: string | null
          id: string
          integrated_by: string | null
          integration_type: string
          pagcorp_data: Json
          pagcorp_expense_id: number
          sap_doc_entry: number | null
          sap_doc_num: number | null
          sap_payload: Json | null
          sap_response: Json | null
          settlement_attempted_at: string | null
          settlement_attempts: number
          settlement_completed_at: string | null
          settlement_error: string | null
          settlement_invoice_doc_entry: number | null
          settlement_invoice_doc_num: number | null
          settlement_journal_entry: number | null
          settlement_locked_at: string | null
          settlement_payment_doc_entry: number | null
          settlement_payment_doc_num: number | null
          settlement_ptax_date: string | null
          settlement_ptax_rate: number | null
          settlement_ptax_source: string | null
          settlement_retry_after: string | null
          settlement_status: string
          status: string
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          integrated_by?: string | null
          integration_type?: string
          pagcorp_data?: Json
          pagcorp_expense_id: number
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_payload?: Json | null
          sap_response?: Json | null
          settlement_attempted_at?: string | null
          settlement_attempts?: number
          settlement_completed_at?: string | null
          settlement_error?: string | null
          settlement_invoice_doc_entry?: number | null
          settlement_invoice_doc_num?: number | null
          settlement_journal_entry?: number | null
          settlement_locked_at?: string | null
          settlement_payment_doc_entry?: number | null
          settlement_payment_doc_num?: number | null
          settlement_ptax_date?: string | null
          settlement_ptax_rate?: number | null
          settlement_ptax_source?: string | null
          settlement_retry_after?: string | null
          settlement_status?: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          integrated_by?: string | null
          integration_type?: string
          pagcorp_data?: Json
          pagcorp_expense_id?: number
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_payload?: Json | null
          sap_response?: Json | null
          settlement_attempted_at?: string | null
          settlement_attempts?: number
          settlement_completed_at?: string | null
          settlement_error?: string | null
          settlement_invoice_doc_entry?: number | null
          settlement_invoice_doc_num?: number | null
          settlement_journal_entry?: number | null
          settlement_locked_at?: string | null
          settlement_payment_doc_entry?: number | null
          settlement_payment_doc_num?: number | null
          settlement_ptax_date?: string | null
          settlement_ptax_rate?: number | null
          settlement_ptax_source?: string | null
          settlement_retry_after?: string | null
          settlement_status?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_item_mapping: {
        Row: {
          account_code: string | null
          account_name: string | null
          created_at: string
          id: string
          is_fallback: boolean
          item_code: string
          updated_at: string
        }
        Insert: {
          account_code?: string | null
          account_name?: string | null
          created_at?: string
          id?: string
          is_fallback?: boolean
          item_code: string
          updated_at?: string
        }
        Update: {
          account_code?: string | null
          account_name?: string | null
          created_at?: string
          id?: string
          is_fallback?: boolean
          item_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_nondeductible_cards: {
        Row: {
          card_holder: string | null
          card_identifier: string
          card_label: string | null
          company_db: string
          created_at: string
          created_by: string | null
          id: string
          supplier_code: string
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          card_holder?: string | null
          card_identifier: string
          card_label?: string | null
          company_db: string
          created_at?: string
          created_by?: string | null
          id?: string
          supplier_code: string
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          card_holder?: string | null
          card_identifier?: string
          card_label?: string | null
          company_db?: string
          created_at?: string
          created_by?: string | null
          id?: string
          supplier_code?: string
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_nondeductible_expenses: {
        Row: {
          company_db: string
          created_at: string
          created_by: string | null
          id: string
          pagcorp_expense_id: number
          reason: string | null
          supplier_code: string | null
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          created_by?: string | null
          id?: string
          pagcorp_expense_id: number
          reason?: string | null
          supplier_code?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          created_by?: string | null
          id?: string
          pagcorp_expense_id?: number
          reason?: string | null
          supplier_code?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_settlement_accounts: {
        Row: {
          card_identifier: string | null
          company_db: string
          cost_center: string | null
          created_at: string
          currency: string | null
          enabled: boolean
          event_classification: string | null
          id: string
          project: string | null
          settlement_account_code: string
          updated_at: string
        }
        Insert: {
          card_identifier?: string | null
          company_db: string
          cost_center?: string | null
          created_at?: string
          currency?: string | null
          enabled?: boolean
          event_classification?: string | null
          id?: string
          project?: string | null
          settlement_account_code: string
          updated_at?: string
        }
        Update: {
          card_identifier?: string | null
          company_db?: string
          cost_center?: string | null
          created_at?: string
          currency?: string | null
          enabled?: boolean
          event_classification?: string | null
          id?: string
          project?: string | null
          settlement_account_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      pagcorp_supplier_links: {
        Row: {
          card_code: string | null
          card_name: string | null
          card_name_key: string | null
          company_db: string | null
          created_at: string
          federal_tax_id: string | null
          id: string
          resolution: string
          resolved_by: string | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          card_code?: string | null
          card_name?: string | null
          card_name_key?: string | null
          company_db?: string | null
          created_at?: string
          federal_tax_id?: string | null
          id?: string
          resolution?: string
          resolved_by?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          card_code?: string | null
          card_name?: string | null
          card_name_key?: string | null
          company_db?: string | null
          created_at?: string
          federal_tax_id?: string | null
          id?: string
          resolution?: string
          resolved_by?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagcorp_supplier_links_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_venda_erp: {
        Row: {
          card_code: string | null
          company_db: string
          created_at: string
          criado_por: string | null
          doc_entry: number
          doc_num: string | null
          id: string
          updated_at: string
        }
        Insert: {
          card_code?: string | null
          company_db: string
          created_at?: string
          criado_por?: string | null
          doc_entry: number
          doc_num?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          card_code?: string | null
          company_db?: string
          created_at?: string
          criado_por?: string | null
          doc_entry?: number
          doc_num?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      permission_group_modules: {
        Row: {
          can_approve: boolean
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_integrate: boolean
          can_view: boolean
          created_at: string
          group_id: string
          id: string
          module_key: string
        }
        Insert: {
          can_approve?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_integrate?: boolean
          can_view?: boolean
          created_at?: string
          group_id: string
          id?: string
          module_key: string
        }
        Update: {
          can_approve?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_integrate?: boolean
          can_view?: boolean
          created_at?: string
          group_id?: string
          id?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_group_modules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_groups: {
        Row: {
          company_db: string | null
          created_at: string
          description: string | null
          erp_type: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          description?: string | null
          erp_type?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          created_at?: string
          description?: string | null
          erp_type?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      permission_shadow_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_identifier: string | null
          company_db: string | null
          context: Json | null
          decision: string
          id: number
          mode: string
          module_key: string
          reason: string | null
          ts: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_identifier?: string | null
          company_db?: string | null
          context?: Json | null
          decision: string
          id?: number
          mode: string
          module_key: string
          reason?: string | null
          ts?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_identifier?: string | null
          company_db?: string | null
          context?: Json | null
          decision?: string
          id?: number
          mode?: string
          module_key?: string
          reason?: string | null
          ts?: string
        }
        Relationships: []
      }
      permissions_enforcement_scope: {
        Row: {
          company_db: string
          enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_db: string
          enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_db?: string
          enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      po_notification_sent: {
        Row: {
          company_db: string
          email_html: string | null
          email_subject: string | null
          error_message: string | null
          id: string
          milestone: string
          po_doc_entry: number
          po_doc_num: number | null
          recipient_email: string | null
          sent_at: string
          status: string
        }
        Insert: {
          company_db: string
          email_html?: string | null
          email_subject?: string | null
          error_message?: string | null
          id?: string
          milestone: string
          po_doc_entry: number
          po_doc_num?: number | null
          recipient_email?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          company_db?: string
          email_html?: string | null
          email_subject?: string | null
          error_message?: string | null
          id?: string
          milestone?: string
          po_doc_entry?: number
          po_doc_num?: number | null
          recipient_email?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          company_db: string | null
          created_at: string
          email: string | null
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_identifier: string
        }
        Insert: {
          auth: string
          company_db?: string | null
          created_at?: string
          email?: string | null
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_identifier: string
        }
        Update: {
          auth?: string
          company_db?: string | null
          created_at?: string
          email?: string | null
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_identifier?: string
        }
        Relationships: []
      }
      registration_request_events: {
        Row: {
          attachments: Json
          author_email: string
          author_name: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          message: string | null
          request_id: string
          to_status: string | null
        }
        Insert: {
          attachments?: Json
          author_email: string
          author_name?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          message?: string | null
          request_id: string
          to_status?: string | null
        }
        Update: {
          attachments?: Json
          author_email?: string
          author_name?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          message?: string | null
          request_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registration_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "registration_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_requests: {
        Row: {
          address: Json
          assignee_email: string | null
          attachments: Json
          bank_details: Json
          company_db: string | null
          contact_email: string | null
          context: string | null
          created_at: string
          currency: string | null
          due_at: string
          federal_tax_id: string | null
          followers: string[]
          id: string
          notes: string | null
          payment_method: string | null
          phone1: string | null
          phone2: string | null
          registration_mode: string
          request_type: string
          requester_email: string
          requester_name: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          sap_card_code: string | null
          status: string
          title: string
          transaction: Json | null
          updated_at: string
        }
        Insert: {
          address?: Json
          assignee_email?: string | null
          attachments?: Json
          bank_details?: Json
          company_db?: string | null
          contact_email?: string | null
          context?: string | null
          created_at?: string
          currency?: string | null
          due_at?: string
          federal_tax_id?: string | null
          followers?: string[]
          id?: string
          notes?: string | null
          payment_method?: string | null
          phone1?: string | null
          phone2?: string | null
          registration_mode?: string
          request_type?: string
          requester_email: string
          requester_name?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sap_card_code?: string | null
          status?: string
          title: string
          transaction?: Json | null
          updated_at?: string
        }
        Update: {
          address?: Json
          assignee_email?: string | null
          attachments?: Json
          bank_details?: Json
          company_db?: string | null
          contact_email?: string | null
          context?: string | null
          created_at?: string
          currency?: string | null
          due_at?: string
          federal_tax_id?: string | null
          followers?: string[]
          id?: string
          notes?: string | null
          payment_method?: string | null
          phone1?: string | null
          phone2?: string | null
          registration_mode?: string
          request_type?: string
          requester_email?: string
          requester_name?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sap_card_code?: string | null
          status?: string
          title?: string
          transaction?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      registration_sla_reminder_log: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          kind: string
          recipients: string[]
          request_id: string
          status: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          recipients?: string[]
          request_id: string
          status?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          recipients?: string[]
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_sla_reminder_log_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "registration_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      roi_parameters: {
        Row: {
          company_db: string | null
          created_at: string
          custo_licenca_aprovador_sap: number
          custo_licenca_flow: number
          custo_licenca_solicitante_sap: number
          horas_mes: number
          id: string
          juros_mes_percent: number
          multa_percent: number
          salario_aprovador: number
          salario_solicitante: number
          tempo_aprovar_flow_min: number
          tempo_aprovar_sap_min: number
          tempo_lancar_flow_min: number
          tempo_lancar_sap_min: number
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          custo_licenca_aprovador_sap?: number
          custo_licenca_flow?: number
          custo_licenca_solicitante_sap?: number
          horas_mes?: number
          id?: string
          juros_mes_percent?: number
          multa_percent?: number
          salario_aprovador?: number
          salario_solicitante?: number
          tempo_aprovar_flow_min?: number
          tempo_aprovar_sap_min?: number
          tempo_lancar_flow_min?: number
          tempo_lancar_sap_min?: number
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          created_at?: string
          custo_licenca_aprovador_sap?: number
          custo_licenca_flow?: number
          custo_licenca_solicitante_sap?: number
          horas_mes?: number
          id?: string
          juros_mes_percent?: number
          multa_percent?: number
          salario_aprovador?: number
          salario_solicitante?: number
          tempo_aprovar_flow_min?: number
          tempo_aprovar_sap_min?: number
          tempo_lancar_flow_min?: number
          tempo_lancar_sap_min?: number
          updated_at?: string
        }
        Relationships: []
      }
      sales_order_invoices: {
        Row: {
          authorized_at: string | null
          company_db: string
          created_at: string
          created_by_email: string | null
          currency: string
          expense_id: string | null
          id: string
          last_error: string | null
          nfse_number: string | null
          rps_number: string | null
          sap_invoice_doc_entry: number | null
          sap_invoice_doc_num: number | null
          sap_order_doc_entry: number | null
          sap_order_doc_num: number | null
          series: string | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          authorized_at?: string | null
          company_db: string
          created_at?: string
          created_by_email?: string | null
          currency?: string
          expense_id?: string | null
          id?: string
          last_error?: string | null
          nfse_number?: string | null
          rps_number?: string | null
          sap_invoice_doc_entry?: number | null
          sap_invoice_doc_num?: number | null
          sap_order_doc_entry?: number | null
          sap_order_doc_num?: number | null
          series?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          authorized_at?: string | null
          company_db?: string
          created_at?: string
          created_by_email?: string | null
          currency?: string
          expense_id?: string | null
          id?: string
          last_error?: string | null
          nfse_number?: string | null
          rps_number?: string | null
          sap_invoice_doc_entry?: number | null
          sap_invoice_doc_num?: number | null
          sap_order_doc_entry?: number | null
          sap_order_doc_num?: number | null
          series?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_invoices_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_cache: {
        Row: {
          cache_key: string
          company_db: string
          created_at: string
          data: Json
          expires_at: string
          id: string
          updated_at: string
        }
        Insert: {
          cache_key: string
          company_db: string
          created_at?: string
          data?: Json
          expires_at: string
          id?: string
          updated_at?: string
        }
        Update: {
          cache_key?: string
          company_db?: string
          created_at?: string
          data?: Json
          expires_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sap_fluxo_analise_cache: {
        Row: {
          aprovador: string | null
          centro_custo: string | null
          company_db: string
          created_at: string
          data_aprovacao: string | null
          data_atualizacao_esboco: string | null
          data_lancamento: string | null
          data_pagamento: string | null
          data_vencimento: string | null
          departamento: string | null
          descricao: string | null
          flow_key: string
          fornecedor: string | null
          id: string
          id_cp: string | null
          id_esboco: string | null
          id_nf: string | null
          id_pedido: string | null
          marca: string | null
          raw_json: Json | null
          solicitante: string | null
          synced_at: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          aprovador?: string | null
          centro_custo?: string | null
          company_db: string
          created_at?: string
          data_aprovacao?: string | null
          data_atualizacao_esboco?: string | null
          data_lancamento?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          departamento?: string | null
          descricao?: string | null
          flow_key: string
          fornecedor?: string | null
          id?: string
          id_cp?: string | null
          id_esboco?: string | null
          id_nf?: string | null
          id_pedido?: string | null
          marca?: string | null
          raw_json?: Json | null
          solicitante?: string | null
          synced_at?: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          aprovador?: string | null
          centro_custo?: string | null
          company_db?: string
          created_at?: string
          data_aprovacao?: string | null
          data_atualizacao_esboco?: string | null
          data_lancamento?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          departamento?: string | null
          descricao?: string | null
          flow_key?: string
          fornecedor?: string | null
          id?: string
          id_cp?: string | null
          id_esboco?: string | null
          id_nf?: string | null
          id_pedido?: string | null
          marca?: string | null
          raw_json?: Json | null
          solicitante?: string | null
          synced_at?: string
          updated_at?: string
          valor?: number | null
        }
        Relationships: []
      }
      sap_fluxo_analise_sync_state: {
        Row: {
          company_db: string
          created_at: string
          last_batch_count: number | null
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          total_synced: number | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          last_batch_count?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          last_batch_count?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sap_group_mapping: {
        Row: {
          can_approve: boolean
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_integrate: boolean
          can_view: boolean
          company_db: string
          created_at: string
          created_by: string | null
          id: string
          module_key: string
          sap_group_code: string
          sap_group_name: string | null
          updated_at: string
        }
        Insert: {
          can_approve?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_integrate?: boolean
          can_view?: boolean
          company_db: string
          created_at?: string
          created_by?: string | null
          id?: string
          module_key: string
          sap_group_code: string
          sap_group_name?: string | null
          updated_at?: string
        }
        Update: {
          can_approve?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_integrate?: boolean
          can_view?: boolean
          company_db?: string
          created_at?: string
          created_by?: string | null
          id?: string
          module_key?: string
          sap_group_code?: string
          sap_group_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sap_groups_cache: {
        Row: {
          company_db: string
          created_at: string
          id: string
          last_seen_at: string
          sap_group_code: string
          sap_group_name: string | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          last_seen_at?: string
          sap_group_code: string
          sap_group_name?: string | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          last_seen_at?: string
          sap_group_code?: string
          sap_group_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sap_nf_entrada_cache: {
        Row: {
          base_po_doc_entry: number | null
          cancelled: string | null
          card_code: string | null
          card_name: string | null
          company_db: string
          created_at: string
          doc_currency: string | null
          doc_date: string | null
          doc_due_date: string | null
          doc_entry: number
          doc_num: number | null
          doc_total: number | null
          document_status: string | null
          id: string
          raw_json: Json
          sap_update_date: string | null
          series: number | null
          synced_at: string
          tax_date: string | null
          updated_at: string
        }
        Insert: {
          base_po_doc_entry?: number | null
          cancelled?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db: string
          created_at?: string
          doc_currency?: string | null
          doc_date?: string | null
          doc_due_date?: string | null
          doc_entry: number
          doc_num?: number | null
          doc_total?: number | null
          document_status?: string | null
          id?: string
          raw_json?: Json
          sap_update_date?: string | null
          series?: number | null
          synced_at?: string
          tax_date?: string | null
          updated_at?: string
        }
        Update: {
          base_po_doc_entry?: number | null
          cancelled?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db?: string
          created_at?: string
          doc_currency?: string | null
          doc_date?: string | null
          doc_due_date?: string | null
          doc_entry?: number
          doc_num?: number | null
          doc_total?: number | null
          document_status?: string | null
          id?: string
          raw_json?: Json
          sap_update_date?: string | null
          series?: number | null
          synced_at?: string
          tax_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sap_nf_entrada_sync_state: {
        Row: {
          company_db: string
          created_at: string
          id: string
          last_batch_count: number | null
          last_doc_entry: number | null
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          last_update_date: string | null
          total_synced: number | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          last_batch_count?: number | null
          last_doc_entry?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_update_date?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          last_batch_count?: number | null
          last_doc_entry?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_update_date?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sap_purchase_order_cache: {
        Row: {
          cancelled: string | null
          card_code: string | null
          card_name: string | null
          company_db: string
          created_at: string
          doc_currency: string | null
          doc_date: string | null
          doc_due_date: string | null
          doc_entry: number
          doc_num: number | null
          doc_total: number | null
          doc_total_fc: number | null
          document_status: string | null
          id: string
          raw_json: Json
          sap_update_date: string | null
          series: number | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          cancelled?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db: string
          created_at?: string
          doc_currency?: string | null
          doc_date?: string | null
          doc_due_date?: string | null
          doc_entry: number
          doc_num?: number | null
          doc_total?: number | null
          doc_total_fc?: number | null
          document_status?: string | null
          id?: string
          raw_json?: Json
          sap_update_date?: string | null
          series?: number | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          cancelled?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db?: string
          created_at?: string
          doc_currency?: string | null
          doc_date?: string | null
          doc_due_date?: string | null
          doc_entry?: number
          doc_num?: number | null
          doc_total?: number | null
          doc_total_fc?: number | null
          document_status?: string | null
          id?: string
          raw_json?: Json
          sap_update_date?: string | null
          series?: number | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sap_purchase_order_sync_state: {
        Row: {
          company_db: string
          created_at: string
          id: string
          last_batch_count: number | null
          last_doc_entry: number | null
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          last_update_date: string | null
          total_synced: number | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          last_batch_count?: number | null
          last_doc_entry?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_update_date?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          last_batch_count?: number | null
          last_doc_entry?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_update_date?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sap_retry_queue: {
        Row: {
          attempts: number
          company_db: string | null
          created_at: string
          doc_type: string
          error_category: string | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          notified_exhausted_at: string | null
          payload: Json
          ref_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_db?: string | null
          created_at?: string
          doc_type: string
          error_category?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          notified_exhausted_at?: string | null
          payload?: Json
          ref_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_db?: string | null
          created_at?: string
          doc_type?: string
          error_category?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          notified_exhausted_at?: string | null
          payload?: Json
          ref_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sap_total_reconciliation: {
        Row: {
          abs_difference: number
          breakdown: Json
          cause: string | null
          cause_detail: Json
          cause_label: string | null
          checked_at: string
          company_db: string
          created_at: string
          difference: number
          doc_type: string | null
          expense_id: string
          flow_total: number
          id: string
          resolved_at: string | null
          resolved_by: string | null
          sap_doc_entry: number | null
          sap_doc_num: number | null
          sap_net_total: number
          sap_total: number
          status: string
          updated_at: string
        }
        Insert: {
          abs_difference?: number
          breakdown?: Json
          cause?: string | null
          cause_detail?: Json
          cause_label?: string | null
          checked_at?: string
          company_db: string
          created_at?: string
          difference?: number
          doc_type?: string | null
          expense_id: string
          flow_total?: number
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_net_total?: number
          sap_total?: number
          status?: string
          updated_at?: string
        }
        Update: {
          abs_difference?: number
          breakdown?: Json
          cause?: string | null
          cause_detail?: Json
          cause_label?: string | null
          checked_at?: string
          company_db?: string
          created_at?: string
          difference?: number
          doc_type?: string | null
          expense_id?: string
          flow_total?: number
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_net_total?: number
          sap_total?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sap_total_reconciliation_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_user_directory: {
        Row: {
          created_at: string
          display_name: string | null
          is_active: boolean
          management_segment: string
          sap_user_code: string | null
          updated_at: string
          user_key: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          is_active?: boolean
          management_segment?: string
          sap_user_code?: string | null
          updated_at?: string
          user_key: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          is_active?: boolean
          management_segment?: string
          sap_user_code?: string | null
          updated_at?: string
          user_key?: string
        }
        Relationships: []
      }
      sap_user_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          is_primary: boolean
          updated_at: string
          user_key: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          user_key: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sap_user_emails_user_key_fkey"
            columns: ["user_key"]
            isOneToOne: false
            referencedRelation: "sap_user_directory"
            referencedColumns: ["user_key"]
          },
        ]
      }
      sap_vendor_payment_cache: {
        Row: {
          cancelled: string | null
          card_code: string | null
          card_name: string | null
          company_db: string
          created_at: string
          doc_currency: string | null
          doc_date: string | null
          doc_entry: number
          doc_num: number | null
          doc_total: number | null
          doc_total_fc: number | null
          document_status: string | null
          id: string
          invoice_links: Json
          raw_json: Json
          sap_update_date: string | null
          series: number | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          cancelled?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db: string
          created_at?: string
          doc_currency?: string | null
          doc_date?: string | null
          doc_entry: number
          doc_num?: number | null
          doc_total?: number | null
          doc_total_fc?: number | null
          document_status?: string | null
          id?: string
          invoice_links?: Json
          raw_json?: Json
          sap_update_date?: string | null
          series?: number | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          cancelled?: string | null
          card_code?: string | null
          card_name?: string | null
          company_db?: string
          created_at?: string
          doc_currency?: string | null
          doc_date?: string | null
          doc_entry?: number
          doc_num?: number | null
          doc_total?: number | null
          doc_total_fc?: number | null
          document_status?: string | null
          id?: string
          invoice_links?: Json
          raw_json?: Json
          sap_update_date?: string | null
          series?: number | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sap_vendor_payment_sync_state: {
        Row: {
          company_db: string
          created_at: string
          id: string
          last_batch_count: number | null
          last_doc_entry: number | null
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          last_update_date: string | null
          total_synced: number | null
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          last_batch_count?: number | null
          last_doc_entry?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_update_date?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          last_batch_count?: number | null
          last_doc_entry?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_update_date?: string | null
          total_synced?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      security_csrf_tokens: {
        Row: {
          created_at: string
          expires_at: string
          purpose: string
          subject: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          purpose: string
          subject: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          purpose?: string
          subject?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: []
      }
      sla_escalation_settings: {
        Row: {
          company_db: string | null
          created_at: string
          enabled: boolean
          escalate_to_next_level: boolean
          fallback_email: string | null
          id: string
          max_escalations: number
          notify_email: boolean
          notify_in_app: boolean
          prefer_substitute: boolean
          repeat_business_hours: number
          sla_business_hours: number
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          enabled?: boolean
          escalate_to_next_level?: boolean
          fallback_email?: string | null
          id?: string
          max_escalations?: number
          notify_email?: boolean
          notify_in_app?: boolean
          prefer_substitute?: boolean
          repeat_business_hours?: number
          sla_business_hours?: number
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          created_at?: string
          enabled?: boolean
          escalate_to_next_level?: boolean
          fallback_email?: string | null
          id?: string
          max_escalations?: number
          notify_email?: boolean
          notify_in_app?: boolean
          prefer_substitute?: boolean
          repeat_business_hours?: number
          sla_business_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      sla_escalations: {
        Row: {
          company_db: string | null
          created_at: string
          currency: string | null
          doc_num: string | null
          doc_type: string | null
          escalation_index: number
          expense_id: string
          from_approver: string | null
          id: string
          level_from: number | null
          level_to: number | null
          notes: string | null
          pending_since: string | null
          sla_deadline: string | null
          substitution_id: string | null
          supplier_name: string | null
          target_kind: string
          to_approver: string | null
          total_amount: number | null
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          currency?: string | null
          doc_num?: string | null
          doc_type?: string | null
          escalation_index?: number
          expense_id: string
          from_approver?: string | null
          id?: string
          level_from?: number | null
          level_to?: number | null
          notes?: string | null
          pending_since?: string | null
          sla_deadline?: string | null
          substitution_id?: string | null
          supplier_name?: string | null
          target_kind: string
          to_approver?: string | null
          total_amount?: number | null
        }
        Update: {
          company_db?: string | null
          created_at?: string
          currency?: string | null
          doc_num?: string | null
          doc_type?: string | null
          escalation_index?: number
          expense_id?: string
          from_approver?: string | null
          id?: string
          level_from?: number | null
          level_to?: number | null
          notes?: string | null
          pending_since?: string | null
          sla_deadline?: string | null
          substitution_id?: string | null
          supplier_name?: string | null
          target_kind?: string
          to_approver?: string | null
          total_amount?: number | null
        }
        Relationships: []
      }
      submitted_document_hashes: {
        Row: {
          company_db: string | null
          created_at: string
          doc_type: string | null
          expense_id: string | null
          file_hash: string
          file_name: string | null
          file_size: number | null
          submitted_by: string
          supplier_label: string | null
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          doc_type?: string | null
          expense_id?: string | null
          file_hash: string
          file_name?: string | null
          file_size?: number | null
          submitted_by: string
          supplier_label?: string | null
        }
        Update: {
          company_db?: string | null
          created_at?: string
          doc_type?: string | null
          expense_id?: string | null
          file_hash?: string
          file_name?: string | null
          file_size?: number | null
          submitted_by?: string
          supplier_label?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          bill_to_block: string | null
          bill_to_building: string | null
          bill_to_city: string | null
          bill_to_country: string | null
          bill_to_state: string | null
          bill_to_street: string | null
          bill_to_zip: string | null
          card_code: string | null
          card_name: string
          card_type: string
          company_db: string
          created_at: string
          currency: string
          email: string | null
          federal_tax_id: string | null
          id: string
          is_active: boolean
          phone1: string | null
          phone2: string | null
          sap_last_synced_at: string | null
          sap_sync_error: string | null
          sap_sync_status: string
          source: string
          u_fgr_taxid0: string | null
          updated_at: string
        }
        Insert: {
          bill_to_block?: string | null
          bill_to_building?: string | null
          bill_to_city?: string | null
          bill_to_country?: string | null
          bill_to_state?: string | null
          bill_to_street?: string | null
          bill_to_zip?: string | null
          card_code?: string | null
          card_name: string
          card_type?: string
          company_db: string
          created_at?: string
          currency?: string
          email?: string | null
          federal_tax_id?: string | null
          id?: string
          is_active?: boolean
          phone1?: string | null
          phone2?: string | null
          sap_last_synced_at?: string | null
          sap_sync_error?: string | null
          sap_sync_status?: string
          source?: string
          u_fgr_taxid0?: string | null
          updated_at?: string
        }
        Update: {
          bill_to_block?: string | null
          bill_to_building?: string | null
          bill_to_city?: string | null
          bill_to_country?: string | null
          bill_to_state?: string | null
          bill_to_street?: string | null
          bill_to_zip?: string | null
          card_code?: string | null
          card_name?: string
          card_type?: string
          company_db?: string
          created_at?: string
          currency?: string
          email?: string | null
          federal_tax_id?: string | null
          id?: string
          is_active?: boolean
          phone1?: string | null
          phone2?: string | null
          sap_last_synced_at?: string | null
          sap_sync_error?: string | null
          sap_sync_status?: string
          source?: string
          u_fgr_taxid0?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      synapse_execution_log: {
        Row: {
          affected_count: number | null
          created_at: string
          details: Json | null
          id: string
          integration_key: string
          status: string
        }
        Insert: {
          affected_count?: number | null
          created_at?: string
          details?: Json | null
          id?: string
          integration_key: string
          status?: string
        }
        Update: {
          affected_count?: number | null
          created_at?: string
          details?: Json | null
          id?: string
          integration_key?: string
          status?: string
        }
        Relationships: []
      }
      synapse_global_settings: {
        Row: {
          created_at: string
          id: string
          integration_key: string
          interval_minutes: number
          is_active_global: boolean
          parameters: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          integration_key: string
          interval_minutes?: number
          is_active_global?: boolean
          parameters?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          integration_key?: string
          interval_minutes?: number
          is_active_global?: boolean
          parameters?: Json
          updated_at?: string
        }
        Relationships: []
      }
      synapse_integrations: {
        Row: {
          company_db: string | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          integration_key: string
          interval_minutes: number
          is_active: boolean
          last_run_at: string | null
          last_run_message: string | null
          last_run_status: string | null
          parameters: Json
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          integration_key: string
          interval_minutes?: number
          is_active?: boolean
          last_run_at?: string | null
          last_run_message?: string | null
          last_run_status?: string | null
          parameters?: Json
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          integration_key?: string
          interval_minutes?: number
          is_active?: boolean
          last_run_at?: string | null
          last_run_message?: string | null
          last_run_status?: string | null
          parameters?: Json
          updated_at?: string
        }
        Relationships: []
      }
      system_credentials: {
        Row: {
          company_db: string | null
          created_at: string
          credential_key: string
          credential_value: string
          id: string
          system_name: string
          updated_at: string
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          credential_key: string
          credential_value: string
          id?: string
          system_name: string
          updated_at?: string
        }
        Update: {
          company_db?: string | null
          created_at?: string
          credential_key?: string
          credential_value?: string
          id?: string
          system_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_group_assignments: {
        Row: {
          company_db: string | null
          created_at: string
          group_id: string
          id: string
          sap_email: string
        }
        Insert: {
          company_db?: string | null
          created_at?: string
          group_id: string
          id?: string
          sap_email: string
        }
        Update: {
          company_db?: string | null
          created_at?: string
          group_id?: string
          id?: string
          sap_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_group_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_identity_migration_backup: {
        Row: {
          created_at: string
          id: string
          payload: Json
          source_table: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload: Json
          source_table: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          source_table?: string
        }
        Relationships: []
      }
      user_licenses: {
        Row: {
          company_db: string
          created_at: string
          has_license: boolean
          id: string
          is_locked: boolean
          license_type: string | null
          notes: string | null
          updated_at: string
          user_code: string
          user_name: string
        }
        Insert: {
          company_db: string
          created_at?: string
          has_license?: boolean
          id?: string
          is_locked?: boolean
          license_type?: string | null
          notes?: string | null
          updated_at?: string
          user_code: string
          user_name: string
        }
        Update: {
          company_db?: string
          created_at?: string
          has_license?: boolean
          id?: string
          is_locked?: boolean
          license_type?: string | null
          notes?: string | null
          updated_at?: string
          user_code?: string
          user_name?: string
        }
        Relationships: []
      }
      user_management_segments: {
        Row: {
          company_db: string
          created_at: string
          id: string
          segment: string
          updated_at: string
          user_key: string
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          segment: string
          updated_at?: string
          user_key: string
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          segment?: string
          updated_at?: string
          user_key?: string
        }
        Relationships: []
      }
      user_phones: {
        Row: {
          company_db: string
          created_at: string
          id: string
          phone: string
          source: string
          updated_at: string
          user_code: string
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          phone: string
          source?: string
          updated_at?: string
          user_code: string
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          phone?: string
          source?: string
          updated_at?: string
          user_code?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          company_db: string
          created_at: string
          dismissed_until: string | null
          display_name: string | null
          email: string | null
          id: string
          notify_email_approvals: boolean
          notify_email_overdue: boolean
          notify_whatsapp_approvals: boolean
          notify_whatsapp_overdue: boolean
          phone: string | null
          sap_synced_at: string | null
          updated_at: string
          user_code: string
        }
        Insert: {
          avatar_url?: string | null
          company_db: string
          created_at?: string
          dismissed_until?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          notify_email_approvals?: boolean
          notify_email_overdue?: boolean
          notify_whatsapp_approvals?: boolean
          notify_whatsapp_overdue?: boolean
          phone?: string | null
          sap_synced_at?: string | null
          updated_at?: string
          user_code: string
        }
        Update: {
          avatar_url?: string | null
          company_db?: string
          created_at?: string
          dismissed_until?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          notify_email_approvals?: boolean
          notify_email_overdue?: boolean
          notify_whatsapp_approvals?: boolean
          notify_whatsapp_overdue?: boolean
          phone?: string | null
          sap_synced_at?: string | null
          updated_at?: string
          user_code?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sap_credentials: {
        Row: {
          company_db: string
          created_at: string
          id: string
          sap_password_encrypted: string
          sap_user: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_db: string
          created_at?: string
          id?: string
          sap_password_encrypted: string
          sap_user: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_db?: string
          created_at?: string
          id?: string
          sap_password_encrypted?: string
          sap_user?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_tour_state: {
        Row: {
          completed_at: string
          tour_key: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          tour_key: string
          user_id: string
        }
        Update: {
          completed_at?: string
          tour_key?: string
          user_id?: string
        }
        Relationships: []
      }
      watcher_runs: {
        Row: {
          last_finished_at: string | null
          last_message: string | null
          last_started_at: string | null
          last_status: string | null
          locked_at: string | null
          updated_at: string
          watcher_name: string
        }
        Insert: {
          last_finished_at?: string | null
          last_message?: string | null
          last_started_at?: string | null
          last_status?: string | null
          locked_at?: string | null
          updated_at?: string
          watcher_name: string
        }
        Update: {
          last_finished_at?: string | null
          last_message?: string | null
          last_started_at?: string | null
          last_status?: string | null
          locked_at?: string | null
          updated_at?: string
          watcher_name?: string
        }
        Relationships: []
      }
      whatsapp_approval_alerts: {
        Row: {
          approval_request_id: number
          approver_code: string
          company_db: string
          id: string
          payload: Json
          sent_at: string
          whatsapp_to: string
        }
        Insert: {
          approval_request_id: number
          approver_code: string
          company_db: string
          id?: string
          payload?: Json
          sent_at?: string
          whatsapp_to: string
        }
        Update: {
          approval_request_id?: number
          approver_code?: string
          company_db?: string
          id?: string
          payload?: Json
          sent_at?: string
          whatsapp_to?: string
        }
        Relationships: []
      }
      whatsapp_login_alerts: {
        Row: {
          company_db: string
          failure_key: string
          id: string
          payload: Json
          sent_at: string
          user_code: string
          whatsapp_to: string
        }
        Insert: {
          company_db: string
          failure_key: string
          id?: string
          payload?: Json
          sent_at?: string
          user_code: string
          whatsapp_to: string
        }
        Update: {
          company_db?: string
          failure_key?: string
          id?: string
          payload?: Json
          sent_at?: string
          user_code?: string
          whatsapp_to?: string
        }
        Relationships: []
      }
    }
    Views: {
      audit_trail_all: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          actor_role: string | null
          app_context: Json | null
          archived: boolean | null
          changed_cols: string[] | null
          id: number | null
          new_data: Json | null
          old_data: Json | null
          op: string | null
          prev_hash: string | null
          row_hash: string | null
          row_pk: Json | null
          schema_name: string | null
          session_jwt_sub: string | null
          table_name: string | null
          ts: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _audit_canonicalize: { Args: { _data: Json }; Returns: string }
      _audit_row_pk: { Args: { _row: Json; _tbl: unknown }; Returns: Json }
      _run_pagcorp_attachment_backfill: {
        Args: { _body?: Json }
        Returns: number
      }
      active_officials_for_substitute: {
        Args: { _substitute_identifier: string }
        Returns: {
          company_db: string
          cost_center_prefixes: string[]
          ends_at: string
          id: string
          official_email: string
          official_name: string
        }[]
      }
      approvals_feed_bundle: { Args: { _company_db: string }; Returns: Json }
      archive_audit_trail: {
        Args: { _batch_limit?: number; _keep_months?: number }
        Returns: {
          archived_count: number
          cutoff: string
        }[]
      }
      audit_trail_filter_options: {
        Args: never
        Returns: {
          actors: string[]
          tables: string[]
        }[]
      }
      business_hours_deadline: {
        Args: { _hours?: number; _start: string }
        Returns: string
      }
      can_access_audit_console: {
        Args: { _company_db: string }
        Returns: boolean
      }
      can_access_registration_attachment: {
        Args: { _object_name: string }
        Returns: boolean
      }
      can_manage_employee_integration: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_manage_nfse_recipients: { Args: never; Returns: boolean }
      canonical_user_key: { Args: { _value: string }; Returns: string }
      check_and_increment_rate_limit: {
        Args: { _key: string; _max: number; _window_seconds: number }
        Returns: {
          allowed: boolean
          current_count: number
          retry_after: number
        }[]
      }
      check_applicable_approval_rules:
        | {
            Args: {
              _company_db: string
              _cost_center?: string
              _total_amount: number
            }
            Returns: {
              has_rule: boolean
              rule_count: number
              sample_rule_id: string
            }[]
          }
        | {
            Args: {
              _category?: string
              _company_db: string
              _cost_center?: string
              _total_amount: number
            }
            Returns: {
              has_rule: boolean
              rule_count: number
              sample_rule_id: string
            }[]
          }
      check_expense_action_idempotency_consistency: {
        Args: never
        Returns: {
          completed: number
          expired_completed: number
          in_flight: number
          oldest_completed: string
          oldest_in_flight: string
          stale_in_flight: number
          total: number
        }[]
      }
      check_external_api_access: {
        Args: { _company_db: string; _user_code: string }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      close_access_review_campaign: {
        Args: { _campaign_id: string }
        Returns: undefined
      }
      consume_csrf_token: {
        Args: { _purpose: string; _subject: string; _token_hash: string }
        Returns: boolean
      }
      copilot_read_query: { Args: { p_sql: string }; Returns: Json }
      create_item_variante: {
        Args: { p_descricao: string; p_item_base_id: string }
        Returns: {
          codigo_completo: string
          created_at: string
          created_by: string | null
          descricao: string
          id: string
          item_base_id: string
          sequencial: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "item_variante"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_auth_email: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enable_audit_on: { Args: { _table: string }; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      find_open_registration_duplicate:
        | {
            Args: { p_tax_id?: string; p_title?: string; p_type: string }
            Returns: {
              already_linked: boolean
              created_at: string
              due_at: string
              id: string
              requester_email: string
              requester_name: string
              status: string
              title: string
            }[]
          }
        | {
            Args: {
              p_company_db?: string
              p_tax_id?: string
              p_title?: string
              p_type: string
            }
            Returns: {
              already_linked: boolean
              created_at: string
              due_at: string
              id: string
              requester_email: string
              requester_name: string
              status: string
              title: string
            }[]
          }
      get_db_query_metrics_by_screen: {
        Args: { _hours?: number }
        Returns: {
          avg_ms: number
          error_rate: number
          errors: number
          last_at: string
          max_ms: number
          p50_ms: number
          p95_ms: number
          p99_ms: number
          screen: string
          slow_count: number
          total: number
          total_ms: number
        }[]
      }
      get_db_query_metrics_by_target: {
        Args: { _hours?: number; _screen?: string }
        Returns: {
          avg_ms: number
          errors: number
          last_at: string
          max_ms: number
          operation: string
          p50_ms: number
          p95_ms: number
          p99_ms: number
          screens: number
          source: string
          target: string
          total: number
          total_ms: number
        }[]
      }
      get_db_slow_query_samples: {
        Args: { _hours?: number; _limit?: number; _min_ms?: number }
        Returns: {
          company_db: string
          duration_ms: number
          ok: boolean
          operation: string
          row_count: number
          screen: string
          source: string
          started_at: string
          status_code: number
          target: string
        }[]
      }
      get_default_expense_approver: {
        Args: { _company_db?: string }
        Returns: string
      }
      get_document_timeline: {
        Args: { _expense_id: string }
        Returns: {
          actor: string
          category: string
          detail: string
          meta: Json
          occurred_at: string
          source: string
          status: string
          title: string
        }[]
      }
      get_edge_function_metrics: {
        Args: { _hours?: number }
        Returns: {
          avg_ms: number
          error_rate: number
          errors: number
          function_name: string
          last_at: string
          p50_ms: number
          p95_ms: number
          p99_ms: number
          total: number
        }[]
      }
      get_edge_metrics_timeseries: {
        Args: { _bucket_minutes?: number; _function?: string; _hours?: number }
        Returns: {
          avg_ms: number
          bucket: string
          errors: number
          p95_ms: number
          total: number
        }[]
      }
      get_expense_read_metrics: {
        Args: { _hours?: number }
        Returns: {
          avg_ms: number
          avg_rows: number
          errors: number
          last_at: string
          max_ms: number
          p50_ms: number
          p95_ms: number
          screen: string
          total: number
        }[]
      }
      get_flow_last_login: {
        Args: never
        Returns: {
          email: string
          last_activity: string
          last_login: string
        }[]
      }
      get_flow_stage_metrics: {
        Args: { _days?: number }
        Returns: {
          avg_hours: number
          docs: number
          max_hours: number
          p50_hours: number
          p95_hours: number
          stage: string
          stage_order: number
        }[]
      }
      get_flow_user_activity: {
        Args: { _company_db?: string; _days?: number; _limit?: number }
        Returns: {
          action: string
          actor_email: string
          actor_name: string
          company_db: string
          detail: string
          entity_id: string
          entity_type: string
          ts: string
        }[]
      }
      get_flow_user_productivity: {
        Args: { _company_db?: string; _days?: number }
        Returns: {
          department: string
          doc_type: string
          docs_cancelados: number
          docs_criados: number
          docs_editados_unicos: number
          edicoes_feitas: number
          periodo: string
          user_email: string
          user_name: string
          valor_total: number
        }[]
      }
      get_integration_health: {
        Args: { _hours?: number }
        Returns: {
          avg_ms: number
          error_rate: number
          errors: number
          function_name: string
          last_at: string
          last_error_at: string
          last_error_code: string
          p50_ms: number
          p95_ms: number
          provider: string
          total: number
        }[]
      }
      get_integration_health_snapshot: {
        Args: { _minutes?: number }
        Returns: {
          error_rate: number
          errors: number
          last_at: string
          last_error_code: string
          p95_ms: number
          provider: string
          total: number
        }[]
      }
      get_my_idp_cost_center: {
        Args: { _sap_user_name?: string }
        Returns: string
      }
      get_nf_entrada_cache_by_po: {
        Args: { _company_db: string; _po_doc_entry: number }
        Returns: {
          cancelled: string
          card_code: string
          card_name: string
          doc_currency: string
          doc_date: string
          doc_due_date: string
          doc_entry: number
          doc_num: number
          doc_total: number
          document_status: string
          sap_update_date: string
          series: number
        }[]
      }
      get_notification_deliveries: {
        Args: {
          p_company_db?: string
          p_from?: string
          p_limit?: number
          p_to?: string
        }
        Returns: {
          channel: string
          company_db: string
          error_message: string
          event: string
          id: string
          metadata: Json
          occurred_at: string
          recipient: string
          source: string
          status: string
          subject: string
        }[]
      }
      get_pg_slow_queries: {
        Args: { _limit?: number }
        Returns: {
          calls: number
          max_ms: number
          mean_ms: number
          query: string
          rows_total: number
          total_ms: number
        }[]
      }
      get_sap_sync_health: { Args: { _last_n?: number }; Returns: Json }
      get_system_activity: {
        Args: { _hours?: number }
        Returns: {
          metric: string
          value: number
        }[]
      }
      has_module_action: {
        Args: {
          _action: string
          _company_db: string
          _module: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      insert_audit_log: {
        Args: {
          p_action: string
          p_actor_email?: string
          p_company_db?: string
          p_details?: Json
          p_entity_id?: string
          p_entity_type: string
        }
        Returns: undefined
      }
      is_email_allowed_for_omie_company: {
        Args: { _company_db: string; _email: string }
        Returns: boolean
      }
      is_employee_sync_company_allowed: {
        Args: { _company_db: string }
        Returns: boolean
      }
      is_erp_session_revoked: { Args: { _sid_hash: string }; Returns: boolean }
      is_erp_user_deprovisioned: {
        Args: { _company_db?: string; _user_key: string }
        Returns: boolean
      }
      is_idp_linked: { Args: { _email: string }; Returns: boolean }
      is_registration_agent: { Args: never; Returns: boolean }
      is_sap_code_idp_linked: {
        Args: { _sap_user_code: string }
        Returns: boolean
      }
      is_sap_user_admin: { Args: { _sap_username: string }; Returns: boolean }
      join_registration_request: {
        Args: { p_author_name?: string; p_note?: string; p_request_id: string }
        Returns: string
      }
      list_baixas_by_invoice: {
        Args: { p_company_db: string; p_invoice_doc_entry: number }
        Returns: {
          created_at: string
          criado_por_nome: string
          criado_por_user_code: string
          data_recebimento: string
          id: string
          sap_incoming_payment_doc_entry: number
          status: string
          valor_baixado: number
          valor_juros_multa: number
        }[]
      }
      log_permission_shadow: {
        Args: {
          _action: string
          _company_db: string
          _context?: Json
          _decision: string
          _identifier?: string
          _mode: string
          _module: string
          _reason?: string
        }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      open_access_review_campaign: {
        Args: {
          _due_at?: string
          _name: string
          _notes?: string
          _period_label: string
        }
        Returns: string
      }
      permissions_enforcement_mode: {
        Args: { _company_db?: string }
        Returns: string
      }
      preview_next_codigo: { Args: { p_item_base_id: string }; Returns: string }
      prune_db_query_metrics: { Args: never; Returns: undefined }
      prune_edge_function_metrics: { Args: never; Returns: undefined }
      prune_old_integration_data: { Args: never; Returns: undefined }
      purge_expense_action_idempotency: {
        Args: {
          _completed_retention_hours?: number
          _stale_reservation_minutes?: number
        }
        Returns: {
          completed_removed: number
          stale_removed: number
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reassign_approval_rule_safe: {
        Args: { _actor?: string; _expense_id: string; _new_rule_id: string }
        Returns: {
          finalized: boolean
          new_approver: string
          new_level_order: number
        }[]
      }
      record_db_query_metrics: { Args: { _events: Json }; Returns: number }
      register_external_api_failure: {
        Args: { _company_db: string; _reason: string; _user_code: string }
        Returns: undefined
      }
      register_external_api_success: {
        Args: { _company_db: string; _user_code: string }
        Returns: undefined
      }
      release_cancelled_document_hashes: {
        Args: { _hashes: string[] }
        Returns: {
          file_hash: string
        }[]
      }
      release_watcher_lock: {
        Args: { _message?: string; _name: string; _status?: string }
        Returns: undefined
      }
      require_idp_binding_enabled: { Args: never; Returns: boolean }
      sap_user_has_module: {
        Args: { _module_key: string; _sap_username: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      substitute_grants_for_me: {
        Args: { _substitute_identifier: string }
        Returns: {
          company_db: string
          cost_center_prefixes: string[]
          ends_at: string
          id: string
          official_email: string
          official_name: string
          starts_at: string
        }[]
      }
      try_watcher_lock: {
        Args: { _name: string; _ttl_minutes?: number }
        Returns: boolean
      }
      verify_audit_chain: {
        Args: { _limit?: number }
        Returns: {
          first_broken_id: number
          ok: boolean
          total_checked: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
      audit_console_divergence_type:
        | "missing_order"
        | "missing_grpo"
        | "missing_ap"
        | "value_mismatch"
        | "vendor_mismatch"
        | "payment_terms_mismatch"
        | "document_mismatch"
        | "date_anomaly"
        | "duplicate_suspected"
        | "fraud_flag"
        | "missing_request"
        | "missing_quotation"
        | "missing_approval"
        | "missing_invoice"
        | "missing_payment"
      audit_console_run_status: "pending" | "running" | "completed" | "failed"
      audit_console_severity: "low" | "medium" | "high" | "critical"
      audit_pay_agent_mode: "every_finding" | "batch_daily"
      audit_pay_baseline_source: "erp_flow_approval" | "sap_purchase_order"
      audit_pay_doc_type:
        | "ap_invoice"
        | "outgoing_payment"
        | "purchase_order"
        | "expense_flow"
      audit_pay_entity_type:
        | "fornecedor"
        | "solicitante"
        | "projeto"
        | "centro_custo"
        | "par_solicitante_aprovador"
      audit_pay_finding_type:
        | "desvio_valor"
        | "troca_fornecedor"
        | "troca_dados_bancarios"
        | "alteracao_itens"
        | "troca_centro_custo"
        | "troca_projeto"
        | "divergencia_solicitante"
        | "alteracao_pos_aprovacao"
        | "pagamento_sem_documento"
        | "pagamento_duplicado"
        | "pago_acima_aprovado"
      audit_pay_queue_status:
        | "pending"
        | "processing"
        | "done"
        | "error"
        | "skipped"
      audit_pay_severity: "conforme" | "baixa" | "media" | "alta" | "critica"
      audit_pay_signal_status:
        | "aberto"
        | "em_analise"
        | "confirmado_erro"
        | "confirmado_fraude"
        | "descartado"
      audit_pay_signal_type:
        | "reincidencia"
        | "fracionamento"
        | "alteracao_pos_aprovacao"
        | "fornecedor_novo_alto_valor"
        | "mudanca_bancaria_pre_pagamento"
        | "duplicidade"
        | "distribuicao_temporal_anomala"
        | "valores_redondos"
        | "conluio_solicitante_aprovador"
      expense_status:
        | "rascunho"
        | "pendente_aprovacao"
        | "aprovado"
        | "rejeitado"
        | "pc_lancado"
        | "nf_entrada"
        | "pagamento"
        | "finalizado"
        | "cancelado"
      fornecedor_tipo_pessoa: "pj" | "pf"
      item_tipo: "produto" | "servico"
      nf_entrada_status:
        | "pending_expense"
        | "awaiting_erpflow_approval"
        | "erpflow_rejected"
        | "awaiting_sap"
        | "sap_rejected"
        | "awaiting_invoice"
        | "completed"
        | "integration_error"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      audit_console_divergence_type: [
        "missing_order",
        "missing_grpo",
        "missing_ap",
        "value_mismatch",
        "vendor_mismatch",
        "payment_terms_mismatch",
        "document_mismatch",
        "date_anomaly",
        "duplicate_suspected",
        "fraud_flag",
        "missing_request",
        "missing_quotation",
        "missing_approval",
        "missing_invoice",
        "missing_payment",
      ],
      audit_console_run_status: ["pending", "running", "completed", "failed"],
      audit_console_severity: ["low", "medium", "high", "critical"],
      audit_pay_agent_mode: ["every_finding", "batch_daily"],
      audit_pay_baseline_source: ["erp_flow_approval", "sap_purchase_order"],
      audit_pay_doc_type: [
        "ap_invoice",
        "outgoing_payment",
        "purchase_order",
        "expense_flow",
      ],
      audit_pay_entity_type: [
        "fornecedor",
        "solicitante",
        "projeto",
        "centro_custo",
        "par_solicitante_aprovador",
      ],
      audit_pay_finding_type: [
        "desvio_valor",
        "troca_fornecedor",
        "troca_dados_bancarios",
        "alteracao_itens",
        "troca_centro_custo",
        "troca_projeto",
        "divergencia_solicitante",
        "alteracao_pos_aprovacao",
        "pagamento_sem_documento",
        "pagamento_duplicado",
        "pago_acima_aprovado",
      ],
      audit_pay_queue_status: [
        "pending",
        "processing",
        "done",
        "error",
        "skipped",
      ],
      audit_pay_severity: ["conforme", "baixa", "media", "alta", "critica"],
      audit_pay_signal_status: [
        "aberto",
        "em_analise",
        "confirmado_erro",
        "confirmado_fraude",
        "descartado",
      ],
      audit_pay_signal_type: [
        "reincidencia",
        "fracionamento",
        "alteracao_pos_aprovacao",
        "fornecedor_novo_alto_valor",
        "mudanca_bancaria_pre_pagamento",
        "duplicidade",
        "distribuicao_temporal_anomala",
        "valores_redondos",
        "conluio_solicitante_aprovador",
      ],
      expense_status: [
        "rascunho",
        "pendente_aprovacao",
        "aprovado",
        "rejeitado",
        "pc_lancado",
        "nf_entrada",
        "pagamento",
        "finalizado",
        "cancelado",
      ],
      fornecedor_tipo_pessoa: ["pj", "pf"],
      item_tipo: ["produto", "servico"],
      nf_entrada_status: [
        "pending_expense",
        "awaiting_erpflow_approval",
        "erpflow_rejected",
        "awaiting_sap",
        "sap_rejected",
        "awaiting_invoice",
        "completed",
        "integration_error",
        "cancelled",
      ],
    },
  },
} as const
