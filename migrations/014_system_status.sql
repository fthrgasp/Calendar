-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- A heartbeat: the reminder function stamps the time of each successful run here, and the app's Settings screen
-- shows a warning if it goes quiet (for example if "Verify JWT" flips back on and silently stops reminders).
create table if not exists public.system_status (
  key      text primary key,
  last_run timestamptz not null default now(),
  detail   text
);
alter table public.system_status enable row level security;
create policy "signed-in users read status" on public.system_status for select to authenticated using (true);   -- only the server function writes
