---
name: Permission System
description: Customizable permission groups with module-level access control, SAP email-based user assignments
type: feature
---

## Tables
- permission_groups: name, description (customizable by admin)
- permission_group_modules: group_id + module_key (many-to-many)
- user_group_assignments: sap_email + group_id

## Module Keys
analytics, analytics_payments, expenses, approvals, approval_rules, pagcorp, users, synapse, credentials, audit_log

## Default Access (no group assigned)
- analytics (fluxo only)
- expenses

## Default Groups (seeded)
- admin: all modules
- financeiro: analytics, analytics_payments, expenses
- pagcorp: analytics, expenses, pagcorp

## Guards
- MainMenu: shows lock icon on inaccessible modules, disables navigation
- Analytics: hides "Análise de Pagamentos" tab unless user has analytics_payments
- Admin panel: "Permissões" tab for managing groups and user assignments

## Hook: useModuleAccess(moduleKey?)
Returns { hasAccess, loading, userModules } based on current SAP session email
