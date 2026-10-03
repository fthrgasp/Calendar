-- Run once in Supabase > SQL Editor (existing projects). Fresh installs: the table is in schema.sql.
-- Lines the family adds to the message of the day, from Settings. Everyone in the family can read, add, and remove them.
create table if not exists public.custom_motds (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families on delete cascade,
  text       text not null check (char_length(text) between 1 and 200),
  spicy      boolean not null default false,
  author_id  uuid references public.members on delete set null,   -- who wrote it, shown as "— Gabby"
  created_at timestamptz not null default now()
);
alter table public.custom_motds enable row level security;
create policy "family reads lines" on public.custom_motds for select
  using (family_id in (select public.my_family_ids()));
create policy "family adds lines" on public.custom_motds for insert
  with check (family_id in (select public.my_family_ids())
              and (author_id is null or author_id in (select id from public.members where user_id = auth.uid())));  -- can't sign someone else's name
create policy "family removes lines" on public.custom_motds for delete
  using (family_id in (select public.my_family_ids()));

-- The daily backup now includes these lines too (same read-only export door as before; the password hash is untouched).
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
    'custom_motds',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from custom_motds t)
  );
end $$;


revoke all on function public.backup_export(text) from public;
grant execute on function public.backup_export(text) to anon, authenticated;
