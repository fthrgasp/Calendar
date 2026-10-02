-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
alter table public.push_subscriptions add column if not exists tz text;  -- the device's time zone, so reminders show the right local time

-- Remembers which reminders were already sent, so none goes out twice.
create table if not exists public.sent_reminders (
  event_id  uuid not null,
  member_id uuid not null,
  occ_start timestamptz not null,
  minutes   int not null,
  sent_at   timestamptz not null default now(),
  primary key (event_id, member_id, occ_start, minutes)
);
alter table public.sent_reminders enable row level security;  -- no policies: only the server function (service role) can touch it
