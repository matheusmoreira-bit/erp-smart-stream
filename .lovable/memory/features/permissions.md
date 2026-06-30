---
name: Permission System
description: Unified GLOBAL permission groups with module-level access control; one group per user, valid across all companies; backoffice admin = all access
type: feature
---

## Tables
- permission_groups: name, description (global)
- permission_group_modules: group_id + module_key (many-to-many)
- user_group_assignments: sap_email + group_id (GLOBAL — company_db always NULL; unique on (sap_email, group_id))

## Module Keys (unified, same for all ERPs)
analytics, analytics_payments, expenses, approvals, approval_rules, pagcorp, users, synapse, credentials, audit_log, ...

## Default Access (no group assigned)
- expenses only

## Default Group (seeded)
- Usuário: expenses only

## Rules
- Permission groups are global (not ERP-specific, not company-specific)
- User assignments are GLOBAL — one group per sap_email, valid across all companies
- Backoffice admin (user_roles.role = 'admin') gets ALL modules in ALL companies
- SAP superuser gets ALL modules
- OMIE companies bypass checks (see omie-open-modules)

## Guards
- MainMenu: shows lock icon on inaccessible modules, disables navigation
- Admin panel "Permissões" tab: single global view (no company selector); SAP users aggregated/deduped from all sap_cache rows

## Hook: useModuleAccess(moduleKey?)
Returns { hasAccess, loading, userModules } based on current SAP session email — looks up global assignment, no company filter.
