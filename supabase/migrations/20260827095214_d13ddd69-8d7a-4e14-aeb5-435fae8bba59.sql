alter table public.advance_payments
  add column if not exists advance_type text not null default 'supplier';

alter table public.advance_payments
  drop constraint if exists advance_payments_advance_type_check;

alter table public.advance_payments
  add constraint advance_payments_advance_type_check
  check (advance_type in ('supplier', 'customer'));

create index if not exists idx_advance_payments_company_type_status
  on public.advance_payments (company_db, advance_type, status);