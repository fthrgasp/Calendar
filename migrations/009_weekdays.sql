-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- Lets weekly events repeat on several days of the week (Mon-Fri, Mon/Wed/Fri...). 0 = Sunday ... 6 = Saturday.
-- The app keeps working if uploaded before this runs; picking extra days just can't be saved until the column exists.
alter table public.events add column if not exists weekdays int[]
  check (weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]);
