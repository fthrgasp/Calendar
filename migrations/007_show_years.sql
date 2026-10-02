-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- Lets yearly events count the years ("turns 36"). The app keeps working if you upload it before running this;
-- the checkbox just can't be saved until the column exists.
alter table public.events add column if not exists show_years boolean not null default false;
