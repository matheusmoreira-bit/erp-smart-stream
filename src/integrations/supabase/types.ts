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
          company_db: string | null
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
          company_db?: string | null
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
          company_db?: string | null
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
      companies: {
        Row: {
          company_db: string
          created_at: string
          default_currency: string
          display_name: string
          erp_type: string
          id: string
          is_active: boolean
          logo_url: string | null
          service_layer_url: string | null
          targets: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          company_db: string
          created_at?: string
          default_currency?: string
          display_name: string
          erp_type?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          service_layer_url?: string | null
          targets?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          company_db?: string
          created_at?: string
          default_currency?: string
          display_name?: string
          erp_type?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          service_layer_url?: string | null
          targets?: Json
          timezone?: string
          updated_at?: string
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
      expense_items: {
        Row: {
          cost_center: string | null
          created_at: string
          description: string
          expense_id: string
          id: string
          item_code: string | null
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
      expenses: {
        Row: {
          branch_id: number
          company_db: string | null
          cost_center: string | null
          created_at: string
          created_by_email: string | null
          currency: string
          current_approver: string | null
          id: string
          origin: string
          project: string | null
          remarks: string | null
          requester_email: string | null
          requester_name: string
          sap_attachment_entry: number | null
          sap_attachment_link_status: string | null
          sap_attachment_status: string | null
          sap_doc_entry: number | null
          sap_doc_num: number | null
          sap_integration_error: string | null
          sap_integration_last_attempt_at: string | null
          sap_purchase_order_status: string | null
          status: Database["public"]["Enums"]["expense_status"]
          supplier_code: string | null
          supplier_name: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_id?: number
          company_db?: string | null
          cost_center?: string | null
          created_at?: string
          created_by_email?: string | null
          currency?: string
          current_approver?: string | null
          id?: string
          origin?: string
          project?: string | null
          remarks?: string | null
          requester_email?: string | null
          requester_name: string
          sap_attachment_entry?: number | null
          sap_attachment_link_status?: string | null
          sap_attachment_status?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_integration_error?: string | null
          sap_integration_last_attempt_at?: string | null
          sap_purchase_order_status?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          supplier_code?: string | null
          supplier_name: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          branch_id?: number
          company_db?: string | null
          cost_center?: string | null
          created_at?: string
          created_by_email?: string | null
          currency?: string
          current_approver?: string | null
          id?: string
          origin?: string
          project?: string | null
          remarks?: string | null
          requester_email?: string | null
          requester_name?: string
          sap_attachment_entry?: number | null
          sap_attachment_link_status?: string | null
          sap_attachment_status?: string | null
          sap_doc_entry?: number | null
          sap_doc_num?: number | null
          sap_integration_error?: string | null
          sap_integration_last_attempt_at?: string | null
          sap_purchase_order_status?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          supplier_code?: string | null
          supplier_name?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      idp_user_mapping: {
        Row: {
          created_at: string
          id: string
          idp_display_name: string | null
          idp_email: string | null
          idp_provider: string
          idp_user_id: string | null
          linked_at: string | null
          sap_email: string | null
          sap_user_code: string
          sap_user_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          idp_display_name?: string | null
          idp_email?: string | null
          idp_provider?: string
          idp_user_id?: string | null
          linked_at?: string | null
          sap_email?: string | null
          sap_user_code: string
          sap_user_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          idp_display_name?: string | null
          idp_email?: string | null
          idp_provider?: string
          idp_user_id?: string | null
          linked_at?: string | null
          sap_email?: string | null
          sap_user_code?: string
          sap_user_name?: string | null
          status?: string
          updated_at?: string
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
      permission_group_modules: {
        Row: {
          created_at: string
          group_id: string
          id: string
          module_key: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          module_key: string
        }
        Update: {
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
          company_db: string | null
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
          company_db?: string | null
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
          company_db?: string | null
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
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
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
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    },
  },
} as const
