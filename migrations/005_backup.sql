-- Read-only export door for the daily backup job. Run once in Supabase > SQL Editor.
-- After running this file, run the matching "READY" file (secrets/005_backup_READY.sql) that stores the backup password's hash.

create table if not exists public.backup_config (
  id          int primary key default 1 check (id = 1),   -- exactly one row
  secret_hash text not null                               -- sha256 of the backup password (the password itself is never stored)
);
alter table public.backup_config enable row level security;   -- no policies: unreadable through the API

create or replace function public.backup_export(secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from backup_config where secret_hash = encode(sha256(convert_to(secret, 'utf8')), 'hex')) then
    perform pg_sleep(1);                                   -- slow down guessing
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at',   now(),
    'families',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from families t),
    'members',       (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from members t),
    'events',        (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from events t),
    'event_members', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from event_members t),
    'reminders',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from reminders t)
  );
end $$;

revoke all on function public.backup_export(text) from public;
grant execute on function public.backup_export(text) to anon, authenticated;
