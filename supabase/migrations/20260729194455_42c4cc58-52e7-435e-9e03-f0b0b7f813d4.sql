
create table if not exists public.kyp_providers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.kyp_providers to authenticated;
grant all on public.kyp_providers to service_role;
alter table public.kyp_providers enable row level security;
create policy "kyp_providers_select" on public.kyp_providers for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_module_action(auth.uid(), null, 'kyp', 'view'));
create policy "kyp_providers_admin" on public.kyp_providers for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

insert into public.kyp_providers (code, nome) values ('BECOMPLIANCE','BeCompliance')
  on conflict (code) do nothing;

create table if not exists public.empresa_kyp_config (
  company_id uuid primary key references public.companies(id) on delete cascade,
  kyp_provider_id uuid not null references public.kyp_providers(id),
  ativo boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
grant select on public.empresa_kyp_config to authenticated;
grant all on public.empresa_kyp_config to service_role;
alter table public.empresa_kyp_config enable row level security;
create policy "empresa_kyp_config_select" on public.empresa_kyp_config for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_module_action(auth.uid(), null, 'kyp', 'view'));
create policy "empresa_kyp_config_admin" on public.empresa_kyp_config for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger empresa_kyp_config_updated_at before update on public.empresa_kyp_config
  for each row execute function public.update_updated_at_column();

-- default BECOMPLIANCE para empresas existentes e novas
insert into public.empresa_kyp_config (company_id, kyp_provider_id)
select c.id, p.id from public.companies c
cross join (select id from public.kyp_providers where code='BECOMPLIANCE') p
on conflict (company_id) do nothing;

create or replace function public.kyp_default_company_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_provider uuid;
begin
  select id into v_provider from public.kyp_providers where code = 'BECOMPLIANCE' limit 1;
  if v_provider is not null then
    insert into public.empresa_kyp_config (company_id, kyp_provider_id)
    values (new.id, v_provider)
    on conflict (company_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger companies_kyp_default after insert on public.companies
  for each row execute function public.kyp_default_company_config();

create table if not exists public.kyp_fornecedores (
  id uuid primary key default gen_random_uuid(),
  documento text unique not null,
  tipo_pessoa text not null check (tipo_pessoa in ('PF','PJ')),
  nome text,
  status_atual text not null default 'PENDENTE' check (status_atual in ('PENDENTE','VALIDO','BLOQUEADO','ERRO')),
  ultima_avaliacao_em timestamptz,
  proxima_expiracao_em timestamptz,
  kyp_provider_id uuid references public.kyp_providers(id),
  provider_ref_id text,
  provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.kyp_fornecedores to authenticated;
grant all on public.kyp_fornecedores to service_role;
alter table public.kyp_fornecedores enable row level security;
create policy "kyp_fornecedores_select" on public.kyp_fornecedores for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_module_action(auth.uid(), null, 'kyp', 'view'));
create policy "kyp_fornecedores_admin" on public.kyp_fornecedores for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger kyp_fornecedores_updated_at before update on public.kyp_fornecedores
  for each row execute function public.update_updated_at_column();
create index if not exists kyp_fornecedores_status_idx on public.kyp_fornecedores (status_atual, proxima_expiracao_em);

create table if not exists public.kyp_fornecedor_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  kyp_fornecedor_id uuid not null references public.kyp_fornecedores(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  company_db text not null,
  erp text not null check (erp in ('SAP','OMIE')),
  codigo_fornecedor_erp text not null,
  nome_erp text,
  bloqueado_em timestamptz,
  detalhes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_db, erp, codigo_fornecedor_erp)
);
grant select on public.kyp_fornecedor_ocorrencias to authenticated;
grant all on public.kyp_fornecedor_ocorrencias to service_role;
alter table public.kyp_fornecedor_ocorrencias enable row level security;
create policy "kyp_ocorrencias_select" on public.kyp_fornecedor_ocorrencias for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_module_action(auth.uid(), null, 'kyp', 'view'));
create policy "kyp_ocorrencias_admin" on public.kyp_fornecedor_ocorrencias for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create trigger kyp_ocorrencias_updated_at before update on public.kyp_fornecedor_ocorrencias
  for each row execute function public.update_updated_at_column();
create index if not exists kyp_ocorrencias_forn_idx on public.kyp_fornecedor_ocorrencias (kyp_fornecedor_id);

create table if not exists public.kyp_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  kyp_fornecedor_id uuid references public.kyp_fornecedores(id) on delete cascade,
  documento text,
  tipo_pessoa text,
  nome text,
  kyp_provider_id uuid references public.kyp_providers(id),
  provider_code text,
  executado_em timestamptz not null default now(),
  acao text not null check (acao in ('NOOP','CREATE','DEACTIVATE','ERRO')),
  motivo text,
  provider_ref_id text,
  provider_response jsonb,
  empresas_afetadas text[] not null default '{}',
  sucesso boolean not null default true,
  disparado_por text
);
grant select on public.kyp_avaliacoes to authenticated;
grant all on public.kyp_avaliacoes to service_role;
alter table public.kyp_avaliacoes enable row level security;
create policy "kyp_avaliacoes_select" on public.kyp_avaliacoes for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_module_action(auth.uid(), null, 'kyp', 'view'));
create policy "kyp_avaliacoes_admin" on public.kyp_avaliacoes for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create index if not exists kyp_avaliacoes_exec_idx on public.kyp_avaliacoes (executado_em desc);
