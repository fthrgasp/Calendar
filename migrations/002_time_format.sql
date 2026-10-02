-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
alter table public.members add column if not exists time_format text;  -- '12' or '24'; null = 12
