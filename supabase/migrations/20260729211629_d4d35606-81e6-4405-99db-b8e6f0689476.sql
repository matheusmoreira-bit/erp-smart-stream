
-- Fase 4: remoção de leitura anônima em tabelas internas (pentest 2026-07)
drop policy if exists "Anyone can view expense audit_log" on public.audit_log;
drop policy if exists "Read collaborator_profiles" on public.collaborator_profiles;
create policy "Authenticated read collaborator_profiles" on public.collaborator_profiles for select to authenticated using (true);
drop policy if exists "Anon can read approval log" on public.expense_approval_log;
drop policy if exists "Anon read nf_entrada_imports" on public.nf_entrada_imports;
drop policy if exists "Anon read nf_entrada_logs" on public.nf_entrada_logs;
drop policy if exists "Anon can read pagcorp integration logs for SAP session flow" on public.pagcorp_integration_log;
drop policy if exists "Anyone can read nondeductible cards" on public.pagcorp_nondeductible_cards;
create policy "Authenticated read nondeductible cards" on public.pagcorp_nondeductible_cards for select to authenticated using (true);
drop policy if exists "App can read pagcorp_settlement_accounts" on public.pagcorp_settlement_accounts;
create policy "Authenticated read pagcorp_settlement_accounts" on public.pagcorp_settlement_accounts for select to authenticated using (true);
drop policy if exists "Anon can read sap_cache" on public.sap_cache;
drop policy if exists "Anon can delete sap_cache" on public.sap_cache;
drop policy if exists "Anon can read synapse_execution_log" on public.synapse_execution_log;
drop policy if exists "Anon can read synapse_global_settings" on public.synapse_global_settings;
drop policy if exists "Anon can read synapse_integrations" on public.synapse_integrations;
drop policy if exists "Anon can read approval_rules" on public.approval_rules;
drop policy if exists "Anon can read approval_rule_levels" on public.approval_rule_levels;

revoke select on public.audit_log, public.collaborator_profiles, public.expense_approval_log,
  public.nf_entrada_imports, public.nf_entrada_logs, public.pagcorp_integration_log,
  public.pagcorp_nondeductible_cards, public.pagcorp_settlement_accounts, public.sap_cache,
  public.synapse_execution_log, public.synapse_global_settings, public.synapse_integrations,
  public.approval_rules, public.approval_rule_levels from anon;
revoke delete on public.sap_cache from anon;
