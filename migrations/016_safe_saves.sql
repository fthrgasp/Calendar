-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.

-- 1. Saving an event is all-or-nothing.
-- The app used to save in four separate steps (the event, clear its people, add its people back, your reminders). If one
-- failed partway, say a dropped connection after "clear its people", the event was left with nobody on it, and nobody got
-- reminded. This does the same four steps as one transaction: they all happen, or none do.
-- It runs with the caller's own permissions (security invoker), so the usual rules apply unchanged: anyone in the family
-- can save any family event, and each person can only set their own reminders.
create or replace function public.save_event(ev jsonb, who jsonb, my_member uuid, my_minutes jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare r events;
begin
  r := jsonb_populate_record(null::events, ev);
  insert into events (id, family_id, title, date, all_day, start_time, end_time, location, notes, repeat, repeat_until, tz,
                      show_years, repeat_every, weekdays, end_date, created_by, deleted_at)
  values (r.id, r.family_id, r.title, r.date, coalesce(r.all_day, false), r.start_time, r.end_time, coalesce(r.location, ''),
          coalesce(r.notes, ''), coalesce(r.repeat, 'none'), r.repeat_until, r.tz, coalesce(r.show_years, false),
          coalesce(r.repeat_every, 1), r.weekdays, r.end_date, r.created_by, r.deleted_at)
  on conflict (id) do update set
    family_id = excluded.family_id, title = excluded.title, date = excluded.date, all_day = excluded.all_day,
    start_time = excluded.start_time, end_time = excluded.end_time, location = excluded.location, notes = excluded.notes,
    repeat = excluded.repeat, repeat_until = excluded.repeat_until, tz = excluded.tz, show_years = excluded.show_years,
    repeat_every = excluded.repeat_every, weekdays = excluded.weekdays, end_date = excluded.end_date,
    created_by = excluded.created_by, deleted_at = excluded.deleted_at;
  delete from event_members where event_id = r.id;
  insert into event_members (event_id, member_id) select r.id, m::uuid from jsonb_array_elements_text(who) m;
  insert into reminders (event_id, member_id, minutes)
    values (r.id, my_member, array(select m::int from jsonb_array_elements_text(my_minutes) m))
    on conflict (event_id, member_id) do update set minutes = excluded.minutes;
end $$;
revoke all on function public.save_event(jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.save_event(jsonb, jsonb, uuid, jsonb) to authenticated;

-- 2. Who a person IS can't be changed from the app; everything else about them still can.
-- Anyone in the family can still rename people, change colors, reminders, time zone and display, and add someone without
-- a login. What's locked is a person's login (user_id) and family (family_id): changing those from the app could quietly
-- move someone's account onto another person or into another family. Sign-up and invites set them, and they run as the
-- database, so they're unaffected.
-- Note for later: a new column added to members has to be added to the lists below before the app can save it.
revoke insert, update on public.members from anon, authenticated;
grant insert (family_id, name, color, default_reminders, tz, time_format) on public.members to authenticated;
grant update (name, color, default_reminders, tz, time_format) on public.members to authenticated;
