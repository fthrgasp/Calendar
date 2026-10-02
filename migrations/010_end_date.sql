-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- Lets an event span several days (a weekend away, a trip). end_date is the last day, inclusive; null = a normal one-day event.
-- The app keeps working if uploaded before this runs; the "Ends on" date just can't be saved until the column exists.
-- The reminder function needs NO redeploy for this: reminders only depend on when an event starts.
alter table public.events add column if not exists end_date date
  check (end_date is null or end_date >= date);
