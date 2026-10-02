-- Family Calendar: database schema for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query > Run. Safe to run once on a fresh project.
-- Every table is locked down with Row Level Security: a signed-in user can only see data
-- belonging to a family they are a member of.

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
