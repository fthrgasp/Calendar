-- Family Calendar: database schema for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query > Run. Safe to run once on a fresh project.
-- Every table is locked down with Row Level Security: a signed-in user can only see data
-- belonging to a family they are a member of.
-- After this, three setup files need secrets or the reminder function first, so they stay separate:
--   secrets/005_backup_READY.sql (the backup password), migrations/004_push_schedule.sql (reminders, once the
--   send-reminders function is deployed), then migrations/015_cron_cleanup.sql.

create table public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- A "member" is a person on the calendar. user_id is null for people without a login (e.g. a young kid).
create table public.members (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references public.families on delete cascade,
  user_id           uuid references auth.users on delete set null,
  name              text not null,
  color             text not null default '#2b6cb0',
  default_reminders int[] not null default '{60}',   -- minutes before an event
  time_format       text,                            -- '12' or '24'; null = 12
  tz                text,                            -- IANA zone, e.g. America/Chicago; null = use the device's zone
  created_at        timestamptz not null default now(),
  unique (family_id, user_id)
);

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families on delete cascade,
  title        text not null,
  date         date not null,
  all_day      boolean not null default false,
  start_time   time,
  end_time     time,
  location     text not null default '',
  notes        text not null default '',
  repeat       text not null default 'none' check (repeat in ('none','daily','weekly','monthly','yearly')),
  repeat_until date,
  tz           text,                           -- zone the time was entered in; null = no conversion
  repeat_every int not null default 1 check (repeat_every between 1 and 52), -- weekly events: every N weeks (rotating schedules)
  end_date     date check (end_date is null or end_date >= date), -- multi-day events: last day (inclusive); null = one day
  weekdays     int[] check (weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]), -- weekly events on several days: 0=Sun..6=Sat; null = just the start date's weekday
  show_years   boolean not null default false, -- yearly events: show "turns 36" / "5th anniversary" (date = the real start date)
  created_by   uuid references public.members on delete set null,
  deleted_at   timestamptz,                           -- soft delete: set instead of removing the row
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.events (family_id, date);

create table public.event_members (
  event_id  uuid not null references public.events on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  primary key (event_id, member_id)
);

-- Each person's own reminders for an event (minutes before start).
create table public.reminders (
  event_id  uuid not null references public.events on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  minutes   int[] not null default '{}',
  primary key (event_id, member_id)
);

-- One row per device that opted in to push notifications.
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  tz         text,                                     -- device time zone, used to show reminder times
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Which reminders were already sent (server-only: no policies, so only the service role can use it).
create table public.sent_reminders (
  event_id  uuid not null,
  member_id uuid not null,
  occ_start timestamptz not null,
  minutes   int not null,
  sent_at   timestamptz not null default now(),
  primary key (event_id, member_id, occ_start, minutes)
);

create table public.invites (
  code       text primary key,
  family_id  uuid not null references public.families on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz
);

-- keep updated_at fresh
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------- access rules ----------
create function public.my_family_ids() returns setof uuid
  language sql stable security definer set search_path = public as
  $$ select family_id from public.members where user_id = auth.uid() $$;

alter table public.families           enable row level security;
alter table public.members            enable row level security;
alter table public.events             enable row level security;
alter table public.event_members      enable row level security;
alter table public.reminders          enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.invites            enable row level security;
alter table public.sent_reminders     enable row level security;

create policy "own family" on public.families for select using (id in (select public.my_family_ids()));
create policy "family members" on public.members for all
  using (family_id in (select public.my_family_ids()))
  with check (family_id in (select public.my_family_ids()));
create policy "family events" on public.events for all
  using (family_id in (select public.my_family_ids()))
  with check (family_id in (select public.my_family_ids()));
create policy "family event people" on public.event_members for all
  using (exists (select 1 from public.events e where e.id = event_id and e.family_id in (select public.my_family_ids())))
  with check (exists (select 1 from public.events e where e.id = event_id and e.family_id in (select public.my_family_ids())));
create policy "my reminders" on public.reminders for all
  using (member_id in (select id from public.members where user_id = auth.uid()))
  with check (member_id in (select id from public.members where user_id = auth.uid())
              and exists (select 1 from public.events e where e.id = event_id and e.family_id in (select public.my_family_ids())));
create policy "my devices" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "family invites" on public.invites for select using (family_id in (select public.my_family_ids()));

-- ---------- sign-up flows (run as the database, not the user, so they can create the first rows) ----------
create function public.create_family(family_name text, my_name text, my_color text default '#2b6cb0')
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into families (name) values (family_name) returning id into fid;
  insert into members (family_id, user_id, name, color) values (fid, auth.uid(), my_name, my_color);
  return fid;
end $$;

create function public.create_invite(fid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if fid not in (select my_family_ids()) then raise exception 'not in this family'; end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into invites (code, family_id) values (c, fid);
  return c;
end $$;

create function public.join_family(invite_code text, my_name text, my_color text default '#d53f8c')
returns uuid language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from invites where code = invite_code and used_at is null and expires_at > now() for update;
  if not found then raise exception 'invite is invalid or expired'; end if;
  insert into members (family_id, user_id, name, color) values (inv.family_id, auth.uid(), my_name, my_color)
    on conflict (family_id, user_id) do nothing;
  update invites set used_at = now() where code = invite_code;
  return inv.family_id;
end $$;

revoke all on function public.create_family, public.create_invite, public.join_family from public, anon;
grant execute on function public.create_family, public.create_invite, public.join_family to authenticated;

-- Private calendar-feed link (Google/Apple Calendar subscribe to it). The token is the only credential; regenerate any time.
create table public.feed_tokens (
  family_id  uuid primary key references public.families on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);
alter table public.feed_tokens enable row level security;
create policy "family reads feed token" on public.feed_tokens for select using (family_id in (select public.my_family_ids()));
create function public.rotate_feed_token() returns text
language plpgsql security definer set search_path = public as $$
declare fid uuid; t text;
begin
  select family_id into fid from members where user_id = auth.uid() limit 1;
  if fid is null then raise exception 'not in a family'; end if;
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into feed_tokens (family_id, token) values (fid, t) on conflict (family_id) do update set token = excluded.token, created_at = now();
  return t;
end $$;
revoke all on function public.rotate_feed_token() from public, anon;
grant execute on function public.rotate_feed_token() to authenticated;

-- Lines the family adds to the message of the day (Settings). Anyone in the family can read, add, and remove them.
create table public.custom_motds (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families on delete cascade,
  text       text not null check (char_length(text) between 1 and 200),
  spicy      boolean not null default false,
  author_id  uuid references public.members on delete set null,
  created_at timestamptz not null default now()
);
alter table public.custom_motds enable row level security;
create policy "family reads lines" on public.custom_motds for select using (family_id in (select public.my_family_ids()));
create policy "family adds lines" on public.custom_motds for insert
  with check (family_id in (select public.my_family_ids()) and (author_id is null or author_id in (select id from public.members where user_id = auth.uid())));
create policy "family removes lines" on public.custom_motds for delete using (family_id in (select public.my_family_ids()));

-- Skip or change one day of a repeating event; anything left null follows the series.
create table public.event_exceptions (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events on delete cascade,
  original_date date not null,
  skipped       boolean not null default false,
  new_date      date,
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

-- Heartbeat written by the reminder function; the app warns if it goes quiet.
create table public.system_status (
  key      text primary key,
  last_run timestamptz not null default now(),
  detail   text
);
alter table public.system_status enable row level security;
create policy "signed-in users read status" on public.system_status for select to authenticated using (true);

-- ---------- daily backup ----------
-- Read-only export door for scripts/backup.sh. The password's hash goes in with secrets/005_backup_READY.sql.
create table public.backup_config (
  id          int primary key default 1 check (id = 1),   -- exactly one row
  secret_hash text not null                               -- sha256 of the backup password (the password itself is never stored)
);
alter table public.backup_config enable row level security;   -- no policies: unreadable through the API

create function public.backup_export(secret text) returns jsonb
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

-- ---------- Saving an event is all-or-nothing.
-- The app used to save in four separate steps (the event, clear its people, add its people back, your reminders). If one
-- failed partway, say a dropped connection after "clear its people", the event was left with nobody on it, and nobody got
-- reminded. This does the same four steps as one transaction: they all happen, or none do.
-- It runs with the caller's own permissions (security invoker), so the usual rules apply unchanged: anyone in the family
-- can save any family event, and each person can only set their own reminders.
create or replace function public.save_event(ev jsonb, who jsonb, my_member uuid, my_minutes jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare r events;
begin
  r := jsonb_populate_record(null::events, ev);
  insert into events (id, family_id, title, date, all_day, start_time, end_time, location, notes, repeat, repeat_until, tz,
                      show_years, repeat_every, weekdays, end_date, created_by, deleted_at)
  values (r.id, r.family_id, r.title, r.date, coalesce(r.all_day, false), r.start_time, r.end_time, coalesce(r.location, ''),
          coalesce(r.notes, ''), coalesce(r.repeat, 'none'), r.repeat_until, r.tz, coalesce(r.show_years, false),
          coalesce(r.repeat_every, 1), r.weekdays, r.end_date, r.created_by, r.deleted_at)
  on conflict (id) do update set
    family_id = excluded.family_id, title = excluded.title, date = excluded.date, all_day = excluded.all_day,
    start_time = excluded.start_time, end_time = excluded.end_time, location = excluded.location, notes = excluded.notes,
    repeat = excluded.repeat, repeat_until = excluded.repeat_until, tz = excluded.tz, show_years = excluded.show_years,
    repeat_every = excluded.repeat_every, weekdays = excluded.weekdays, end_date = excluded.end_date,
    created_by = excluded.created_by, deleted_at = excluded.deleted_at;
  delete from event_members where event_id = r.id;
  insert into event_members (event_id, member_id) select r.id, m::uuid from jsonb_array_elements_text(who) m;
  insert into reminders (event_id, member_id, minutes)
    values (r.id, my_member, array(select m::int from jsonb_array_elements_text(my_minutes) m))
    on conflict (event_id, member_id) do update set minutes = excluded.minutes;
end $$;
revoke all on function public.save_event(jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.save_event(jsonb, jsonb, uuid, jsonb) to authenticated;

-- ---------- Who a person IS can't be changed from the app; everything else about them still can.
-- Anyone in the family can still rename people, change colors, reminders, time zone and display, and add someone without
-- a login. What's locked is a person's login (user_id) and family (family_id): changing those from the app could quietly
-- move someone's account onto another person or into another family. Sign-up and invites set them, and they run as the
-- database, so they're unaffected.
-- Note for later: a new column added to members has to be added to the lists below before the app can save it.
revoke insert, update on public.members from anon, authenticated;
grant insert (family_id, name, color, default_reminders, tz, time_format) on public.members to authenticated;
grant update (name, color, default_reminders, tz, time_format) on public.members to authenticated;
