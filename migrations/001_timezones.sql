-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
alter table public.members add column if not exists tz text;  -- IANA zone, e.g. America/Chicago; null = use the device's zone
alter table public.events  add column if not exists tz text;  -- zone the event time was entered in; null = no conversion
