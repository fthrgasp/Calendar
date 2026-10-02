-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- Allows events to repeat yearly (birthdays, anniversaries). Run this BEFORE saving a yearly event, or the save is rejected.
alter table public.events drop constraint if exists events_repeat_check;
alter table public.events add constraint events_repeat_check
  check (repeat in ('none','daily','weekly','monthly','yearly'));
