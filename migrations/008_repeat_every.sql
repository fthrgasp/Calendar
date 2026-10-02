-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- Lets weekly events repeat every N weeks (2, 3, 4...), for rotating work schedules.
-- The app keeps working if uploaded before this runs; choosing "Every 2 weeks" just can't be saved until the column exists.
alter table public.events add column if not exists repeat_every int not null default 1
  check (repeat_every between 1 and 52);
