---
name: Permission System
description: Unified permission groups with module-level access control, per-company user assignments, backoffice admin = all access
type: feature
---

## Tables
- permission_groups: name, description (shared across all companies/ERPs)
- permission_group_modules: group_id + module_key (many-to-many)
- user_group_assignments: sap_email + group_id + company_db (per-company)

## Module Keys (unified, same for all ERPs)
analytics, analytics_payments, expenses, approvals, approval_rules, pagcorp, users, synapse, credentials, audit_log

## Default Access (no group assigned)
- expenses only

## Default Group (seeded)
- Usuário: expenses only

## Rules
- Permission groups are global (not ERP-specific)
- User assignments are per company_db
- Backoffice admin (user_roles.role = 'admin') gets ALL modules in ALL companies
- SAP superuser gets ALL modules
- Assignments filter by company_db OR null (global)

## Guards
- MainMenu: shows lock icon on inaccessible modules, disables navigation
- Analytics: hides "Análise de Pagamentos" tab unless user has analytics_payments
- Admin panel: "Permissões" tab for managing groups and user assignments

## Hook: useModuleAccess(moduleKey?)
Returns { hasAccess, loading, userModules } based on current SAP session email + companyDB
