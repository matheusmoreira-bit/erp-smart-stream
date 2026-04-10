---
name: Security Architecture
description: RBAC with user_roles, has_role() security definer, restrictive RLS policies, audit_log table
type: feature
---

## Auth
- Supabase Auth (email/password) for admin panel at /admin/login
- useAuth hook: signIn, signUp, signOut, isAdmin check
- AdminRoute component verifies auth + admin role before rendering

## RBAC
- app_role enum: 'admin', 'user'
- user_roles table: user_id + role, unique constraint
- has_role(_user_id, _role) security definer function for RLS

## RLS Policies
- Admin-only tables (companies, system_credentials, synapse_*, idp_*, pagcorp_*): has_role(auth.uid(), 'admin')
- Operational tables (expenses, expense_items, expense_attachments, sap_cache): authenticated users
- approval_rules/levels: read by all authenticated, manage by admin
- audit_log: read by admin, insert by any authenticated

## Cascade Delete
- Trigger trg_cascade_delete_company_credentials: deletes system_credentials when company is deleted

## audit_log
- Columns: actor_id, actor_email, action, entity_type, entity_id, details (jsonb)
