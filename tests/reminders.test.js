// What the reminder function decides to send: lead times, time zones, repeats, and skipped / changed / moved days.
const { reminderCore, ok, done } = require('./_load');
const { computeDue, describe, wallToMs: W } = reminderCore();
const members = [{ id: 'g', user_id: 'ug', default_reminders: [60], time_format: '12' }, { id: 'b', user_id: 'ub', default_reminders: [30], time_format: '12' }];
const subs = [{ user_id: 'ug', tz: 'America/New_York' }, { user_id: 'ub', tz: 'America/Chicago' }];
const shift = { id: 'w', title: 'Work', date: '2026-10-05', all_day: false, start_time: '07:00:00', end_time: '15:00:00', location: 'Plant 2', repeat: 'weekly', repeat_every: 2, weekdays: [1, 2, 3, 4, 5], repeat_until: null, tz: 'America/New_York', end_date: null };
const X = (orig, o = {}) => ({ event_id: 'w', original_date: orig, skipped: false, new_date: null, title: null, start_time: null, end_time: null, all_day: null, location: null, notes: null, ...o });
const run = (ex, day, time, extra = {}) => computeDue({ events: [shift], eventMembers: [{ event_id: 'w', member_id: 'g' }], reminders: [], members, subs, windowMs: 300000, exceptions: ex, now: W(day, time, 'America/New_York'), ...extra });

ok(run([], '2026-10-07', '06:01').length === 1, 'default 1-hour reminder fires an hour before a 7am shift');
ok(run([], '2026-10-07', '05:50').length === 0 && run([], '2026-10-07', '06:20').length === 0, 'not early, and not sent late (20 minutes late is skipped)');
ok(run([], '2026-10-14', '06:01').length === 0 && run([], '2026-10-10', '06:01').length === 0, 'nothing on the off week or on a Saturday');
ok(run([X('2026-10-07', { skipped: true })], '2026-10-07', '06:01').length === 0, 'skipped day sends nothing');
ok(run([X('2026-10-08', { start_time: '10:00:00' })], '2026-10-08', '06:01').length === 0 && run([X('2026-10-08', { start_time: '10:00:00' })], '2026-10-08', '09:01').length === 1, 'changed time moves the reminder');
ok(run([X('2026-10-06', { new_date: '2026-10-10' })], '2026-10-06', '06:01').length === 0 && run([X('2026-10-06', { new_date: '2026-10-10' })], '2026-10-10', '06:01').length === 1, 'moved day reminds on its new day only');
ok(run([X('2026-11-02', { new_date: '2026-10-12' })], '2026-10-12', '06:01').length === 1, 'a day moved in from outside the lookahead window still reminds');
ok(run([X('2026-10-10', { start_time: '09:00:00' })], '2026-10-10', '08:01').length === 0, 'leftover change for a day the series lacks is ignored');
const r = run([X('2026-10-07', { title: 'Work (covering Sam)', location: 'Plant 5' })], '2026-10-07', '06:01');
ok(r.length === 1 && describe(r[0]).title === 'Work (covering Sam)' && describe(r[0]).body.includes('Plant 5'), 'the notification uses the changed title and place');
const oneOff = { ...shift, repeat: 'none', weekdays: null, date: '2026-10-07' };
ok(computeDue({ events: [oneOff], eventMembers: [{ event_id: 'w', member_id: 'g' }], reminders: [], members, subs, windowMs: 300000, exceptions: [X('2026-10-07', { skipped: true })], now: W('2026-10-07', '06:01', 'America/New_York') }).length === 1, 'exceptions on a non-repeating event are ignored');
const bday = { id: 'bd', title: "Gabby's birthday", date: '1990-10-05', all_day: true, start_time: null, location: '', repeat: 'yearly', repeat_every: 1, weekdays: null, repeat_until: null, tz: null };
const bd = (day, time) => computeDue({ events: [bday], eventMembers: [{ event_id: 'bd', member_id: 'b' }], reminders: [{ event_id: 'bd', member_id: 'b', minutes: [1440] }], members, subs, windowMs: 300000, now: W(day, time, 'America/Chicago') });
ok(bd('2026-10-04', '09:01').length === 1 && bd('2026-11-04', '09:01').length === 0 && bd('2027-10-04', '09:01').length === 1, 'a yearly all-day reminder fires 9am the day before, each year, and not monthly');
const people = computeDue({ events: [shift], eventMembers: [{ event_id: 'w', member_id: 'g' }, { event_id: 'w', member_id: 'b' }], reminders: [], members, subs, windowMs: 300000, now: W('2026-10-07', '06:31', 'America/New_York') });   // Brian's 30-min reminder is due; Gabby's 1-hour one was 31 minutes ago
ok(people.length === 1 && people[0].member.id === 'b', 'each person gets their own default lead time (30 min for Brian, in his own zone)');
done('reminders');
