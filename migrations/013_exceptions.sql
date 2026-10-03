-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- Lets one day of a repeating event be skipped or changed without touching the rest of the series
-- (a shift swap, a day off, a one-time different time). Whatever is left null just follows the series.
create table if not exists public.event_exceptions (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events on delete cascade,
  original_date date not null,                 -- which occurrence this is about (its date in the series' own zone)
  skipped       boolean not null default false,
  new_date      date,                          -- moved to another day
  title         text,
  start_time    time,
  end_time      time,
  all_day       boolean,
  location      text,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (event_id, original_date)
);
alter table public.event_exceptions enable row level security;
create policy "family event exceptions" on public.event_exceptions for all
  using (exists (select 1 from public.events e where e.id = event_id and e.family_id in (select public.my_family_ids())))
  with check (exists (select 1 from public.events e where e.id = event_id and e.family_id in (select public.my_family_ids())));

-- The daily backup now includes these too (same read-only export door; the password hash is untouched).
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
    'reminders',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from reminders t),
    'custom_motds',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from custom_motds t),
    'event_exceptions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from event_exceptions t)
  );
end $$;



revoke all on function public.backup_export(text) from public;
grant execute on function public.backup_export(text) to anon, authenticated;
