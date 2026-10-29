create table if not exists public.gdrive_attachment_notice_state (
  singleton boolean primary key default true check (singleton),
  initial_sent_at timestamptz,
  completed_at timestamptz,
  last_check jsonb,
  updated_at timestamptz not null default now()
);
alter table public.gdrive_attachment_notice_state enable row level security;
revoke all on public.gdrive_attachment_notice_state from anon, authenticated;
grant all on public.gdrive_attachment_notice_state to service_role;

create or replace function public.storage_backup_inventory(p_buckets text[])
returns table(bucket_id text, name text, bytes bigint)
language sql stable security definer set search_path = public, storage
as $$
  select o.bucket_id::text, o.name::text, coalesce((o.metadata->>'size')::bigint, 0)
  from storage.objects o where o.bucket_id = any(p_buckets);
$$;
revoke all on function public.storage_backup_inventory(text[]) from public, anon, authenticated;
grant execute on function public.storage_backup_inventory(text[]) to service_role;