# Project Memory

## Core
Admin auth uses Supabase Auth + user_roles table (app_role enum: admin, user). Never use localStorage for auth.
SYSTEMS config lives in src/lib/system-definitions.ts — import from there, never duplicate.
Company labels come from useCompanies hook (DB) — never hardcode COMPANY_LABELS.
sap-b1-proxy resolves service_layer_url dynamically from companies table.

## Memories
- [Users screen actions](mem://preferences/users-screen-actions.md) — Keep the Users screen action buttons minimal and icon-based instead of large filled buttons.
- [Security architecture](mem://features/security-architecture.md) — RBAC with has_role(), RLS per table, audit_log, cascade delete on companies.
