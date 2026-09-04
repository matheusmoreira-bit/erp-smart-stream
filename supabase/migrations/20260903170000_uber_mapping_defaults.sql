create table if not exists public.uber_user_mappings (
  id uuid primary key default gen_random_uuid(),
  company_db text not null,
  source text not null default 'uber',
  employee_key text not null,
  employee_name text not null,
  employee_email text,
  cost_center_code text not null,
  cost_center_label text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_db, source, employee_key)
);

create table if not exists public.uber_cost_center_project_defaults (
  id uuid primary key default gen_random_uuid(),
  company_db text not null,
  cost_center_code text not null,
  cost_center_label text,
  project_code text not null,
  project_name text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_db, cost_center_code)
);

create index if not exists idx_uber_user_mappings_company
  on public.uber_user_mappings (company_db, source);

create index if not exists idx_uber_cc_project_defaults_company
  on public.uber_cost_center_project_defaults (company_db);

drop trigger if exists update_uber_user_mappings_updated_at on public.uber_user_mappings;
create trigger update_uber_user_mappings_updated_at
  before update on public.uber_user_mappings
  for each row
  execute function public.update_updated_at_column();

drop trigger if exists update_uber_cc_project_defaults_updated_at on public.uber_cost_center_project_defaults;
create trigger update_uber_cc_project_defaults_updated_at
  before update on public.uber_cost_center_project_defaults
  for each row
  execute function public.update_updated_at_column();

alter table public.uber_user_mappings enable row level security;
alter table public.uber_cost_center_project_defaults enable row level security;

drop policy if exists "Authenticated can read uber user mappings" on public.uber_user_mappings;
create policy "Authenticated can read uber user mappings"
  on public.uber_user_mappings
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can upsert uber user mappings" on public.uber_user_mappings;
create policy "Authenticated can upsert uber user mappings"
  on public.uber_user_mappings
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can update uber user mappings" on public.uber_user_mappings;
create policy "Authenticated can update uber user mappings"
  on public.uber_user_mappings
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Admins can delete uber user mappings" on public.uber_user_mappings;
create policy "Admins can delete uber user mappings"
  on public.uber_user_mappings
  for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Authenticated can read uber project defaults" on public.uber_cost_center_project_defaults;
create policy "Authenticated can read uber project defaults"
  on public.uber_cost_center_project_defaults
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can upsert uber project defaults" on public.uber_cost_center_project_defaults;
create policy "Authenticated can upsert uber project defaults"
  on public.uber_cost_center_project_defaults
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can update uber project defaults" on public.uber_cost_center_project_defaults;
create policy "Authenticated can update uber project defaults"
  on public.uber_cost_center_project_defaults
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Admins can delete uber project defaults" on public.uber_cost_center_project_defaults;
create policy "Admins can delete uber project defaults"
  on public.uber_cost_center_project_defaults
  for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));
